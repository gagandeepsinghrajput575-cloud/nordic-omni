"""Provision a LiveKit SIP inbound trunk + dispatch rule for a FlyNumber DID.

This configures the LiveKit side only. FlyNumber must forward the same DID to the
LiveKit SIP URI shown by `lk sip inbound` / LiveKit Cloud.

Review with --dry-run first:
  .venv/bin/python scripts/setup_livekit_sip.py --config ../clients/client-01-dansk-byg/client.config.json --did +45... --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import pathlib
import sys

from dotenv import dotenv_values
from livekit import api

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.client_config import load_client_config
from services.phone import normalize_phone


def livekit_http_url(value: str) -> str:
    return value.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")


async def provision(config_path: pathlib.Path, did: str, dry_run: bool) -> None:
    config = load_client_config(config_path)
    normalized = normalize_phone(did)
    if not normalized:
        raise SystemExit("Invalid DID")

    env = dotenv_values(ROOT / ".env")
    url = livekit_http_url(os.getenv("LIVEKIT_URL") or env.get("LIVEKIT_URL") or "")
    key = os.getenv("LIVEKIT_API_KEY") or env.get("LIVEKIT_API_KEY")
    secret = os.getenv("LIVEKIT_API_SECRET") or env.get("LIVEKIT_API_SECRET")
    if not (url and key and secret):
        raise SystemExit("LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required")

    metadata = json.dumps({"tenant_id": config["id"]})
    room_prefix = f"{config['slug']}-sip-"
    trunk_name = f"{config['slug']} inbound"
    rule_name = f"{config['slug']} dispatch"
    agent_name = os.getenv("LIVEKIT_AGENT_NAME", "nordic-omni").strip() or "nordic-omni"

    if dry_run:
        print(json.dumps({
            "url": url,
            "trunk": {"name": trunk_name, "numbers": [normalized], "metadata": metadata},
            "dispatch_rule": {
                "name": rule_name,
                "room_prefix": room_prefix,
                "metadata": metadata,
                "agent_name": agent_name,
            },
        }, indent=2))
        return

    async with api.LiveKitAPI(url, key, secret) as client:
        trunks = await client.sip.list_sip_inbound_trunk(api.ListSIPInboundTrunkRequest())
        existing = next(
            (trunk for trunk in trunks.items if normalized in list(trunk.numbers)),
            None,
        )
        if existing:
            trunk_id = existing.sip_trunk_id
            print("reusing_inbound_trunk", trunk_id)
        else:
            trunk = await client.sip.create_sip_inbound_trunk(
                api.CreateSIPInboundTrunkRequest(
                    trunk=api.SIPInboundTrunkInfo(
                        name=trunk_name,
                        numbers=[normalized],
                        metadata=metadata,
                    )
                )
            )
            trunk_id = trunk.sip_trunk_id
            print("created_inbound_trunk", trunk_id)

        rules = await client.sip.list_sip_dispatch_rule(api.ListSIPDispatchRuleRequest())
        existing_rule = next(
            (rule for rule in rules.items if normalized in list(rule.inbound_numbers)),
            None,
        )
        if existing_rule:
            print("reusing_dispatch_rule", existing_rule.sip_dispatch_rule_id)
            return

        rule = await client.sip.create_sip_dispatch_rule(
            api.CreateSIPDispatchRuleRequest(
                dispatch_rule=api.SIPDispatchRuleInfo(
                    name=rule_name,
                    metadata=metadata,
                    trunk_ids=[trunk_id],
                    inbound_numbers=[normalized],
                    rule=api.SIPDispatchRule(
                        dispatch_rule_individual=api.SIPDispatchRuleIndividual(
                            room_prefix=room_prefix,
                        )
                    ),
                    room_config=api.RoomConfiguration(
                        agents=[api.RoomAgentDispatch(agent_name=agent_name)],
                        metadata=metadata,
                    ),
                )
            )
        )
        print("created_dispatch_rule", rule.sip_dispatch_rule_id)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=pathlib.Path, required=True)
    parser.add_argument("--did", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(provision(args.config, args.did, args.dry_run))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
