"""Idempotently provision one LiveKit SIP inbound DID and dispatch rule.

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
from typing import Any, Iterable

from dotenv import dotenv_values
from livekit import api

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.client_config import load_client_config
from services.phone import normalize_phone


def livekit_http_url(value: str) -> str:
    return value.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")


def _matching_did(items: Iterable[Any], field: str, did: str) -> Any | None:
    matches = [
        item
        for item in items
        if any(normalize_phone(str(number)) == did for number in getattr(item, field))
    ]
    if len(matches) > 1:
        raise RuntimeError(f"DID {did} is ambiguous across multiple SIP {field} entries")
    return matches[0] if matches else None


def _reconcile_numbers(existing: Iterable[str], did: str) -> list[str]:
    """Normalize and deduplicate the managed DID, preserving unrelated numbers."""
    numbers: list[str] = []
    for number in existing:
        canonical = did if normalize_phone(str(number)) == did else str(number)
        if canonical not in numbers:
            numbers.append(canonical)
    if did not in numbers:
        numbers.append(did)
    return numbers


def _trunk_info(
    trunk_name: str,
    metadata: str,
    did: str,
    existing: Any | None = None,
) -> api.SIPInboundTrunkInfo:
    info = api.SIPInboundTrunkInfo()
    if existing is not None:
        info.CopyFrom(existing)  # preserve auth/media/security configuration
    info.name = trunk_name
    info.metadata = metadata
    info.numbers[:] = _reconcile_numbers(
        existing.numbers if existing is not None else [], did
    )
    return info


def _dispatch_rule_info(
    *,
    rule_name: str,
    metadata: str,
    trunk_id: str,
    did: str,
    room_prefix: str,
    agent_name: str,
    existing: Any | None = None,
) -> api.SIPDispatchRuleInfo:
    info = api.SIPDispatchRuleInfo()
    if existing is not None:
        info.CopyFrom(existing)
    info.name = rule_name
    info.metadata = metadata
    info.trunk_ids[:] = [trunk_id]
    info.inbound_numbers[:] = _reconcile_numbers(
        existing.inbound_numbers if existing is not None else [], did
    )
    info.rule.CopyFrom(
        api.SIPDispatchRule(
            dispatch_rule_individual=api.SIPDispatchRuleIndividual(
                room_prefix=room_prefix,
            )
        )
    )

    # Preserve unrelated room settings but replace the tenant and agent atomically.
    info.room_config.metadata = metadata
    info.room_config.ClearField("agents")
    info.room_config.agents.append(api.RoomAgentDispatch(agent_name=agent_name))
    return info


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
        existing = _matching_did(trunks.items, "numbers", normalized)
        desired_trunk = _trunk_info(trunk_name, metadata, normalized, existing)
        if existing:
            trunk_id = existing.sip_trunk_id
            await client.sip.update_inbound_trunk(trunk_id, desired_trunk)
            print("updated_inbound_trunk", trunk_id)
        else:
            trunk = await client.sip.create_sip_inbound_trunk(
                api.CreateSIPInboundTrunkRequest(trunk=desired_trunk)
            )
            trunk_id = trunk.sip_trunk_id
            print("created_inbound_trunk", trunk_id)

        rules = await client.sip.list_sip_dispatch_rule(api.ListSIPDispatchRuleRequest())
        existing_rule = _matching_did(rules.items, "inbound_numbers", normalized)
        desired_rule = _dispatch_rule_info(
            rule_name=rule_name,
            metadata=metadata,
            trunk_id=trunk_id,
            did=normalized,
            room_prefix=room_prefix,
            agent_name=agent_name,
            existing=existing_rule,
        )
        if existing_rule:
            rule_id = existing_rule.sip_dispatch_rule_id
            await client.sip.update_dispatch_rule(rule_id, desired_rule)
            print("updated_dispatch_rule", rule_id)
        else:
            rule = await client.sip.create_sip_dispatch_rule(
                api.CreateSIPDispatchRuleRequest(dispatch_rule=desired_rule)
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
