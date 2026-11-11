"""Integration test for Client #1: Dansk Byg & Renovering ApS.

Tests:
1. Database loading of Client #1 (tenant_id = 11111111-1111-4111-8111-111111111111).
2. Proper formatting of prompt with Danish building trade terminology,
   ballpark estimates (vejledende overslag), BR18 vådrumssikring, and Morten Bondo contact info.
3. Execution of `record_project_estimate` updating contacts and pipeline_stage.
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents.customer_agent import CustomerAgent, build_prompt, greeting_for
from services.db import Database

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label} {detail}")
        failures.append(label)


async def main():
    if os.getenv("RUN_DB_TESTS") != "1":
        print("SKIP: this integration test writes to the pilot contact; set RUN_DB_TESTS=1 explicitly.")
        return

    print("\n=== 1. Connect to PostgreSQL and fetch Client #1 ===")
    dsn = os.getenv("DATABASE_URL", "postgres://postgres@127.0.0.1:54330/nordic_omni")
    db = Database(dsn)
    await db.connect()

    tenant_id = "11111111-1111-4111-8111-111111111111"
    tenant = await db.get_tenant(tenant_id)

    check("tenant loaded", tenant is not None)
    check("tenant is Dansk Byg & Renovering ApS", tenant.get("name") == "Dansk Byg & Renovering ApS")
    check("tenant slug is dansk-byg", tenant.get("slug") == "dansk-byg")
    check("owner is Morten Bondo", tenant.get("owner_name") == "Morten Bondo")
    check("default language is da-DK", tenant.get("default_language") == "da-DK")

    print("\n=== 2. Knowledge items & Pricing Catalog for Client #1 ===")
    knowledge_str = await db.get_knowledge(tenant_id)
    check("knowledge items found", len(knowledge_str) > 0, f"length: {len(knowledge_str)}")
    check("contains Vådrumssikring & BR18", "BR18" in knowledge_str)
    check("contains Uforpligtende Besigtigelse", "Besigtigelse" in knowledge_str)
    check("contains Betalingsbetingelser", "Betaling" in knowledge_str)

    catalog = tenant.get("pricing_catalog") or []
    check("pricing catalog has building items", len(catalog) >= 5, f"got {len(catalog)}")
    services = [p["service"] for p in catalog]
    check("catalog has Komplet Nyt Badeværelse", any("Badeværelse" in s for s in services))
    check("catalog has Tilbygning", any("Tilbygning" in s for s in services))
    check("catalog has Nyt Tag", any("Nyt Tag" in s for s in services))

    print("\n=== 3. Prompt generation with Danish Trade Terminology ===")
    contact = await db.get_contact("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", tenant_id)
    check("contact loaded (Henrik Nielsen)", contact is not None and "Henrik" in contact.get("full_name", ""))

    prompt = build_prompt(tenant, contact, knowledge_str)
    check("prompt contains Dansk Byg & Renovering", "Dansk Byg & Renovering" in prompt)
    check("prompt instructs vejledende overslag", "vejledende overslag" in prompt)
    check("prompt mentions vådrumssikring or BR18", "vådrumssikring" in prompt or "BR18" in prompt)
    check("prompt quotes bathroom price (115.000 DKK)", "115.000" in prompt)
    check("prompt quotes extension price (22.000 DKK)", "22.000" in prompt)
    check("prompt specifies non-binding offer rule", "bindende" in prompt)
    check("prompt instructs free inspection offer", "besigtigelse" in prompt)

    greeting = greeting_for(tenant, contact)
    check("greeting uses Danish script", "Dansk Byg & Renovering" in greeting)

    print("\n=== 4. Test record_project_estimate DB update ===")
    agent = CustomerAgent(
        tenant=tenant,
        contact=contact,
        db=db,
        room_name="test_room_dansk_byg",
        knowledge=knowledge_str,
    )

    result = await agent.record_project_estimate(
        None,  # RunContext
        catalog_item_id="proj-bath",
        project_type="Badeværelse",
        scope_details="8 m² komplet badeværelsesrenovering i rækkehus, inkl. vådrumsmembran, nye fliser og væghængt toilet",
        square_meters=8,
        followup_notes="Vejledende overslag afgivet. Ønsker besigtigelse tirsdag kl. 10.",
    )

    check("tool call returned legal non-binding range", "95.000" in result and "165.000" in result and "ikke et bindende tilbud" in result)

    # Verify contact was updated in database
    updated_contact = await db.get_contact(contact["id"], tenant_id)
    check("pipeline stage updated to qualified", updated_contact["pipeline_stage"] == "qualified")
    check("estimated value updated to catalog midpoint", float(updated_contact["estimated_value_dkk"]) == 130000.0)
    check("scope summary saved in memory", "8 m²" in updated_contact["shared_memory_summary"])

    await db.close()

    print("\n==============================================")
    if failures:
        print(f"FAILED ({len(failures)} checks failed)")
        sys.exit(1)
    else:
        print("ALL DANISH ESTIMATION INTEGRATION CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
