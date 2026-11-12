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
import os
import threading
import time
from typing import Any, Optional

from dotenv import load_dotenv
from livekit.agents import (
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobProcess,
    JobRequest,
    WorkerOptions,
    cli,
    inference,
)
from livekit.plugins import azure, silero

from agents.customer_agent import CustomerAgent, greeting_for
from agents.azure_tts import SafeAzureTTS
from agents.owner_copilot_agent import OwnerCopilotAgent
from config import Config, load as load_config
from services.call_slots import CallSlotRegistry
from services.db import Database
from services.recordings import duration_seconds, history_to_turns, preserve

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("omni-worker")

VAD_KEY = "vad"
AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "nordic-omni").strip() or "nordic-omni"

# Request acceptance runs on the worker loop while THREAD job shutdown runs on
# per-job loops. A job-ID registry makes check+increment atomic across threads
# and makes duplicate shutdown callbacks harmless.
MAX_CONCURRENT_CALLS = max(1, int(os.getenv("MAX_CONCURRENT_CALLS", "10")))
_call_slots = CallSlotRegistry(MAX_CONCURRENT_CALLS)


async def release_call_slot(job_id: str) -> None:
    if _call_slots.release(job_id):
        logger.info("Released call slot for %s (%d active)", job_id, _call_slots.active_count)


async def request_job(request: JobRequest) -> None:
    if not _call_slots.acquire(request.id):
        logger.warning(
            "Rejecting call: worker already serving %d call(s)",
            _call_slots.active_count,
        )
        await request.reject()
        return
    logger.info("Accepting call request %s (%d active)", request.id, _call_slots.active_count)
    try:
        await request.accept()
        logger.info("Call request %s assigned", request.id)
    except BaseException:
        # Cancellation is included: an interrupted accept must not strand a slot.
        await release_call_slot(request.id)
        logger.exception("Could not accept call request %s", request.id)
        raise

# asyncpg pools are bound to one asyncio event loop. LiveKit's thread executor
# runs jobs on separate loops, so a module-global pool is unsafe: the second call
# crashed with "Future attached to a different loop". Keep one pool per worker
# thread + loop.
_db_state = threading.local()


async def get_db(dsn: str) -> Database:
    loop = asyncio.get_running_loop()
    db = getattr(_db_state, "db", None)
    if db is not None and getattr(_db_state, "loop", None) is loop and db.is_connected:
        return db
    db = Database(dsn)
    await db.connect()
    _db_state.db = db
    _db_state.loop = loop
    return db


async def close_db() -> None:
    db = getattr(_db_state, "db", None)
    if db is not None:
        await db.close()
    _db_state.db = None
    _db_state.loop = None


def prewarm(proc: JobProcess) -> None:
    proc.userdata[VAD_KEY] = silero.VAD.load()


def build_session(
    cfg: Config,
    language: str,
    proc: JobProcess,
    *,
    voice_override: Optional[str] = None,
) -> AgentSession:
    """STT/LLM/TTS come from LiveKit Inference or Microsoft Azure; language drives accent + accuracy."""
    chosen_voice = (voice_override or cfg.tts_voice or "").strip()
    is_cartesia = cfg.tts_model.lower().startswith("cartesia") or chosen_voice.startswith("cartesia")
    is_azure = not is_cartesia and (
        cfg.tts_model.lower().startswith("azure")
        or chosen_voice.startswith("azure:")
        or "Neural" in chosen_voice
    )
    clean_voice = chosen_voice.replace("azure:", "").replace("cartesia:", "").strip()

    has_azure_auth = bool(
        (cfg.azure_speech_key and cfg.azure_speech_region)
        or os.getenv("AZURE_SPEECH_KEY")
        or os.getenv("AZURE_SPEECH_ENDPOINT")
    )

    # Check for Microsoft Azure TTS selection
    if is_azure and has_azure_auth:
        azure_voice = clean_voice or ("da-DK-ChristelNeural" if language.startswith("da") else "en-US-JennyNeural")
        azure_kwargs: dict[str, Any] = {
            "voice": azure_voice,
            "language": "da-DK" if language.startswith("da") else "en-US",
        }
        speech_key = cfg.azure_speech_key or os.getenv("AZURE_SPEECH_KEY")
        speech_region = cfg.azure_speech_region or os.getenv("AZURE_SPEECH_REGION")
        if speech_key:
            azure_kwargs["speech_key"] = speech_key
        if speech_region:
            azure_kwargs["speech_region"] = speech_region

        logger.info(f"Using Microsoft Azure TTS voice: {azure_voice}")
        tts_instance = SafeAzureTTS(**azure_kwargs)
    else:
        if is_azure:
            logger.warning(
                "Azure voice %r was requested, but Azure Speech credentials are absent; "
                "using LiveKit Inference %s instead.",
                chosen_voice,
                cfg.tts_model,
            )
        lang_code = language.split("-")[0].lower() if "-" in language else language.lower()
        tts_kwargs: dict[str, Any] = {"language": lang_code}
        if clean_voice and not clean_voice.endswith("Neural") and "azure" not in chosen_voice.lower() and "cartesia" not in clean_voice:
            tts_kwargs["voice"] = clean_voice
        model_name = cfg.tts_model if (cfg.tts_model and not cfg.tts_model.startswith("azure")) else "cartesia/sonic-3"
        logger.info(f"Using LiveKit Inference TTS model={model_name} kwargs={tts_kwargs}")
        tts_instance = inference.TTS(model_name, **tts_kwargs)

    # Check for Microsoft Azure STT selection
    if (cfg.stt_model.lower().startswith("azure") or has_azure_auth) and has_azure_auth:
        stt_langs = ["da-DK", "en-US"] if language.startswith("da") else ["en-US", "da-DK"]
        stt_kwargs: dict[str, Any] = {"language": stt_langs}
        speech_key = cfg.azure_speech_key or os.getenv("AZURE_SPEECH_KEY")
        speech_region = cfg.azure_speech_region or os.getenv("AZURE_SPEECH_REGION")
        if speech_key:
            stt_kwargs["speech_key"] = speech_key
        if speech_region:
            stt_kwargs["speech_region"] = speech_region

        logger.info(f"Using Microsoft Azure STT with multi-language detection: {stt_langs}")
        stt_instance = azure.STT(**stt_kwargs)
    else:
        stt_instance = inference.STT(model=cfg.stt_model, language=language)

    return AgentSession(
        vad=proc.userdata[VAD_KEY],
        stt=stt_instance,
        llm=inference.LLM(model=cfg.llm_model),
        tts=tts_instance,
        turn_handling={
            "endpointing": {"min_delay": 0.35, "max_delay": 1.5},
            "preemptive_generation": {"preemptive_tts": True},
            "interruption": {
                "enabled": True,
                "mode": "vad",
                "min_duration": 0.15,
                "resume_false_interruption": False,
            },
        },
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
    # Transport evidence comes only from LiveKit's carrier attributes. JSON
    # metadata is caller-controlled input and can never manufacture SIP trust.
    sip_transport = bool(
        attributes.get("sip.callID") or attributes.get("sip.trunkPhoneNumber")
    )

    try:
        parsed = json.loads(raw) if raw else {}
    except Exception:
        parsed = {}

    if not isinstance(parsed, dict):
        parsed = {}

    parsed["_sip_transport"] = sip_transport
    if sip_transport:
        # Carrier attributes override every colliding metadata field. Tenant,
        # contact, role and browser attempt IDs are deliberately discarded;
        # entrypoint derives them from the DID/E.164 caller or refuses the job.
        parsed["sip_call_id"] = attributes.get("sip.callID")
        parsed["called_number"] = attributes.get("sip.trunkPhoneNumber")
        parsed["phone_number"] = attributes.get("sip.phoneNumber")
        parsed["sip_display_name"] = attributes.get("sip.displayName")
        parsed["role"] = "customer"
        for key in (
            "tenant_id",
            "tenantId",
            "contact_id",
            "contactId",
            "call_id",
        ):
            parsed.pop(key, None)
    else:
        # Dispatch/job metadata is only a fallback for signed web sessions. It
        # is never consulted for tenant or role selection on a PSTN transport.
        for source in (
            getattr(getattr(ctx, "job", None), "metadata", ""),
            getattr(getattr(ctx, "room", None), "metadata", ""),
        ):
            if not source:
                continue
            try:
                job_meta = json.loads(source)
            except Exception:
                continue
            if isinstance(job_meta, dict):
                for key in ("tenant_id", "tenantId", "contact_id", "contactId", "role"):
                    if job_meta.get(key) is not None:
                        parsed.setdefault(key, job_meta[key])

    parsed.setdefault("participant_identity", getattr(participant, "identity", "") or "")
    return parsed


async def close_agent_session(session: AgentSession) -> None:
    """Stop activities/streams before closing the per-call TTS HTTP session.

    AgentSession owns barge-in cancellation. Its close is idempotent and waits
    for interrupted speech handles; closing TTS afterwards prevents late audio
    writes and releases Azure sockets even if activity teardown itself fails.
    """
    try:
        await asyncio.wait_for(session.aclose(), timeout=5.0)
    finally:
        tts_instance = session.tts
        if tts_instance is not None:
            await asyncio.wait_for(tts_instance.aclose(), timeout=3.0)


async def finalise_call(
    *,
    ctx: JobContext,
    db: Database,
    tenant: dict[str, Any],
    session: Optional[AgentSession],
    started_at: float,
    should_record: bool,
) -> None:
    """Persist a terminal call status, transcript and recording outcome."""
    room = ctx.room.name
    tenant_id = str(tenant["id"])

    turns = history_to_turns(session.history if session else None)
    duration = duration_seconds(started_at)
    terminal_status = "completed" if turns else "missed"
    try:
        await db.finalise_call(
            tenant_id=tenant_id,
            room_name=room,
            status=terminal_status,
            turns=turns,
            duration=duration,
        )
        logger.info("Call finalized as %s for %s (%d turns)", terminal_status, room, len(turns))
        try:
            await db.persist_transcript_messages(
                tenant_id=tenant_id, room_name=room, turns=turns
            )
            logger.info("Cross-channel transcript persisted for %s", room)
        except Exception:
            logger.exception("Could not persist cross-channel transcript for %s", room)
    except Exception:
        logger.exception("Could not finalise call status for %s", room)

    if not should_record:
        await db.set_recording(room_name=room, tenant_id=tenant_id, status="skipped")
        logger.info("Recording disabled for tenant %s", tenant.get("slug"))
        return

    try:
        # preserve() waits with time.sleep(); running it in a thread keeps the
        # recorder task's event loop free to flush audio.ogg.
        result = await asyncio.to_thread(
            preserve,
            source_dir=ctx.session_directory,
            tenant_slug=str(tenant.get("slug") or "unknown"),
            room_name=room,
        )
        await db.set_recording(
            room_name=room,
            tenant_id=tenant_id,
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
            await db.set_recording(
                room_name=room,
                tenant_id=tenant_id,
                status="failed",
                error=str(exc) or type(exc).__name__,
            )
        except Exception:
            logger.exception("Could not even record the recording failure")


async def entrypoint(ctx: JobContext) -> None:
    job_id = ctx.job.id
    session: Optional[AgentSession] = None
    db: Optional[Database] = None
    tenant: Optional[dict[str, Any]] = None
    started_at = time.time()
    should_record = False
    call_log_ready = False
    shutdown_lock = asyncio.Lock()
    shutdown_complete = False

    async def on_shutdown() -> None:
        """One ordered, idempotent cleanup owner for every exit path."""
        nonlocal shutdown_complete
        async with shutdown_lock:
            if shutdown_complete:
                return
            shutdown_complete = True
            try:
                if session is not None:
                    try:
                        await close_agent_session(session)
                    except Exception:
                        logger.exception("Could not close voice session for %s", ctx.room.name)

                if call_log_ready and db is not None and tenant is not None:
                    try:
                        await finalise_call(
                            ctx=ctx,
                            db=db,
                            tenant=tenant,
                            session=session,
                            started_at=started_at,
                            should_record=should_record,
                        )
                    except Exception:
                        logger.exception("Call cleanup failed for %s", ctx.room.name)
            finally:
                try:
                    if db is not None:
                        await close_db()
                finally:
                    # The slot is held until streams and DB sockets are closed.
                    await release_call_slot(job_id)

    # Register before configuration, connect or database work: every later
    # exception and abrupt participant disconnect now has exactly one cleanup.
    ctx.add_shutdown_callback(on_shutdown)
    cfg = load_config()
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    meta = await read_metadata(ctx)
    tenant_id = meta.get("tenant_id") or meta.get("tenantId")
    contact_id = meta.get("contact_id") or meta.get("contactId")
    role = meta.get("role", "customer")
    called_number = meta.get("called_number")
    # Only carrier attributes establish PSTN transport. A dialled trunk number
    # is the sole tenant selector for SIP; injected tenant metadata is ignored.
    sip_call = bool(
        meta.get("_sip_transport") and (meta.get("sip_call_id") or called_number)
    )

    db = await get_db(cfg.database_url)

    if sip_call:
        tenant = await db.get_tenant_by_did(str(called_number)) if called_number else None
        tenant_id = tenant["id"] if tenant else None
        contact_id = None
        role = "customer"
        if tenant:
            logger.info("Resolved inbound DID %s to tenant %s", called_number, tenant["slug"])
    else:
        tenant = await db.get_tenant(str(tenant_id)) if tenant_id else None

    # Never select a default tenant. Unknown DIDs and inactive tenants stop here.
    if not tenant_id or not tenant:
        raise RuntimeError(
            "No signed tenant_id or configured inbound DID. Refusing to route the call, "
            "because guessing a tenant would write into another client's CRM."
        )
    if str(tenant.get("status") or "active") != "active":
        raise RuntimeError(f"Tenant {tenant_id} is not accepting calls")

    # Browser tokens pre-create this row. From this point onward every setup
    # failure (including contact resolution) must settle it as missed.
    call_log_ready = bool(meta.get("call_id"))
    language = "da" if str(tenant.get("stt_language") or tenant.get("default_language") or "da-DK").lower().startswith("da") else "en"

    # Only the signed token's exact role is trusted, and never from a SIP header.
    if not sip_call and role in ("owner", "owner_consult", "owner_merged"):
        logger.info("Owner co-pilot session for tenant %s", tenant["slug"])
        session = build_session(cfg, language, ctx.proc, voice_override=tenant.get("voice_id"))

        @session.on("close")
        def _on_owner_session_close(*_: Any) -> None:
            ctx.shutdown("owner session closed")

        await session.start(OwnerCopilotAgent(tenant=tenant, db=db), room=ctx.room)
        await session.generate_reply(
            instructions="Greet the owner in one short sentence and ask what they need."
        )
        return

    contact = (
        await db.get_contact(str(contact_id), str(tenant["id"])) if contact_id else None
    )
    phone = meta.get("phone_number")
    if contact is None and phone:
        contact = (
            await db.get_or_create_inbound_contact(
                tenant_id=str(tenant["id"]), phone=str(phone), language=language
            )
            if sip_call
            else await db.get_contact_by_phone(str(tenant_id), str(phone))
        )

    if contact is None:
        raise RuntimeError(
            f"No contact could be resolved for call. tenant={tenant_id} "
            f"contact_id={contact_id} phone={phone!r}"
        )

    channel = "voice_inbound" if sip_call else "voice_instant_webrtc"
    knowledge = await db.get_knowledge(str(tenant["id"]))
    recent_messages = await db.get_recent_messages(
        str(tenant["id"]), str(contact["id"]), limit=12
    )
    await db.ensure_call_log(
        tenant_id=str(tenant["id"]),
        contact_id=str(contact["id"]),
        room_name=ctx.room.name,
        channel=channel,
    )
    call_log_ready = True
    should_record = bool(tenant.get("record_calls", True))
    record_opts = (
        {"audio": True, "traces": False, "logs": False, "transcript": False}
        if should_record
        else False
    )

    logger.info(
        "Customer session for tenant=%s contact=%s room=%s",
        tenant["slug"],
        contact.get("full_name"),
        ctx.room.name,
    )
    session = build_session(cfg, language, ctx.proc, voice_override=tenant.get("voice_id"))
    agent = CustomerAgent(
        tenant=tenant,
        contact=contact,
        db=db,
        room_name=ctx.room.name,
        knowledge=knowledge,
        history=recent_messages,
        channel=channel,
    )

    # RoomIO closes the session when the caller leaves, but the job room itself
    # otherwise remains alive. Shut the job down so finalisation is not delayed
    # by the worker's session-end grace period.
    @session.on("close")
    def _on_session_close(*_: Any) -> None:
        logger.info("Customer session closed; requesting job shutdown for %s", ctx.room.name)
        ctx.shutdown("customer session closed")

    await session.start(agent, room=ctx.room, record=record_opts)
    # Brief grace period so WebRTC client audio track subscription completes before first utterance.
    await asyncio.sleep(0.6)
    # Consent and identity must be exact, not an LLM paraphrase of instructions.
    await session.say(greeting_for(tenant, contact), allow_interruptions=True)


if __name__ == "__main__":
    from livekit.agents import JobExecutorType

    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            request_fnc=request_job,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
            job_executor_type=JobExecutorType.THREAD,
            load_threshold=float("inf"),
            session_end_timeout=5.0,
        )
    )
