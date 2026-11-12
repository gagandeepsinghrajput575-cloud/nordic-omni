"""Database-query scope regressions, using a capture-only asyncpg boundary."""

from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.db import Database  # noqa: E402


class CaptureContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class CapturePool:
    def __init__(self):
        self.calls = []
        self.row = None
        self.results = []

    def acquire(self):
        return CaptureContext(self)

    def transaction(self):
        return CaptureContext(self)

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        return self.row

    async def execute(self, query, *args):
        self.calls.append((query, args))
        return self.results.pop(0) if self.results else "UPDATE 1"


class DatabaseSecurityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = Database("postgres://unused")
        self.pool = CapturePool()
        self.db._pool = self.pool

    async def test_contact_read_requires_tenant_and_contact(self):
        await self.db.get_contact("contact-id", "tenant-id")
        query, args = self.pool.calls[0]
        self.assertIn("tenant_id = $2", query)
        self.assertEqual(args, ("contact-id", "tenant-id"))

    async def test_stage_write_requires_tenant_and_contact(self):
        await self.db.update_contact_stage("contact-id", "tenant-id", "qualified", 80, "scope")
        query, args = self.pool.calls[0]
        self.assertIn("tenant_id = $2", query)
        self.assertIn("'booked'", query)
        self.assertIn("'closed_won'", query)
        self.assertIn("'closed_lost'", query)
        self.assertEqual(args[:2], ("contact-id", "tenant-id"))

    async def test_finalization_is_scoped_and_sets_terminal_status(self):
        await self.db.finalise_call(
            tenant_id="tenant-id",
            room_name="unique-room",
            status="completed",
            turns=[],
            duration=12,
        )
        query, args = self.pool.calls[0]
        self.assertIn("status", query)
        self.assertIn("tenant_id = $2", query)
        self.assertEqual(args[:3], ("unique-room", "tenant-id", "completed"))
        self.assertIn("WHEN status IN ('completed', 'missed') THEN status", query)

    async def test_call_claim_is_atomic_and_cannot_revive_terminal_status(self):
        self.pool.row = {"id": "call-id"}
        result = await self.db.ensure_call_log(
            tenant_id="tenant-id",
            contact_id="contact-id",
            room_name="unique-room",
            channel="voice_instant_webrtc",
        )
        self.assertEqual(result, "call-id")
        self.assertEqual(len(self.pool.calls), 1)
        query, args = self.pool.calls[0]
        self.assertIn("ON CONFLICT (room_name) DO UPDATE", query)
        self.assertIn("WHEN call_logs.status IN ('completed', 'missed')", query)
        self.assertIn("call_logs.tenant_id = $1", query)
        self.assertEqual(args[:3], ("tenant-id", "contact-id", "unique-room"))

    async def test_late_escalation_cannot_overwrite_terminal_status(self):
        await self.db.update_call_status(
            room_name="unique-room",
            tenant_id="tenant-id",
            status="dire_hold_for_owner",
        )
        query, _ = self.pool.calls[0]
        self.assertIn("status NOT IN ('completed', 'missed')", query)

    async def test_transcript_write_requires_room_and_tenant(self):
        await self.db.set_transcript(
            room_name="unique-room", tenant_id="tenant-id", turns=[], duration=4
        )
        query, args = self.pool.calls[0]
        self.assertIn("WHERE room_name = $1 AND tenant_id = $2", query)
        self.assertEqual(args[:2], ("unique-room", "tenant-id"))

    async def test_escalation_and_notification_are_tenant_scoped(self):
        self.pool.row = {"id": "escalation-id"}
        result = await self.db.record_escalation(
            tenant_id="tenant-id", contact_id="contact-id", channel="voice_inbound",
            reason="human_requested", urgency=3, briefing="brief", payload={},
        )
        self.assertEqual(result, "escalation-id")
        query, args = self.pool.calls[0]
        self.assertIn("WHERE id = $2 AND tenant_id = $1", query)
        self.assertEqual(args[:2], ("tenant-id", "contact-id"))

        await self.db.set_escalation_notification(
            "escalation-id", tenant_id="tenant-id", delivered=True
        )
        query, args = self.pool.calls[1]
        self.assertIn("WHERE id = $1 AND tenant_id = $2", query)
        self.assertEqual(args[:2], ("escalation-id", "tenant-id"))

    async def test_call_claim_validates_contact_tenant_before_insert(self):
        self.pool.row = {"id": "call-id"}
        await self.db.ensure_call_log(
            tenant_id="tenant-id", contact_id="contact-id",
            room_name="unique-room", channel="voice_inbound",
        )
        query, _ = self.pool.calls[0]
        self.assertIn("WHERE EXISTS", query)
        self.assertIn("WHERE id = $2 AND tenant_id = $1", query)

    async def test_estimate_aborts_when_contact_is_outside_tenant(self):
        self.pool.results = ["UPDATE 0"]
        with self.assertRaisesRegex(RuntimeError, "outside the worker tenant"):
            await self.db.record_project_estimate(
                tenant_id="tenant-id", contact_id="other-contact", call_log_id=None,
                project_type="Tag", scope_details="10 m2", square_meters=10,
                estimated_min_dkk=1, estimated_max_dkk=2, estimated_value_dkk=2,
                scope_summary="summary", followup_notes="",
            )
        self.assertEqual(len(self.pool.calls), 1)

    async def test_estimate_validates_call_tenant_and_contact(self):
        self.pool.results = ["UPDATE 1", "INSERT 0 0"]
        with self.assertRaisesRegex(RuntimeError, "outside the worker tenant/contact"):
            await self.db.record_project_estimate(
                tenant_id="tenant-id", contact_id="contact-id", call_log_id="other-call",
                project_type="Tag", scope_details="10 m2", square_meters=10,
                estimated_min_dkk=1, estimated_max_dkk=2, estimated_value_dkk=2,
                scope_summary="summary", followup_notes="",
            )
        query, args = self.pool.calls[1]
        self.assertIn("WHERE id = $3 AND tenant_id = $1 AND contact_id = $2", query)
        self.assertEqual(args[:3], ("tenant-id", "contact-id", "other-call"))
        self.assertEqual(len(self.pool.calls), 2)  # no UI event after the aborted write

    async def test_inspection_aborts_before_event_on_tenant_mismatch(self):
        self.pool.results = ["INSERT 0 0"]
        with self.assertRaisesRegex(RuntimeError, "outside the worker tenant"):
            await self.db.request_inspection(
                tenant_id="tenant-id", contact_id="other-contact", call_log_id=None,
                requested_time_text="tirsdag", address="", notes="",
            )
        query, _ = self.pool.calls[0]
        self.assertIn("WHERE id = $2 AND tenant_id = $1", query)
        self.assertEqual(len(self.pool.calls), 1)


if __name__ == "__main__":
    unittest.main()
