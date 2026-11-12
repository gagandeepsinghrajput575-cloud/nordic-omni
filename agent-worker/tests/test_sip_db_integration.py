"""Real PostgreSQL test for FlyNumber DID routing and caller creation."""

from __future__ import annotations

import os
import pathlib
import sys
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import dotenv_values  # noqa: E402

from services.db import Database  # noqa: E402


@unittest.skipUnless(os.getenv("RUN_DB_TESTS") == "1", "set RUN_DB_TESTS=1")
class SipDatabaseIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = Database(os.environ.get("DATABASE_URL") or dotenv_values(ROOT / ".env")["DATABASE_URL"])
        await self.db.connect()
        self.tenant_id = str(uuid.uuid4())
        self.did = f"+4599{uuid.uuid4().int % 10_000_000:07d}"
        await self.db.pool.execute(
            """
            insert into tenants (id, name, slug, owner_name, owner_phone, owner_email, flynumber_did)
            values ($1, 'SIP Routing Test', $2, 'Test Owner', '+4511111111', 'sip-test@example.com', $3)
            """,
            self.tenant_id,
            f"sip-test-{self.tenant_id[:8]}",
            self.did.replace("+45", "0045 ", 1),
        )

    async def asyncTearDown(self):
        await self.db.pool.execute("delete from tenants where id = $1", self.tenant_id)
        await self.db.close()

    async def test_did_finds_tenant_and_creates_contact_once(self):
        tenant = await self.db.get_tenant_by_did(self.did.replace("+45", "+45 "))
        self.assertIsNotNone(tenant)
        self.assertEqual(str(tenant["id"]), self.tenant_id)

        caller = "+4522334455"
        first = await self.db.get_or_create_inbound_contact(
            tenant_id=self.tenant_id, phone=caller, language="da"
        )
        second = await self.db.get_or_create_inbound_contact(
            tenant_id=self.tenant_id, phone=caller, language="da"
        )
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["preferred_channel"], "voice_inbound")
        self.assertEqual(first["phone_number"], caller)

    async def test_voice_transcript_is_idempotent_cross_channel_memory(self):
        contact = await self.db.get_or_create_inbound_contact(
            tenant_id=self.tenant_id, phone="+4522334466", language="da"
        )
        room = f"sip-test-{uuid.uuid4()}"
        await self.db.pool.execute(
            """
            insert into call_logs (tenant_id, contact_id, room_name, channel, status)
            values ($1, $2, $3, 'voice_inbound', 'completed')
            """,
            self.tenant_id,
            contact["id"],
            room,
        )
        turns = [
            {"role": "assistant", "content": "Goddag, hvad kan jeg hjælpe med?"},
            {"role": "user", "content": "Jeg vil gerne have et nyt tag."},
        ]
        await self.db.persist_transcript_messages(
            tenant_id=self.tenant_id, room_name=room, turns=turns
        )
        await self.db.persist_transcript_messages(
            tenant_id=self.tenant_id, room_name=room, turns=turns
        )

        rows = await self.db.pool.fetch(
            """
            select sender, channel::text as channel, content
            from messages where tenant_id = $1 and contact_id = $2
            order by created_at, content
            """,
            self.tenant_id,
            contact["id"],
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual([row["sender"] for row in rows], ["ai", "customer"])
        self.assertTrue(all(row["channel"] == "voice_inbound" for row in rows))

        recent = await self.db.get_recent_messages(
            self.tenant_id, str(contact["id"]), limit=5
        )
        self.assertEqual(len(recent), 2)
        self.assertIn("nyt tag", recent[-1]["content"])


if __name__ == "__main__":
    unittest.main()
