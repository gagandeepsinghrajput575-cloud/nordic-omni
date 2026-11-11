"""Real PostgreSQL regression for structured estimate persistence."""

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
class EstimationDatabaseIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = Database(os.environ.get("DATABASE_URL") or dotenv_values(ROOT / ".env")["DATABASE_URL"])
        await self.db.connect()
        self.contact_id = str(uuid.uuid4())
        await self.db.pool.execute(
            """
            insert into contacts (id, tenant_id, full_name, phone_number)
            values ($1, '11111111-1111-4111-8111-111111111111', 'Estimate Repair Test', $2)
            """,
            self.contact_id,
            f"+4599{uuid.uuid4().int % 10_000_000:07d}",
        )

    async def asyncTearDown(self):
        await self.db.pool.execute("delete from contacts where id = $1", self.contact_id)
        await self.db.close()

    async def test_estimate_history_and_headline_are_written_together(self):
        await self.db.record_project_estimate(
            tenant_id="11111111-1111-4111-8111-111111111111",
            contact_id=self.contact_id,
            call_log_id=None,
            project_type="Badeværelse",
            scope_details="8 kvadratmeter",
            square_meters=8,
            estimated_min_dkk=95000,
            estimated_max_dkk=165000,
            estimated_value_dkk=130000,
            scope_summary="Overslag: Badeværelse",
            followup_notes="Ønsker besigtigelse",
        )
        contact = await self.db.get_contact(
            self.contact_id, "11111111-1111-4111-8111-111111111111"
        )
        estimate = await self.db.pool.fetchrow(
            "select estimated_min_dkk::float8 as low, estimated_max_dkk::float8 as high, "
            "square_meters::float8 as square_meters from project_estimates where contact_id = $1",
            self.contact_id,
        )
        self.assertEqual(float(contact["estimated_value_dkk"]), 130000)
        self.assertEqual(contact["pipeline_stage"], "qualified")
        self.assertEqual((estimate["low"], estimate["high"], estimate["square_meters"]), (95000, 165000, 8))

    async def test_inspection_request_stays_unconfirmed(self):
        await self.db.request_inspection(
            tenant_id="11111111-1111-4111-8111-111111111111",
            contact_id=self.contact_id,
            call_log_id=None,
            requested_time_text="tirsdag formiddag",
            address="Lyngby",
            notes="Ring før besøget",
        )
        row = await self.db.pool.fetchrow(
            "select status from inspection_requests where contact_id = $1",
            self.contact_id,
        )
        self.assertEqual(row["status"], "requested")


if __name__ == "__main__":
    unittest.main()
