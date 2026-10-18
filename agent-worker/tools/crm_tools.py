import asyncio
from livekit.agents import llm
from services.supabase_service import SupabaseService


class CRMTools(llm.FunctionContext):
    def __init__(self, tenant_id: str, contact_id: str, db: SupabaseService):
        super().__init__()
        self.tenant_id = tenant_id
        self.contact_id = contact_id
        self.db = db

    @llm.ai_callable(desc="Updates the CRM pipeline stage, lead score, and core memory summary for the current caller.")
    async def update_pipeline_stage(self, stage: str, lead_score: int, memory_update: str) -> str:
        """
        Updates the CRM. Valid stages: 'new_lead', 'contacted', 'qualified', 'booked', 'dire_escalated', 'closed_lost'.
        """
        try:
            self.db.update_crm_stage(self.contact_id, stage, lead_score, memory_update)
            # Emit UI Command to physically move the card on the screen
            self.db.trigger_ui_event(self.tenant_id, "FILTER_PIPELINE", {"highlight_stage": stage})
            return f"CRM updated to {stage}. Pipeline visualization refreshed."
        except Exception as e:
            return f"Failed to update CRM: {e}"
