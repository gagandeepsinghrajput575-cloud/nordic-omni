from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.phone import forward_sip_call, normalize_phone  # noqa: E402

try:
    from livekit import api
except ImportError:
    api = None


class PhoneTests(unittest.TestCase):
    def test_e164_normalization(self):
        self.assertEqual(normalize_phone("+45 70 20 11 22"), "+4570201122")
        self.assertEqual(normalize_phone("0045 70 20 11 22"), "+4570201122")
        self.assertEqual(normalize_phone("(45) 70-20-11-22"), "+4570201122")

    def test_international_prefix_and_punctuation_have_one_canonical_form(self):
        expected = "+4570201122"
        for value in (
            "0045 70 20 11 22",
            "+45 (70) 20-11-22",
            "45.70.20.11.22",
            "++45 70 20 11 22",
        ):
            self.assertEqual(normalize_phone(value), expected)

    def test_sql_index_uses_the_same_00_and_digits_rules(self):
        root = pathlib.Path(__file__).resolve().parents[2]
        migration_dir = root / "db" / "migrations"
        parity_file = next(
            (p.name for p in migration_dir.glob("*phone_normalization_parity.sql")),
            "0017_phone_normalization_parity.sql",
        )
        for migration in (
            "0008_sip_inbound_routing.sql",
            "0009_unique_contact_phone.sql",
            parity_file,
        ):
            sql = (root / "db" / "migrations" / migration).read_text()
            self.assertIn("regexp_replace", sql)
            self.assertIn("[^0-9]", sql)
            self.assertIn("LIKE '00%'", sql)
            self.assertIn("substr(", sql)
            self.assertNotIn("[^0-9+]", sql)

    def test_garbage_is_rejected(self):
        self.assertIsNone(normalize_phone(""))
        self.assertIsNone(normalize_phone("not a phone"))
        self.assertIsNone(normalize_phone("123"))


class SipTransferTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_input_never_dials(self):
        ok, _ = await forward_sip_call("room", "sip-caller", "123")
        self.assertFalse(ok)
        ok, _ = await forward_sip_call("room", "", "+4522334455")
        self.assertFalse(ok)

    @unittest.skipIf(api is None, "install agent-worker requirements for the SDK contract")
    async def test_only_a_confirmed_provider_result_counts_as_success(self):
        env = {"LIVEKIT_URL": "wss://example.invalid", "LIVEKIT_API_KEY": "test", "LIVEKIT_API_SECRET": "test"}
        for status, expected in (
            (api.SIPTransferStatus.STS_TRANSFER_SUCCESSFUL, True),
            (api.SIPTransferStatus.STS_TRANSFER_FAILED, False),
        ):
            client = AsyncMock()
            client.__aenter__.return_value = client
            client.sip.transfer_sip_participant.return_value = SimpleNamespace(status=status, reason="test")
            with patch.dict("os.environ", env), patch.object(api, "LiveKitAPI", return_value=client):
                ok, _ = await forward_sip_call("room", "sip Caller", "+45 22 33 44 55")
            self.assertEqual(ok, expected)
            request = client.sip.transfer_sip_participant.call_args.args[0]
            self.assertEqual(request.room_name, "room")
            self.assertEqual(request.participant_identity, "sip Caller")
            self.assertEqual(request.transfer_to, "tel:+4522334455")
            self.assertTrue(request.play_dialtone)

    def test_entrypoint_uses_the_identity_resolved_from_the_room(self):
        source = (ROOT / "main.py").read_text()
        self.assertIn('identity = str(meta.get("participant_identity") or "")', source)
        self.assertNotIn("participant = ctx.participant", source)


if __name__ == "__main__":
    unittest.main()
