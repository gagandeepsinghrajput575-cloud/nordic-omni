from livekit.agents import llm
from services.supabase_service import SupabaseService


class KnowledgeTools(llm.FunctionContext):
    def __init__(self, tenant_id: str, db: SupabaseService):
        super().__init__()
        self.tenant_id = tenant_id
        self.db = db

    @llm.ai_callable(desc="Checks real-time pricing and availability schedules.")
    async def check_availability_and_pricing(self, query: str) -> str:
        try:
            tenant = self.db.get_tenant_by_id(self.tenant_id)
            if not tenant:
                return "Tenant record not found."
            knowledge = self.db.get_knowledge_base(self.tenant_id)
            return (
                f"Business Hours: {tenant.get('business_hours', 'Unknown')}\n"
                f"Pricing: {tenant.get('pricing_catalog', 'Unknown')}\n"
                f"Overrides: {knowledge}"
            )
        except Exception as e:
            return f"Error retrieving knowledge base: {e}"
