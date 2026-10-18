import asyncio
from typing import Optional, Any
from livekit.agents import llm
from services.supabase_service import SupabaseService


class WarmTransferTools(llm.FunctionContext):
    def __init__(
        self,
        tenant_id: str,
        contact_id: str,
        room_name: str,
        db: SupabaseService,
        agent: Optional[Any] = None,
    ):
        super().__init__()
        self.tenant_id = tenant_id
        self.contact_id = contact_id
        self.room_name = room_name
        self.db = db
        self.agent = agent

    async def _monitor_hold_state(self):
        """
        Graceful holding loop: checks call_logs.status until resolved to
        merged_live_with_owner or completed.
        """
        try:
            while True:
                await asyncio.sleep(2)
                res = (
                    self.db.client.table("call_logs")
                    .select("status")
                    .eq("room_name", self.room_name)
                    .limit(1)
                    .execute()
                )
                if res.data:
                    status = res.data[0].get("status")
                    if status in ("merged_live_with_owner", "completed"):
                        break
        except Exception as e:
            print(f"Holding monitor error: {e}")

    @llm.ai_callable(desc="Triggers a dire escalation to immediately ring the business owner for a live warm transfer.")
    async def trigger_dire_escalation(
        self,
        dire_reason: str,
        briefing_for_owner: str,
        estimated_value_dkk: float,
    ) -> str:
        """
        Must be called for angry_customer, high_value_emergency, or ai_unanswered_question.
        """
        try:
            # 1. Update Contact Stage
            self.db.update_crm_stage(self.contact_id, "dire_escalated", 90, briefing_for_owner)

            # 2. Transition Call Log to Hold State
            self.db.update_call_status(
                room_name=self.room_name,
                status="dire_hold_for_owner",
                dire_reason=dire_reason,
                briefing=briefing_for_owner,
            )

            contact = self.db.get_contact_by_id(self.contact_id) or {}

            # 3. Emit Realtime Alert to Owner's Screen
            call_log_id = self.room_name.replace("call_", "").replace("room_", "")
            self.db.trigger_ui_event(
                self.tenant_id,
                "TRIGGER_DIRE_MODAL",
                {
                    "callLogId": call_log_id,
                    "customerName": contact.get("full_name", "Caller"),
                    "phoneNumber": contact.get("phone_number", "+45..."),
                    "reason": dire_reason,
                    "estimatedValueDkk": estimated_value_dkk,
                    "aiBriefing": briefing_for_owner,
                },
            )

            # 4. Graceful Holding Protocol: Launch monitor loop
            asyncio.create_task(self._monitor_hold_state())

            return "Escalation triggered. Owner's device is ringing. Inform the user you are putting them on hold and connecting the owner."
        except Exception as e:
            return f"Failed to trigger escalation: {e}"
