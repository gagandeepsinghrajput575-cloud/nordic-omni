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


async def run_customer_agent(ctx: JobContext, tenant: dict, contact: dict):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    db = SupabaseService()
    room_name = ctx.room.name
    default_lang = tenant.get("default_language", "da-DK").split("-")[0]
    language = contact.get("preferred_language") or default_lang
    is_danish = language.startswith("da")

    # Assemble FunctionContext Tools
    crm_tool = CRMTools(tenant["id"], contact["id"], db)
    kb_tool = KnowledgeTools(tenant["id"], db)
    wt_tool = WarmTransferTools(tenant["id"], contact["id"], room_name, db)

    fnc_ctx = llm.FunctionContext()
    fnc_ctx.add_context(crm_tool)
    fnc_ctx.add_context(kb_tool)
    fnc_ctx.add_context(wt_tool)

    full_name = contact.get("full_name", "Kunde" if is_danish else "Customer")
    shared_memory = contact.get("shared_memory_summary", "New caller.")

    system_prompt = f"""You are the inbound AI Voice Assistant for "{tenant['name']}".
Your goal is to be exceptionally helpful, conversational, and solve the customer's needs instantly.
Language: {'Danish' if is_danish else 'English'}.
Customer Name: {full_name}
Shared Memory & Context: {shared_memory}

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
    wt_tool.agent = agent

    agent.start(ctx.room)

    first_name = full_name.split()[0] if full_name else ("Kunde" if is_danish else "there")
    greeting = (
        f"Hej {first_name}, hvordan kan jeg hjælpe dig i dag?"
        if is_danish
        else f"Hi {first_name}, how can I help you today?"
    )
    await agent.say(greeting, allow_interruptions=True)
