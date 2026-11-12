from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents.azure_tts import SafeAzureTTS  # noqa: E402
from main import close_agent_session, release_call_slot, request_job, _call_slots  # noqa: E402
from services.call_slots import CallSlotRegistry  # noqa: E402


class CallSlotTests(unittest.TestCase):
    def test_fifty_way_contention_is_bounded_and_duplicate_release_is_safe(self):
        registry = CallSlotRegistry(50)
        ids = [f"job-{index}" for index in range(100)]
        with ThreadPoolExecutor(max_workers=20) as executor:
            acquired = list(executor.map(registry.acquire, ids))
        self.assertEqual(sum(acquired), 50)
        self.assertEqual(registry.active_count, 50)

        # Replaying acceptance for the same job cannot consume another slot.
        first = ids[acquired.index(True)]
        self.assertTrue(registry.acquire(first))
        self.assertEqual(registry.active_count, 50)

        with ThreadPoolExecutor(max_workers=20) as executor:
            list(executor.map(registry.release, ids))
            list(executor.map(registry.release, ids))
        self.assertEqual(registry.active_count, 0)
        self.assertTrue(registry.acquire("next-job"))

    def test_rejected_job_does_not_consume_capacity(self):
        registry = CallSlotRegistry(1)
        self.assertTrue(registry.acquire("one"))
        self.assertFalse(registry.acquire("two"))
        self.assertFalse(registry.release("two"))
        self.assertEqual(registry.active_count, 1)


class RequestLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_accept_releases_exactly_its_own_slot(self):
        job_id = "cancelled-accept"

        class Request:
            id = job_id

            async def accept(self):
                raise asyncio.CancelledError

            async def reject(self):
                raise AssertionError("should not reject after reservation")

        with self.assertRaises(asyncio.CancelledError):
            await request_job(Request())
        await release_call_slot(job_id)  # duplicate shutdown is harmless
        self.assertNotIn(job_id, _call_slots._job_ids)


class AudioResourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_tts_closes_live_streams_and_owned_http_session_once(self):
        class Stream:
            def __init__(self):
                self.close_calls = 0

            async def aclose(self):
                self.close_calls += 1

        class Session:
            def __init__(self):
                self.close_calls = 0
                self.closed = False

            async def close(self):
                self.close_calls += 1
                self.closed = True

        azure = SafeAzureTTS(
            voice="da-DK-ChristelNeural",
            speech_key="test",
            speech_region="westeurope",
        )
        stream = Stream()
        session = Session()
        azure._live_streams.add(stream)
        azure._session = session
        azure._owns_session = True

        await azure.aclose()
        await azure.aclose()
        self.assertEqual(stream.close_calls, 1)
        self.assertEqual(session.close_calls, 1)
        self.assertIsNone(azure._session)

    async def test_tts_is_closed_even_when_session_teardown_fails(self):
        class TTS:
            def __init__(self):
                self.closed = False

            async def aclose(self):
                self.closed = True

        class Session:
            def __init__(self):
                self.tts = TTS()

            async def aclose(self):
                raise RuntimeError("interrupted activity teardown")

        session = Session()
        with self.assertRaisesRegex(RuntimeError, "interrupted"):
            await close_agent_session(session)
        self.assertTrue(session.tts.closed)


if __name__ == "__main__":
    unittest.main()
