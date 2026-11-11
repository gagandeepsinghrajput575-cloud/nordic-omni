"""Database-query scope regressions, using a capture-only asyncpg boundary."""

from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.db import Database  # noqa: E402


class CapturePool:
    def __init__(self):
        self.calls = []

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        return None

    async def execute(self, query, *args):
        self.calls.append((query, args))
        return "UPDATE 1"


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


if __name__ == "__main__":
    unittest.main()
