import os
import uuid
import asyncio
from typing import Optional, Dict, Any
from supabase import create_client, Client


class SupabaseService:
    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise ValueError("Supabase credentials missing in environment.")
        self.client: Client = create_client(url, key)

    def is_valid_uuid(self, val: Any) -> bool:
        if not val or not isinstance(val, str):
            return False
        try:
            uuid.UUID(str(val))
            return True
        except (ValueError, AttributeError):
            return False

    def get_tenant_by_id(self, tenant_id: str) -> Optional[Dict[str, Any]]:
        if not self.is_valid_uuid(tenant_id):
            # Fallback to slug search if tenant_id is passed as slug
            res = self.client.table("tenants").select("*").eq("slug", tenant_id).limit(1).execute()
            return res.data[0] if res.data else None
        res = self.client.table("tenants").select("*").eq("id", tenant_id).limit(1).execute()
        return res.data[0] if res.data else None

    def get_contact_by_id(self, contact_id: str) -> Optional[Dict[str, Any]]:
        if not self.is_valid_uuid(contact_id):
            return None
        res = self.client.table("contacts").select("*").eq("id", contact_id).limit(1).execute()
        return res.data[0] if res.data else None

    def get_contact_by_phone(self, tenant_id: str, phone: str) -> Optional[Dict[str, Any]]:
        if not self.is_valid_uuid(tenant_id):
            tenant = self.get_tenant_by_id(tenant_id)
            if tenant:
                tenant_id = tenant["id"]
            else:
                return None

        res = (
            self.client.table("contacts")
            .select("*")
            .eq("tenant_id", tenant_id)
            .eq("phone_number", phone)
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None

    def get_knowledge_base(self, tenant_id: str) -> str:
        if not self.is_valid_uuid(tenant_id):
            tenant = self.get_tenant_by_id(tenant_id)
            if tenant:
                tenant_id = tenant["id"]
            else:
                return "No custom knowledge overrides active."

        res = (
            self.client.table("knowledge_items")
            .select("*")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .execute()
        )
        if not res.data:
            return "No custom knowledge overrides active."
        return "\n".join([f"- {item['title']}: {item['content']}" for item in res.data])

    def update_crm_stage(self, contact_id: str, new_stage: str, lead_score: int, memory_update: str):
        if not self.is_valid_uuid(contact_id):
            print(f"Skipping update_crm_stage for non-UUID contact ID: {contact_id}")
            return

        self.client.table("contacts").update({
            "pipeline_stage": new_stage,
            "lead_score": lead_score,
            "shared_memory_summary": memory_update,
            "updated_at": "now()"
        }).eq("id", contact_id).execute()

    def update_call_status(
        self,
        room_name: str,
        status: str,
        dire_reason: Optional[str] = None,
        briefing: Optional[str] = None,
    ):
        payload: Dict[str, Any] = {"status": status, "updated_at": "now()"}
        if dire_reason:
            payload["dire_reason"] = dire_reason
        if briefing:
            payload["summary"] = briefing
            payload["owner_instructions"] = briefing

        try:
            self.client.table("call_logs").update(payload).eq("room_name", room_name).execute()
        except Exception as e:
            print(f"Warning: Failed to update call_logs status for room {room_name}: {e}")

    def trigger_ui_event(self, tenant_id: str, command_type: str, payload: dict):
        if not self.is_valid_uuid(tenant_id):
            tenant = self.get_tenant_by_id(tenant_id)
            if tenant:
                tenant_id = tenant["id"]
            else:
                return

        self.client.table("ui_command_events").insert({
            "tenant_id": tenant_id,
            "command_type": command_type,
            "payload": payload
        }).execute()
