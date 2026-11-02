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

    await session.start(agent, room=ctx.room)
    await session.generate_reply(instructions=greeting_for(tenant, contact))


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm))
