"""Regression contracts for defects found in the live-call audit."""

from __future__ import annotations

import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents.customer_agent import _business_hours, _price_block, escalation_block  # noqa: E402
from services.recordings import history_to_turns  # noqa: E402


class RepairContracts(unittest.TestCase):
    def test_raw_json_configuration_is_not_silently_discarded(self):
        hours = json.dumps({"mon": {"open": "07:00", "close": "17:00"}})
        prices = json.dumps([{"service": "Nyt tag", "price_dkk": 1800, "unit": "m2"}])
        policy = json.dumps({"emergency_keywords": ["tagskade"]})
        self.assertIn("mon", _business_hours({"business_hours": hours}))
        self.assertIn("1.800 DKK", _price_block({"pricing_catalog": prices}))
        self.assertIn("tagskade", escalation_block({"escalation_policy": policy}))

    def test_transcript_excludes_system_prompt_and_tool_internals(self):
        class Item:
            def __init__(self, role, content):
                self.role = role
                self.content = content

        class History:
            items = [
                Item("system", "secret agency prompt"),
                Item("assistant", "Goddag"),
                Item("user", "Nyt tag"),
                Item("tool", "internal database result"),
            ]

        turns = history_to_turns(History())
        self.assertEqual([turn["role"] for turn in turns], ["assistant", "user"])

    def test_shutdown_recording_wait_is_off_the_async_event_loop(self):
        source = (ROOT / "main.py").read_text()
        self.assertIn("asyncio.to_thread", source)

    def test_mandatory_greeting_is_spoken_verbatim(self):
        source = (ROOT / "main.py").read_text()
        customer_entrypoint = source.split('logger.info(\n        "Customer session', 1)[1]
        self.assertIn("session.say(", customer_entrypoint)
        self.assertNotIn("generate_reply(instructions=greeting_for", customer_entrypoint)

    def test_disconnected_calls_finalise_promptly(self):
        source = (ROOT / "main.py").read_text()
        self.assertIn('session.on("close"', source)
        self.assertIn("ctx.shutdown(", source)
        self.assertIn("session_end_timeout=", source)
        timeout = source.split("session_end_timeout=", 1)[1].split(",", 1)[0].strip()
        self.assertLessEqual(float(timeout), 30.0)


    def test_azure_plugin_is_imported_on_main_thread(self):
        source = (ROOT / "main.py").read_text()
        self.assertIn("from livekit.plugins import azure, silero", source)
        self.assertNotIn("from livekit.plugins import azure\n", source)

    def test_db_pool_is_scoped_to_the_job_event_loop(self):
        source = (ROOT / "main.py").read_text()
        self.assertIn("threading.local()", source)
        self.assertIn("_db_state.loop", source)
        self.assertIn("await close_db()", source)
        self.assertNotIn("global _db", source)

    def test_sip_detection_does_not_depend_on_a_single_carrier_field(self):
        source = (ROOT / "main.py").read_text()
        self.assertIn('sip_call_id") or called_number', source)
        self.assertIn('attributes.get("sip.trunkPhoneNumber")', source)

    def test_chat_and_voice_share_persisted_memory(self):
        main = (ROOT / "main.py").read_text()
        agent = (ROOT / "agents/customer_agent.py").read_text()
        self.assertIn("get_recent_messages", main)
        self.assertIn("persist_transcript_messages", main)
        self.assertIn("## CROSS-CHANNEL HISTORY", agent)
        self.assertIn("notify_owner_escalation", agent)

    def test_worker_concurrency_is_explicitly_bounded(self):
        source = (ROOT / "main.py").read_text()
        self.assertIn("request_fnc=request_job", source)
        self.assertIn("MAX_CONCURRENT_CALLS", source)
        self.assertIn("await request.reject(", source)
        self.assertIn("await request.accept(", source)
        self.assertIn("release_call_slot", source)


if __name__ == "__main__":
    unittest.main()
