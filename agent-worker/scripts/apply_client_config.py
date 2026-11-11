"""Idempotently apply validated client facts and voice selection to PostgreSQL.

Usage (from agent-worker/):
    .venv/bin/python scripts/apply_client_config.py ../clients/<slug>/client.config.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import pathlib
import sys

from dotenv import dotenv_values

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import asyncpg  # noqa: E402

from services.client_config import ConfigError, load_client_config  # noqa: E402
from services.phone import normalize_phone  # noqa: E402


def default_prompts(config: dict) -> tuple[str, str, str]:
    danish = str(config["language"]).startswith("da")
    name = config["name"]
    industry = config.get("industry") or ("service" if not danish else "servicefag")
    if danish:
        customer = (
            f"Du er AI-receptionisten for {name}. Tal naturligt dansk. "
            "Afdæk opgavens omfang, brug kun den konfigurerede prisliste, og kald "
            "record_project_estimate for at beregne et vejledende overslag. "
            "Det er altid et vejledende overslag, ikke et bindende tilbud. "
            "Tilbyd en gratis uforpligtende besigtigelse. Bekræft aldrig en tid "
            "uden en faktisk aftale; request_inspection registrerer kun en anmodning."
        )
        copilot = f"Du er den korte, præcise drifts-co-pilot for indehaveren af {name}."
        greeting = f"Goddag, du er kommet til {name}. Hvad kan vi hjælpe dig med?"
    else:
        customer = (
            f"You are the AI receptionist for {name}. Scope the work, use only the "
            "configured price catalog, and call record_project_estimate for a calculated "
            "non-binding range. Offer a free inspection. Never claim a confirmed "
            "appointment; request_inspection only records a request."
        )
        copilot = f"You are the brief operational co-pilot for the owner of {name}."
        greeting = f"Hello, you have reached {name}. How can we help?"
    return customer, copilot, greeting


async def apply(config: dict) -> None:
    dsn = os.environ.get("DATABASE_URL") or dotenv_values(ROOT / ".env").get("DATABASE_URL")
    if not dsn:
        raise ConfigError("DATABASE_URL is required")
    owner = config["owner"]
    language = config["language"]
    customer, copilot, greeting = default_prompts(config)

    conn = await asyncpg.connect(dsn)
    try:
        async with conn.transaction():
            existing = await conn.fetchrow(
                "select id from tenants where slug = $1 and id <> $2",
                config["slug"], config["id"],
            )
            if existing:
                raise ConfigError("slug is already owned by another tenant")
            await conn.execute(
                """
                INSERT INTO tenants (
                  id, name, slug, owner_name, owner_email, owner_phone,
                  default_language, business_hours, pricing_catalog,
                  active_broadcast_message, flynumber_did, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,now())
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name,
                  slug = EXCLUDED.slug,
                  owner_name = EXCLUDED.owner_name,
                  owner_email = EXCLUDED.owner_email,
                  owner_phone = EXCLUDED.owner_phone,
                  default_language = EXCLUDED.default_language,
                  business_hours = EXCLUDED.business_hours,
                  pricing_catalog = EXCLUDED.pricing_catalog,
                  active_broadcast_message = EXCLUDED.active_broadcast_message,
                  flynumber_did = EXCLUDED.flynumber_did,
                  updated_at = now()
                """,
                config["id"], config["name"], config["slug"], owner["name"],
                owner["email"], owner["phone"], language,
                json.dumps(config["business_hours"]),
                json.dumps(config["pricing_catalog"]),
                config.get("standing_notice"),
                normalize_phone((config.get("telephony") or {}).get("did")),
            )
            await conn.execute(
                """
                INSERT INTO tenant_agent_config (
                  tenant_id, customer_system_prompt, copilot_system_prompt,
                  greeting_script, voice_id, stt_language, escalation_policy
                ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
                ON CONFLICT (tenant_id) DO UPDATE SET
                  voice_id = EXCLUDED.voice_id,
                  stt_language = EXCLUDED.stt_language,
                  escalation_policy = EXCLUDED.escalation_policy,
                  updated_at = now()
                """,
                config["id"], customer, copilot, greeting,
                config.get("voice_id"), language,
                json.dumps(config["escalation_policy"]),
            )
    finally:
        await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=pathlib.Path)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    try:
        config = load_client_config(args.config)
        if args.validate_only:
            print(f"VALID: {config['name']} ({config['slug']})")
        else:
            asyncio.run(apply(config))
            print(f"APPLIED: {config['name']} ({config['slug']})")
        return 0
    except ConfigError as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
