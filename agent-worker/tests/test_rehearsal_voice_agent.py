"""Integration test for Option A Dress Rehearsal: Aarhus Murer & VVS ApS voice agent.

Tests:
1. Loads tenant and contact for Aarhus Murer & VVS from PostgreSQL.
2. Checks prompt isolation: zero mentions of Dansk Byg/Morten/Lyngby; business name is Aarhus Murer & VVS.
3. Checks Danish greeting with mandatory recording consent.
4. Executes `record_project_estimate` verifying non-binding overslag (inkl. 25% moms).
5. Executes `send_photo_upload_link` verifying HMAC token generation and honest communication.
6. Synthesizes Danish audio via SafeAzureTTS (da-DK-ChristelNeural) to verify live audio stream.
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys
from dotenv import load_dotenv

load_dotenv()

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents.customer_agent import CustomerAgent, build_prompt, greeting_for
from agents.azure_tts import SafeAzureTTS
from config import load as load_config
from services.db import Database

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  [PASS] {label}")
    else:
        print(f"  [FAIL] {label} {detail}")
        failures.append(label)


async def main():
    print("\n======================================================")
    print("STEP 3 (Part B): Live Voice Agent Integration & TTS")
    print("======================================================")

    dsn = os.getenv("DATABASE_URL", "postgres://postgres@127.0.0.1:54330/nordic_omni")
    db = Database(dsn)
    await db.connect()

    # 1. Fetch Aarhus Murer tenant
    tenants = await db.pool.fetch("select id from tenants where slug = 'aarhus-murer-vvs'")
    check("Aarhus Murer tenant exists in database", len(tenants) > 0)
    tenant_id = str(tenants[0]["id"])
    tenant = await db.get_tenant(tenant_id)
    check("Tenant loaded with agent config", tenant is not None)

    check("Tenant name is Aarhus Murer & VVS ApS", tenant.get("name") == "Aarhus Murer & VVS ApS")
    check("Owner is Frederik Holm", tenant.get("owner_name") == "Frederik Holm")
    check("Default language is da-DK", tenant.get("default_language") == "da-DK")

    # 2. Fetch contact
    contacts = await db.pool.fetch("select * from contacts where tenant_id = $1 limit 1", tenant["id"])
    check("Contact exists for tenant", len(contacts) > 0)
    contact = dict(contacts[0])

    # 3. Prompt Isolation
    knowledge_str = await db.get_knowledge(tenant_id)
    prompt = build_prompt(tenant, contact, knowledge_str)

    check("Prompt contains Aarhus Murer & VVS", "Aarhus Murer & VVS" in prompt)
    check("Prompt does NOT contain Dansk Byg", "Dansk Byg" not in prompt)
    check("Prompt does NOT contain Morten", "Morten" not in prompt)
    check("Prompt does NOT contain Lyngby", "Lyngby" not in prompt)
    check("Prompt contains vejledende overslag", "vejledende overslag" in prompt)
    check("Prompt specifies non-binding offer rule", "bindende" in prompt)

    # 4. Danish Greeting
    greeting = greeting_for(tenant, contact)
    check("Greeting contains business name", "Aarhus Murer" in greeting)
    check("Greeting contains recording consent", "optages" in greeting or "optaget" in greeting)

    # 5. CustomerAgent execution: record_project_estimate
    agent = CustomerAgent(
        tenant=tenant,
        contact=contact,
        db=db,
        room_name="test_room_aarhus_murer",
        knowledge=knowledge_str,
    )

    estimate_result = await agent.record_project_estimate(
        None,
        catalog_item_id="nyt-bad",
        project_type="Badeværelse",
        scope_details="8 m² nyt badeværelse i Risskov, fliser og vådrumssikring",
        square_meters=8,
        followup_notes="Kunden ønsker vejledende overslag inden besigtigelse.",
    )

    check("Estimate returns non-binding disclaimer", "ikke et bindende tilbud" in estimate_result)
    check("Estimate indicates moms inclusion", "inkl. 25% moms" in estimate_result or "moms" in estimate_result)

    # 6. CustomerAgent execution: send_photo_upload_link
    link_result = await agent.send_photo_upload_link(None, project_description="Badeværelse fotos")
    check("Photo upload link generated", "/media/upload?token=" in link_result)
    check("Does not claim false SMS delivery", "SMS er sendt til mobilnettet" not in link_result)

    # 7. Live Danish TTS Audio Synthesis via Azure Neural Voice
    cfg = load_config()
    tts = SafeAzureTTS(
        voice="da-DK-ChristelNeural",
        language="da-DK",
        speech_key=cfg.azure_speech_key,
        speech_region=cfg.azure_speech_region,
    )

    audio_frames = 0
    stream = tts.synthesize(greeting)
    async for _frame in stream:
        audio_frames += 1

    check(
        "Azure Danish TTS synthesized greeting audio frames",
        audio_frames > 20,
        f"Frame count: {audio_frames}",
    )

    await db.close()

    print("\n======================================================")
    if failures:
        print(f"VOICE AGENT REHEARSAL FAILED ({len(failures)} failures):")
        for f in failures:
            print(f" - {f}")
        sys.exit(1)
    else:
        print("ALL VOICE AGENT REHEARSAL CHECKS PASSED (100% GREEN)!")
        print("======================================================")


if __name__ == "__main__":
    asyncio.run(main())
