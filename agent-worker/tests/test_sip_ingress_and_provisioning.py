from __future__ import annotations

import json
import os
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from livekit import api  # noqa: E402
from main import read_metadata  # noqa: E402
from scripts import setup_livekit_sip as setup  # noqa: E402


class Participant:
    def __init__(self, *, metadata, attributes):
        self.metadata = json.dumps(metadata)
        self.attributes = attributes
        self.identity = "participant"


class Context:
    def __init__(self, participant):
        self.participant = participant
        self.job = types.SimpleNamespace(metadata=json.dumps({"tenant_id": "job-tenant"}))
        self.room = types.SimpleNamespace(metadata=json.dumps({"tenant_id": "room-tenant"}))


class SipMetadataTests(unittest.IsolatedAsyncioTestCase):
    async def test_carrier_attributes_override_crafted_sip_metadata(self):
        ctx = Context(Participant(
            metadata={
                "tenant_id": "attacker-tenant",
                "contact_id": "attacker-contact",
                "call_id": "attacker-call",
                "role": "owner_merged",
                "called_number": "+4500000000",
                "phone_number": "+4500000001",
            },
            attributes={
                "sip.callID": "real-call",
                "sip.trunkPhoneNumber": "0045 70 20 11 22",
                "sip.phoneNumber": "+45 22 33 44 55",
            },
        ))
        meta = await read_metadata(ctx)
        self.assertTrue(meta["_sip_transport"])
        self.assertEqual(meta["role"], "customer")
        self.assertEqual(meta["called_number"], "0045 70 20 11 22")
        self.assertEqual(meta["phone_number"], "+45 22 33 44 55")
        for key in ("tenant_id", "contact_id", "call_id"):
            self.assertNotIn(key, meta)

    async def test_metadata_cannot_manufacture_sip_transport(self):
        ctx = Context(Participant(
            metadata={"role": "owner_consult", "called_number": "+4570201122"},
            attributes={},
        ))
        meta = await read_metadata(ctx)
        self.assertFalse(meta["_sip_transport"])
        self.assertEqual(meta["role"], "owner_consult")

    async def test_sip_without_did_has_no_metadata_tenant_fallback(self):
        ctx = Context(Participant(
            metadata={"tenant_id": "must-not-be-used", "role": "owner"},
            attributes={"sip.callID": "call-without-did"},
        ))
        meta = await read_metadata(ctx)
        self.assertTrue(meta["_sip_transport"])
        self.assertIsNone(meta["called_number"])
        self.assertNotIn("tenant_id", meta)
        self.assertEqual(meta["role"], "customer")


class FakeSipService:
    def __init__(self, trunk, rule):
        self.trunk = trunk
        self.rule = rule
        self.updated_trunks = []
        self.updated_rules = []

    async def list_sip_inbound_trunk(self, _request):
        return types.SimpleNamespace(items=[self.trunk])

    async def list_sip_dispatch_rule(self, _request):
        return types.SimpleNamespace(items=[self.rule])

    async def update_inbound_trunk(self, trunk_id, trunk):
        self.updated_trunks.append((trunk_id, trunk))
        return trunk

    async def update_dispatch_rule(self, rule_id, rule):
        self.updated_rules.append((rule_id, rule))
        return rule

    async def create_sip_inbound_trunk(self, _request):
        raise AssertionError("stale trunk must be updated, not duplicated")

    async def create_sip_dispatch_rule(self, _request):
        raise AssertionError("stale rule must be updated, not duplicated")


class FakeClient:
    def __init__(self, sip):
        self.sip = sip

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


class ProvisioningTests(unittest.IsolatedAsyncioTestCase):
    async def test_stale_trunk_and_rule_are_reconciled_without_losing_settings(self):
        did = "+4570201122"
        trunk = api.SIPInboundTrunkInfo(
            sip_trunk_id="trunk-id",
            name="stale",
            numbers=["0045 70 20 11 22", "+4570201122", "+4511111111"],
            metadata='{"tenant_id":"old"}',
            auth_username="preserve-me",
        )
        rule = api.SIPDispatchRuleInfo(
            sip_dispatch_rule_id="rule-id",
            name="stale",
            trunk_ids=["wrong-trunk"],
            inbound_numbers=["0045 70 20 11 22"],
            metadata='{"tenant_id":"old"}',
            rule=api.SIPDispatchRule(
                dispatch_rule_individual=api.SIPDispatchRuleIndividual(room_prefix="old-")
            ),
            room_config=api.RoomConfiguration(metadata='{"old":true}'),
        )
        sip = FakeSipService(trunk, rule)
        config = {"id": "tenant-id", "slug": "dansk-byg"}
        env = {
            "LIVEKIT_URL": "wss://example.livekit.cloud",
            "LIVEKIT_API_KEY": "key",
            "LIVEKIT_API_SECRET": "secret",
        }
        with (
            patch.object(setup, "load_client_config", return_value=config),
            patch.object(setup, "dotenv_values", return_value=env),
            patch.object(setup.api, "LiveKitAPI", return_value=FakeClient(sip)),
            patch.dict(os.environ, {}, clear=True),
        ):
            await setup.provision(pathlib.Path("unused"), "0045 70 20 11 22", False)

        self.assertEqual(len(sip.updated_trunks), 1)
        self.assertEqual(len(sip.updated_rules), 1)
        updated_trunk = sip.updated_trunks[0][1]
        self.assertEqual(updated_trunk.auth_username, "preserve-me")
        self.assertIn("+4511111111", list(updated_trunk.numbers))
        self.assertIn(did, list(updated_trunk.numbers))
        self.assertEqual(list(updated_trunk.numbers).count(did), 1)
        self.assertEqual(json.loads(updated_trunk.metadata), {"tenant_id": "tenant-id"})

        updated_rule = sip.updated_rules[0][1]
        self.assertEqual(list(updated_rule.trunk_ids), ["trunk-id"])
        self.assertEqual(updated_rule.rule.dispatch_rule_individual.room_prefix, "dansk-byg-sip-")
        self.assertEqual(json.loads(updated_rule.room_config.metadata), {"tenant_id": "tenant-id"})
        self.assertEqual(updated_rule.room_config.agents[0].agent_name, "nordic-omni")

    async def test_duplicate_did_matches_fail_closed(self):
        first = api.SIPInboundTrunkInfo(numbers=["+4570201122"])
        second = api.SIPInboundTrunkInfo(numbers=["0045 70 20 11 22"])
        with self.assertRaisesRegex(RuntimeError, "ambiguous"):
            setup._matching_did([first, second], "numbers", "+4570201122")


if __name__ == "__main__":
    unittest.main()
