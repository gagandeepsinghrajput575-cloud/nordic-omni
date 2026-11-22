import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from agents.customer_agent import CustomerAgent, build_prompt, load_brand_safety_policy
from services.db import Database


class TestCheck2VoicePolicy(unittest.IsolatedAsyncioTestCase):
    def test_load_brand_safety_policy(self):
        policy = load_brand_safety_policy()
        self.assertIn("Brand-Safety & Customer Interaction Policy", policy)
        self.assertIn("Calm, Polite & Neutral Posture", policy)
        self.assertIn("Zero Reciprocation of Hostility", policy)
        self.assertIn("Straight-to-Owner Escape Hatch", policy)
        self.assertIn("Competitive Neutrality", policy)
        self.assertIn("Remodeler Hidden Conditions & Budget Alignment", policy)

    def test_customer_agent_prompt_includes_brand_safety(self):
        tenant = {
            "id": "11111111-1111-1111-1111-111111111111",
            "name": "København Tømrer ApS",
            "business_name": "København Tømrer ApS",
            "services": ["Tagarbejde", "Vinduer"],
            "service_areas": ["København"],
            "pricing_catalog": [
                {
                    "id": "item-tag",
                    "service": "Nyt tag",
                    "unit": "m2 (typisk 1.200 - 1.800 kr./m²)",
                    "price_dkk": 1500,
                }
            ],
        }
        contact = {
            "id": "22222222-2222-2222-2222-222222222222",
            "name": "Mette Frederiksen",
            "phone": "+4512345678",
        }

        prompt = build_prompt(tenant=tenant, contact=contact, knowledge="Test knowledge")
        self.assertIn("BRAND-SAFETY & CUSTOMER INTERACTION POLICY", prompt)
        self.assertIn("Zero Reciprocation of Hostility", prompt)
        self.assertIn("Straight-to-Owner Escape Hatch", prompt)

    async def test_record_project_estimate_remodeler_guidance(self):
        tenant = {
            "id": "11111111-1111-1111-1111-111111111111",
            "name": "København Tømrer ApS",
            "business_name": "København Tømrer ApS",
            "pricing_catalog": [
                {
                    "id": "item-bad",
                    "service": "Nyt badeværelse",
                    "unit": "vejledende overslag (typisk 95.000 - 165.000 kr.)",
                    "price_dkk": 115000,
                }
            ],
        }
        contact = {
            "id": "22222222-2222-2222-2222-222222222222",
            "name": "Jens Hansen",
            "phone": "+4587654321",
        }
        db = MagicMock(spec=Database)
        db.ensure_call_log = AsyncMock(return_value="call-log-123")
        db.record_project_estimate = AsyncMock(return_value="est-123")

        agent = CustomerAgent(
            tenant=tenant,
            contact=contact,
            db=db,
            room_name="test-room",
            knowledge="Test knowledge",
            channel="voice_inbound",
        )

        ctx = MagicMock()
        response = await agent.record_project_estimate(
            context=ctx,
            catalog_item_id="item-bad",
            project_type="Badeværelse",
            scope_details="10 m2 flisearbejde",
            square_meters=10.0,
            followup_notes="Ring efter kl 16",
        )

        # Check required remodeler hidden conditions and budget alignment warning
        self.assertIn("skjulte forhold", response)
        self.assertIn("fugtskader under gulv", response)
        self.assertIn("fysisk besigtigelse", response)
        self.assertIn(
            "Passer det vejledende prisspænd nogenlunde med det budget, du havde i tankerne?",
            response,
        )

    async def test_db_service_record_project_estimate_schedules_followups(self):
        db = Database(dsn="postgresql://localhost:5432/mock")
        mock_pool = MagicMock()
        mock_conn = AsyncMock()

        class AsyncContextManager:
            async def __aenter__(self):
                return mock_conn

            async def __aexit__(self, exc_type, exc_val, exc_tb):
                return None

        mock_pool.acquire = MagicMock(return_value=AsyncContextManager())
        mock_conn.transaction = MagicMock(return_value=AsyncContextManager())

        mock_conn.execute = AsyncMock(
            side_effect=[
                "UPDATE 1",  # contacts update
                "INSERT 0 1",  # project_estimates insert
                "INSERT 0 1",  # ui_command_events insert
                "UPDATE 1",  # followup_sequences cancel
                "INSERT 0 2",  # followup_sequences insert
            ]
        )

        db._pool = mock_pool

        await db.record_project_estimate(
            tenant_id="11111111-1111-1111-1111-111111111111",
            contact_id="22222222-2222-2222-2222-222222222222",
            call_log_id="call-123",
            project_type="Badeværelse",
            scope_details="10 m2",
            square_meters=10.0,
            estimated_min_dkk=100000,
            estimated_max_dkk=200000,
            estimated_value_dkk=150000,
            scope_summary="Overslag summary",
            followup_notes="Ingen",
            lead_score=85,
        )

        # Verify SQL executions included cancel existing and insert 2 followup sequence steps
        executed_sqls = [call.args[0] for call in mock_conn.execute.call_args_list]
        self.assertTrue(
            any("UPDATE followup_sequences" in sql for sql in executed_sqls),
            "Must cancel pending followups",
        )
        self.assertTrue(
            any("INSERT INTO followup_sequences" in sql for sql in executed_sqls),
            "Must insert new followup steps",
        )


if __name__ == "__main__":
    unittest.main()
