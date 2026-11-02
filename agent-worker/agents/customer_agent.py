import os
import asyncio
from livekit.agents import (
    JobContext,
    WorkerOptions,
    run_app,
    AutoSubscribe,
    JobProcess,
    llm,
)
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import openai, deepgram, azure
from services.supabase_service import SupabaseService
from tools.crm_tools import CRMTools
from tools.knowledge_tools import KnowledgeTools
from tools.warm_transfer_tools import WarmTransferTools


class CustomerAgentTools(CRMTools, KnowledgeTools, WarmTransferTools):
    """
    Unified FunctionContext inheriting all CRM, Knowledge base, and Warm Transfer
    actions into a single agent tool context.
    """
    def __init__(self, tenant_id: str, contact_id: str, room_name: str, db: SupabaseService):
        CRMTools.__init__(self, tenant_id, contact_id, db)
        KnowledgeTools.__init__(self, tenant_id, db)
        WarmTransferTools.__init__(self, tenant_id, contact_id, room_name, db)


async def run_customer_agent(ctx: JobContext, tenant: dict, contact: dict):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    db = SupabaseService()
    room_name = ctx.room.name
    default_lang = tenant.get("default_language", "da-DK").split("-")[0]
    language = contact.get("preferred_language") or default_lang
    is_danish = language.startswith("da")

    # Assemble Unified FunctionContext
    fnc_ctx = CustomerAgentTools(tenant["id"], contact["id"], room_name, db)

    full_name = contact.get("full_name", "Kunde" if is_danish else "Customer")
    shared_memory = contact.get("shared_memory_summary", "New caller.")

    base_custom_prompt = tenant.get("customer_system_prompt")
    broadcast_notice = tenant.get("active_broadcast_message")

    if base_custom_prompt:
        system_prompt = f"""{base_custom_prompt}

Context:
Customer Name: {full_name}
Shared Memory & History: {shared_memory}
Active Operational Notice: {broadcast_notice or 'Standard response times active.'}

Rules:
1. Always adapt strictly to {'Danish' if is_danish else 'English'}.
2. Keep responses brief, conversational, and natural for a phone call.
3. If the customer reports an emergency, demands a human, or is angry, call `trigger_dire_escalation` immediately.
"""
    else:
        system_prompt = f"""You are the inbound AI Voice Assistant for "{tenant['name']}".
Your goal is to be exceptionally helpful, conversational, and solve the customer's needs instantly.
Language: {'Danish' if is_danish else 'English'}.
Customer Name: {full_name}
Shared Memory & Context: {shared_memory}
Active Operational Notice: {broadcast_notice or 'Standard response times active.'}

Rules:
1. Always adapt your language strictly to {'Danish' if is_danish else 'English'}.
2. Keep responses brief, conversational, and natural for a phone call.
3. If they are angry, demand a human, or have a severe emergency, invoke `trigger_dire_escalation` immediately.
"""

    llm_impl = openai.LLM(
        api_key=os.getenv("DEEPSEEK_API_KEY", os.getenv("GROQ_API_KEY", "mock")),
        base_url=(
            "https://api.deepseek.com/v1"
            if os.getenv("DEEPSEEK_API_KEY")
            else "https://api.groq.com/openai/v1"
        ),
        model=(
            "deepseek-chat"
            if os.getenv("DEEPSEEK_API_KEY")
            else "llama-3.3-70b-versatile"
        ),
    )

    stt_impl = deepgram.STT(language="multi")  # Auto-detects da / en-US

    tts_impl = azure.TTS(
        voice="da-DK-ChristelNeural" if is_danish else "en-US-AvaMultilingualNeural"
    )

    agent = VoicePipelineAgent(
        vad=ctx.proc.userdata["vad"],
        stt=stt_impl,
        llm=llm_impl,
        tts=tts_impl,
        fnc_ctx=fnc_ctx,
        chat_ctx=llm.ChatContext().append(role="system", text=system_prompt),
    )

    # Attach agent instance to WarmTransferTools for holding protocol control
    fnc_ctx.agent = agent

    agent.start(ctx.room)

    first_name = full_name.split()[0] if full_name else ("Kunde" if is_danish else "there")
    greeting = (
        f"Hej {first_name}, hvordan kan jeg hjælpe dig i dag?"
        if is_danish
        else f"Hi {first_name}, how can I help you today?"
    )
    await agent.say(greeting, allow_interruptions=True)
