import os
import json
import uuid
import asyncio
from dotenv import load_dotenv
from livekit.agents import cli, JobContext, JobProcess, WorkerOptions, AutoSubscribe
from livekit.plugins import silero
from services.supabase_service import SupabaseService
from services.egress_recorder import start_supabase_s3_recording
from agents.customer_agent import run_customer_agent
from agents.owner_copilot_agent import run_owner_copilot_agent

load_dotenv()


async def entrypoint(ctx: JobContext):
    db = SupabaseService()

    # Extract participant metadata injected by Token Route / Webhook
    participant_identity = ""
    metadata_str = ""
    attributes = {}

    if hasattr(ctx, "participant") and ctx.participant:
        participant_identity = ctx.participant.identity or ""
        metadata_str = ctx.participant.metadata or ""
        attributes = getattr(ctx.participant, "attributes", {}) or {}
    else:
        try:
            p = await ctx.wait_for_participant()
            if p:
                participant_identity = p.identity or ""
                metadata_str = p.metadata or ""
                attributes = getattr(p, "attributes", {}) or {}
        except Exception:
            pass

    try:
        metadata = json.loads(metadata_str) if metadata_str else {}
    except Exception:
        metadata = {}

    tenant_id = metadata.get("tenant_id") or metadata.get("tenantId")
    contact_id = metadata.get("contact_id") or metadata.get("contactId")
    role = metadata.get("role", "customer")

    if not tenant_id:
        print("Missing tenant ID in token metadata. Defaulting to first tenant.")
        res = db.client.table("tenants").select("*").limit(1).execute()
        if not res.data:
            raise RuntimeError("No tenant records found in database.")
        tenant = res.data[0]
        tenant_id = tenant["id"]
    else:
        tenant = db.get_tenant_by_id(tenant_id)
        if not tenant:
            raise RuntimeError(f"Tenant {tenant_id} not found.")

    # Trigger Egress Call Recording natively to Supabase Storage
    asyncio.create_task(start_supabase_s3_recording(ctx.room.name, tenant["slug"]))

    # Route Request based on Role / Identity
    if "owner" in participant_identity or "consult" in participant_identity or role == "owner":
        print(f"Routing to Owner God-Mode Co-Pilot for tenant {tenant['slug']}")
        await run_owner_copilot_agent(ctx, tenant)
    else:
        print(f"Routing to Bilingual Customer Agent for contact {contact_id}")
        contact = db.get_contact_by_id(contact_id) if contact_id else None

        # Fallback if caller dialed FlyNumber SIP directly without token metadata
        if not contact:
            phone_number = attributes.get("sip.phoneNumber")
            if phone_number:
                contact = db.get_contact_by_phone(tenant_id, phone_number)

            if not contact:
                # Create ephemeral contact with valid UUID for unknown SIP inbound
                is_danish = tenant.get("default_language", "da-DK").startswith("da")
                contact = {
                    "id": str(uuid.uuid4()),
                    "full_name": "Kunde" if is_danish else "Caller",
                    "preferred_language": "da" if is_danish else "en",
                    "shared_memory_summary": "Inbound call via FlyNumber PSTN.",
                }

        await run_customer_agent(ctx, tenant, contact)


def prewarm_process(proc: JobProcess):
    """Pre-load VAD model into memory for lowest possible latency barge-in"""
    proc.userdata["vad"] = silero.VAD.load()


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm_process,
        )
    )
