"""Real PostgreSQL regression for the recording metadata write.

Run explicitly: RUN_DB_TESTS=1 .venv/bin/python -m unittest tests.test_recording_db_integration
"""

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
class RecordingDatabaseIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = Database(os.environ.get("DATABASE_URL") or dotenv_values(ROOT / ".env")["DATABASE_URL"])
        await self.db.connect()
        self.room = f"repair-test-{uuid.uuid4()}"

    async def asyncTearDown(self):
        await self.db.pool.execute("delete from call_logs where room_name = $1", self.room)
        await self.db.close()

    async def test_ok_recording_sets_url_and_status_in_one_statement(self):
        await self.db.ensure_call_log(
            tenant_id="11111111-1111-4111-8111-111111111111",
            contact_id="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            room_name=self.room,
            channel="voice_instant_webrtc",
        )
        await self.db.set_recording(
            room_name=self.room,
            tenant_id="11111111-1111-4111-8111-111111111111",
            status="ok",
            path="/tmp/fake.ogg",
            recorded_bytes=52139,
        )
        row = await self.db.pool.fetchrow(
            "select id, recording_status, recording_url, recording_bytes from call_logs where room_name = $1",
            self.room,
        )
        self.assertEqual(row["recording_status"], "ok")
        self.assertEqual(row["recording_url"], f"/api/recordings/{row['id']}")
        self.assertEqual(row["recording_bytes"], 52139)


if __name__ == "__main__":
    unittest.main()
