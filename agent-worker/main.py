"""Voice worker entrypoint.

Fixes two fatal defects in the previous version:

  1. It fell back to `select * from tenants limit 1` when metadata was missing,
     which silently routed a caller into somebody else's CRM. Now it raises.
  2. It built the agent through a broken triple-inheritance chain that could not
     be instantiated. Now it uses a single `Agent` subclass.

Models are served by LiveKit Inference, which is included with LiveKit Cloud and
needs no separate Deepgram/Azure/OpenAI keys.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Optional

from dotenv import load_dotenv
from livekit.agents import (
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    inference,
)
from livekit.plugins import silero

from agents.customer_agent import CustomerAgent, greeting_for
from agents.owner_copilot_agent import OwnerCopilotAgent
from config import Config, load as load_config
from services.db import Database
from services.recordings import duration_seconds, history_to_turns, preserve

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("omni-worker")

VAD_KEY = "vad"

# One pool per worker process. Not closed per job: agent tools keep using it for
# the duration of the call, which continues after this function returns.
_db: Optional[Database] = None


async def get_db(dsn: str) -> Database:
    global _db
    if _db is None:
        _db = Database(dsn)
        await _db.connect()
    return _db


def prewarm(proc: JobProcess) -> None:
    proc.userdata[VAD_KEY] = silero.VAD.load()


def build_session(cfg: Config, language: str, proc: JobProcess) -> AgentSession:
    """STT/LLM/TTS come from LiveKit Inference; language drives accent + accuracy."""
    tts_kwargs: dict[str, Any] = {"language": language}
    if cfg.tts_voice:
        tts_kwargs["voice"] = cfg.tts_voice

    return AgentSession(
        vad=proc.userdata[VAD_KEY],
        stt=inference.STT(model=cfg.stt_model, language=language),
        llm=inference.LLM(model=cfg.llm_model),
        tts=inference.TTS(cfg.tts_model, **tts_kwargs),
    )


async def read_metadata(ctx: JobContext) -> dict[str, Any]:
    participant = getattr(ctx, "participant", None)
    if participant is None:
        try:
            participant = await asyncio.wait_for(ctx.wait_for_participant(), timeout=15)
        except Exception:
            participant = None

    if participant is None:
        return {}

    attributes = getattr(participant, "attributes", {}) or {}
    raw = getattr(participant, "metadata", "") or ""

    try:
        parsed = json.loads(raw) if raw else {}
    except Exception:
        parsed = {}

    if not isinstance(parsed, dict):
        parsed = {}

    # Merge SIP attributes so PSTN callers still resolve a phone number.
    sip_phone = attributes.get("sip.phoneNumber")
    if sip_phone:
        parsed.setdefault("phone_number", sip_phone)

    parsed.setdefault("participant_identity", getattr(participant, "identity", "") or "")
    return parsed


async def finalise_call(
    *,
    ctx: JobContext,
    db: Database,
    tenant: dict[str, Any],
    session: AgentSession,
    started_at: float,
    should_record: bool,
) -> None:
    """Persist transcript and recording when the job ends.

    Every branch writes an explicit status. A silent failure here is exactly how
    the previous recorder stayed broken for months without anyone noticing.
    """
    room = ctx.room.name

    # 1. Transcript — read locally from session.history, never uploaded.
    try:
        turns = history_to_turns(session.history)
        if turns:
            await db.set_transcript(
                room_name=room,
                turns=turns,
                duration=duration_seconds(started_at),
            )
            logger.info("Transcript saved for %s (%d turns)", room, len(turns))
        else:
            logger.warning("No transcript turns captured for %s", room)
    except Exception:
        logger.exception("Could not persist transcript for %s", room)

    # 2. Recording.
    if not should_record:
        await db.set_recording(room_name=room, status="skipped")
        logger.info("Recording disabled for tenant %s", tenant.get("slug"))
        return

    try:
        result = preserve(
            source_dir=ctx.session_directory,
            tenant_slug=str(tenant.get("slug") or "unknown"),
            room_name=room,
        )
        await db.set_recording(
            room_name=room,
            status=result["status"],
            path=result.get("path"),
            recorded_bytes=result.get("bytes"),
            error=result.get("error"),
        )
        if result["status"] == "ok":
            logger.info("Recording stored for %s -> %s", room, result.get("path"))
        else:
            logger.error("Recording FAILED for %s: %s", room, result.get("error"))
    except Exception as exc:
        logger.exception("Recording persistence crashed for %s", room)
        try:
            await db.set_recording(room_name=room, status="failed", error=str(exc))
        except Exception:
            logger.exception("Could not even record the recording failure")


async def entrypoint(ctx: JobContext) -> None:
    cfg = load_config()
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    meta = await read_metadata(ctx)
    tenant_id = meta.get("tenant_id") or meta.get("tenantId")
    contact_id = meta.get("contact_id") or meta.get("contactId")
    role = meta.get("role", "customer")
    identity = str(meta.get("participant_identity", ""))

    # NEVER guess a tenant. The old code picked the oldest tenant in the database.
    if not tenant_id:
        raise RuntimeError(
            "No tenant_id in participant metadata. Refusing to route the call, "
            "because guessing a tenant would write into another client's CRM."
        )

    db = await get_db(cfg.database_url)
    tenant = await db.get_tenant(str(tenant_id))
    if not tenant:
        raise RuntimeError(f"Tenant {tenant_id} not found")

    language = "da" if str(tenant.get("default_language", "da-DK")).lower().startswith("da") else "en"

    if role == "owner" or "owner" in identity or "consult" in identity:
        logger.info("Owner co-pilot session for tenant %s", tenant["slug"])
        session = build_session(cfg, language, ctx.proc)
        await session.start(OwnerCopilotAgent(tenant=tenant, db=db), room=ctx.room)
        await session.generate_reply(
            instructions="Greet the owner in one short sentence and ask what they need."
        )
        return

    contact = await db.get_contact(str(contact_id)) if contact_id else None

    if contact is None:
        phone = meta.get("phone_number")
        if phone:
            contact = await db.get_contact_by_phone(str(tenant_id), str(phone))

    if contact is None:
        raise RuntimeError(
            f"No contact could be resolved for call. tenant={tenant_id} "
            f"contact_id={contact_id} phone={meta.get('phone_number')!r}"
        )

    knowledge = await db.get_knowledge(str(tenant["id"]))
    await db.ensure_call_log(
        tenant_id=str(tenant["id"]),
        contact_id=str(contact["id"]),
        room_name=ctx.room.name,
        channel="voice_instant_webrtc",
    )

    logger.info(
        "Customer session for tenant=%s contact=%s room=%s",
        tenant["slug"],
        contact.get("full_name"),
        ctx.room.name,
    )

    session = build_session(cfg, language, ctx.proc)
    agent = CustomerAgent(
        tenant=tenant,
        contact=contact,
        db=db,
        room_name=ctx.room.name,
        knowledge=knowledge,
    )

    started_at = time.time()

    # Recording is local: AgentSession writes audio.ogg into ctx.session_directory.
    # `traces`, `logs` and `transcript` are switched OFF so a caller's conversation
    # is never uploaded to a third party just to be read back — we take the
    # transcript from session.history locally instead.
    should_record = bool(tenant.get("record_calls", True))
    record_opts = (
        {"audio": True, "traces": False, "logs": False, "transcript": False}
        if should_record
        else False
    )

    async def on_shutdown() -> None:
        await finalise_call(
            ctx=ctx,
            db=db,
            tenant=tenant,
            session=session,
            started_at=started_at,
            should_record=should_record,
        )

    ctx.add_shutdown_callback(on_shutdown)

    await session.start(agent, room=ctx.room, record=record_opts)
    await session.generate_reply(instructions=greeting_for(tenant, contact))


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm))
