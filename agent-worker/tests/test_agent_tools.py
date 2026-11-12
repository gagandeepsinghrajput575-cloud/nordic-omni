"""Customer-tool behavior with an in-memory DB boundary (no development writes)."""

from __future__ import annotations

import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents.customer_agent import CustomerAgent  # noqa: E402


TENANT = {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Dansk Byg",
    "slug": "dansk-byg",
    "default_language": "da-DK",
    "customer_system_prompt": "Du er receptionist.",
    "pricing_catalog": [{
        "id": "proj-bath",
        "service": "Komplet Nyt Badeværelse",
        "price_dkk": 115000,
        "unit": "vejledende overslag (typisk 95.000 - 165.000 kr.)",
    }],
    "business_hours": {},
    "escalation_policy": {"emergency_keywords": ["tagskade"]},
}
CONTACT = {"id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "preferred_language": "da"}


class FakeDB:
    def __init__(self):
        self.estimate = None
        self.inspection = None
        self.events = []
        self.stage_updates = []
        self.call_log_claims = []
        self.escalation = None
        self.notification = None

    async def ensure_call_log(self, **kwargs):
        self.call_log_claims.append(kwargs)
        return "99999999-9999-4999-8999-999999999999"

    async def record_project_estimate(self, **kwargs):
        self.estimate = kwargs

    async def emit_event(self, *args):
        self.events.append(args)

    async def request_inspection(self, **kwargs):
        self.inspection = kwargs

    async def update_contact_stage(self, *args):
        self.stage_updates.append(args)

    async def update_call_status(self, **kwargs):
        self.stage_updates.append(kwargs)

    async def record_escalation(self, **kwargs):
        self.escalation = kwargs
        return "77777777-7777-4777-8777-777777777777"

    async def set_escalation_notification(self, escalation_id, **kwargs):
        self.notification = {"id": escalation_id, **kwargs}


class CustomerToolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = FakeDB()
        self.agent = CustomerAgent(
            tenant=TENANT,
            contact=CONTACT,
            db=self.db,
            room_name="dansk-byg_call_contact_attempt",
            knowledge="",
        )

    async def test_estimate_is_calculated_and_saved_as_a_structured_range(self):
        result = await self.agent.record_project_estimate(
            None,
            catalog_item_id="proj-bath",
            project_type="Badeværelse",
            scope_details="8 kvadratmeter i rækkehus",
            square_meters=8,
            followup_notes="Ønsker besigtigelse",
        )
        self.assertEqual(self.db.estimate["estimated_min_dkk"], 95000)
        self.assertEqual(self.db.estimate["estimated_max_dkk"], 165000)
        self.assertEqual(self.db.estimate["estimated_value_dkk"], 130000)
        self.assertIsNone(self.db.estimate["square_meters"])
        self.assertIn("ikke et bindende tilbud", result)

    async def test_inspection_is_a_request_not_a_fake_booking(self):
        result = await self.agent.request_inspection(
            None,
            requested_time_text="tirsdag formiddag",
            address="Lyngby",
            notes="Ring før besøget",
        )
        self.assertEqual(self.db.inspection["status"], "requested")
        self.assertNotIn("booket", result.lower())
        self.assertIn("ikke bekræftet", result.lower())

    async def test_generic_stage_tool_cannot_fabricate_a_booking(self):
        result = await self.agent.update_pipeline_stage(None, "booked", 90, "Kunden sagde tirsdag")
        self.assertIn("bekræftet", result.lower())
        self.assertEqual(self.db.stage_updates, [])

    async def test_escalation_is_persisted_without_claiming_a_live_transfer(self):
        result = await self.agent.trigger_dire_escalation(
            None,
            "angry_customer",
            "Kunden er vred over en regning og vil tale med ejeren.",
            45000,
        )
        self.assertIsNotNone(self.db.escalation)
        self.assertEqual(self.db.escalation["reason"], "angry_customer")
        self.assertIn("ikke etableret", result.lower())
        self.assertIn("registreret", result.lower())
        self.assertNotIn("live forbindelse er oprettet", result.lower())

    async def test_sip_channel_is_preserved_and_escalation_delivery_is_recorded(self):
        sip_agent = CustomerAgent(
            tenant=TENANT,
            contact=CONTACT,
            db=self.db,
            room_name="sip-dansk-byg_call_contact_attempt",
            knowledge="",
            channel="voice_inbound",
        )
        with patch("agents.customer_agent.notify_owner_escalation", new=AsyncMock(return_value=(True, None))):
            result = await sip_agent.trigger_dire_escalation(
                None,
                "human_requested",
                "Kunden bad om at tale med ejeren.",
                60000,
            )
        self.assertEqual(self.db.call_log_claims[-1]["channel"], "voice_inbound")
        self.assertEqual(self.db.escalation["reason"], "human_requested")
        self.assertEqual(self.db.stage_updates[-1]["dire_reason"], "ai_unanswered_question")
        self.assertEqual(self.db.notification, {
            "id": "77777777-7777-4777-8777-777777777777",
            "tenant_id": TENANT["id"],
            "delivered": True,
            "error": None,
        })
        self.assertIn("kontorets arbejdsgang", result.lower())


if __name__ == "__main__":
    unittest.main()
