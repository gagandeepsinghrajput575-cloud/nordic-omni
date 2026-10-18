import os
from livekit.agents import JobContext, AutoSubscribe, llm
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import openai, deepgram, azure
from services.supabase_service import SupabaseService


class OwnerGodModeTools(llm.FunctionContext):
    def __init__(self, tenant_id: str, db: SupabaseService):
        super().__init__()
        self.tenant_id = tenant_id
        self.db = db

    @llm.ai_callable(desc="Modifies business hours, closing the shop, or setting custom availability.")
    async def mutate_availability(self, day: str, status: str, note: str = "") -> str:
        self.db.trigger_ui_event(
            self.tenant_id,
            "HIGHLIGHT_AVAILABILITY",
            {"day": day, "status": status, "note": note},
        )
        return f"Availability mutated to {status} on screen and in DB."

    @llm.ai_callable(desc="Provides a spoken executive summary of pipeline value and active leads.")
    async def brief_owner(self) -> str:
        self.db.trigger_ui_event(
            self.tenant_id,
            "FOCUS_SCORECARD",
            {"metric": "pipeline_value"},
        )
        return "I am highlighting the scorecards on your command center now."


async def run_owner_copilot_agent(ctx: JobContext, tenant: dict):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    db = SupabaseService()
    fnc_ctx = OwnerGodModeTools(tenant["id"], db)

    is_danish = tenant.get("default_language", "da-DK").startswith("da")

    system_prompt = f"""You are the Executive AI Operations Co-Pilot (God Mode) for {tenant.get('owner_name', 'Owner')} at {tenant['name']}.
Your duty is to manage operations, adjust schedules, and brief the owner.
Language: {'Danish' if is_danish else 'English'}.
Speak highly professionally, authoritatively, and execute UI commands efficiently."""

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

    agent = VoicePipelineAgent(
        vad=ctx.proc.userdata["vad"],
        stt=deepgram.STT(language="da" if is_danish else "en"),
        llm=llm_impl,
        tts=azure.TTS(voice="da-DK-JeppeNeural" if is_danish else "en-US-AvaMultilingualNeural"),
        fnc_ctx=fnc_ctx,
        chat_ctx=llm.ChatContext().append(role="system", text=system_prompt),
    )

    agent.start(ctx.room)
    greeting = (
        "Godmorgen mester. Jeg er klar til dine instrukser."
        if is_danish
        else "Good morning. I am ready for your operational instructions."
    )
    await agent.say(greeting, allow_interruptions=True)
