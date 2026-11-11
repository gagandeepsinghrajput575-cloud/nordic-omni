"""Assertions for the prompt builder.

These exist because the previous prompt ignored three agency-editable columns:
`business_hours`, `pricing_catalog` and `escalation_policy`. `escalation_policy`
was fetched from the database by `services/db.py` and then never referenced, so
the agency console let an operator edit a rule that had zero effect.

Each test below fails if that regression comes back.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.customer_agent import (  # noqa: E402
    build_prompt,
    escalation_block,
    greeting_for,
    open_state,
)

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' — ' + detail) if detail else ''}")
        FAILURES.append(name)


def tenant(**overrides):
    base = {
        "id": "t1",
        "name": "Københavns VVS",
        "default_language": "da-DK",
        "active_broadcast_message": None,
        "customer_system_prompt": "Du er receptionist.",
        "greeting_script": None,
        "business_hours": {
            "mon": {"open": "08:00", "close": "16:00", "closed": False},
            "tue": {"open": "08:00", "close": "16:00", "closed": False},
            "wed": {"open": "08:00", "close": "16:00", "closed": False},
            "thu": {"open": "08:00", "close": "16:00", "closed": False},
            "fri": {"open": "08:00", "close": "16:00", "closed": False},
            "sat": {"open": "09:00", "close": "12:00", "closed": False},
            "sun": {"open": "00:00", "close": "00:00", "closed": True},
        },
        "pricing_catalog": [
            {"id": "tap", "service": "Udskiftning af blandingsbatteri", "price_dkk": 1250, "unit": "fixed"},
            {"id": "callout", "service": "Fremkørsel", "price_dkk": 450, "unit": "fixed"},
        ],
        "escalation_policy": {
            "emergencies": ["vandskade", "sprunget rør"],
            "always_escalate_on_human_request": True,
            "escalate_outside_opening_hours": False,
        },
    }
    base.update(overrides)
    return base


CONTACT = {
    "full_name": "Morten Bondo",
    "shared_memory_summary": "Har et utæt hovedrør.",
    "pipeline_stage": "new_lead",
    "preferred_language": "da",
}


def main() -> int:
    print("=== VAL-AI-501 escalation_policy reaches the prompt (was dropped) ===")
    prompt = build_prompt(tenant(), CONTACT, "Vi kører ikke weekender.")
    check("emergency term from DB appears", "vandskade" in prompt)
    check("second emergency term appears", "sprunget rør" in prompt)
    check("human-request rule appears", "asks for a human" in prompt)
    check("escalation section header", "## WHEN TO ESCALATE" in prompt)

    # Flip the policy and confirm the prompt actually changes.
    policy_off = tenant(
        escalation_policy={
            "emergencies": ["gaslækage"],
            "always_escalate_on_human_request": False,
            "escalate_outside_opening_hours": True,
        }
    )
    prompt_off = build_prompt(policy_off, CONTACT, "")
    check("changed emergency list is honoured", "gaslækage" in prompt_off)
    check("old term is gone", "vandskade" not in prompt_off)
    check(
        "human_request=false changes the rule",
        "Only escalate when the situation is genuinely urgent" in prompt_off,
    )
    check("outside-hours policy is honoured", "outside opening hours" in prompt_off)

    print("\n=== VAL-AI-502 open/closed is computed, not guessed ===")
    t = tenant()
    monday_noon = datetime(2026, 4, 13, 12, 0)
    monday_night = datetime(2026, 4, 13, 22, 0)
    sunday = datetime(2026, 4, 12, 12, 0)

    is_open, verdict = open_state(t, monday_noon)
    check("Monday noon is open", is_open, verdict)
    check("verdict mentions closing time", "16:00" in verdict, verdict)

    is_open, verdict = open_state(t, monday_night)
    check("Monday 22:00 is closed", not is_open, verdict)

    is_open, verdict = open_state(t, sunday)
    check("Sunday is closed", not is_open, verdict)

    is_open, verdict = open_state(tenant(business_hours={}), monday_noon)
    check("missing hours reads as unconfigured", not is_open, verdict)

    check("prompt states a status line", "Status:" in prompt)

    history_prompt = build_prompt(
        tenant(),
        CONTACT,
        "",
        [{"sender": "customer", "channel": "web_chat", "content": "Jeg skrev om et nyt tag i går."}],
    )
    check("cross-channel history reaches the prompt", "Jeg skrev om et nyt tag" in history_prompt)
    check(
        "history instructs the agent not to repeat questions",
        "never ask again" in history_prompt,
    )

    print("\n=== VAL-AI-503 pricing is injected, not only behind a tool ===")
    check("service name in prompt", "Udskiftning af blandingsbatteri" in prompt)
    check("Danish thousands separator applied", "1.250 DKK" in prompt)
    check("second service in prompt", "Fremkørsel" in prompt)
    check("price section header", "## PRICES YOU MAY QUOTE" in prompt)

    no_prices = build_prompt(tenant(pricing_catalog=[]), CONTACT, "")
    check(
        "empty catalogue forbids quoting",
        "Do not quote a figure" in no_prices or "do NOT estimate" in no_prices,
    )

    print("\n=== VAL-AI-504 Danish greeting is spelled correctly ===")
    greeting = greeting_for(tenant(greeting_script=None), CONTACT)
    check("contains hjælpe", "hjælpe" in greeting, greeting)
    check("does not contain hjalpe", "hjalpe" not in greeting, greeting)
    check("greets the caller by first name", "Morten" in greeting, greeting)

    danish_script = greeting_for(tenant(greeting_script="Hej med dig."), CONTACT)
    check(
        "DB greeting is the base of the spoken line",
        danish_script.startswith("Hej med dig."),
        danish_script,
    )

    print("\n=== recording consent is spoken, not hidden in config ===")
    recording_on = greeting_for(tenant(record_calls=True), CONTACT)
    check(
        "consent line present when record_calls is true",
        "Dette opkald bliver optaget" in recording_on,
        recording_on,
    )
    recording_off = greeting_for(tenant(record_calls=False), CONTACT)
    check(
        "no consent line when recording is off",
        "optaget" not in recording_off,
        recording_off,
    )
    check(
        "consent uses the tenant's language",
        "This call is being recorded" in greeting_for(
            tenant(record_calls=True, default_language="en-US"), {**CONTACT, "preferred_language": "en"}
        ),
    )

    print("\n=== VAL-AI-508 prompt is composed from parts ===")
    for header in (
        "## LANGUAGE",
        "## WHO YOU ARE SPEAKING TO",
        "## THE CURRENT MOMENT",
        "## PRICES YOU MAY QUOTE",
        "## STANDING NOTICE",
        "## KNOWLEDGE",
        "## WHEN TO ESCALATE",
        "## HOW TO SPEAK",
        "## HARD RULES",
    ):
        check(f"section {header}", header in prompt)

    with_notice = build_prompt(
        tenant(active_broadcast_message="Vi har ekstra åbent i uge 42."), CONTACT, ""
    )
    check("broadcast appears when set", "Vi har ekstra åbent" in with_notice)
    check("knowledge appears", "Vi kører ikke weekender." in prompt)
    check("caller memory appears", "utæt hovedrør" in prompt)
    check("no-invention guardrail present", "never estimate" in prompt.lower())
    check("booking guardrail present", "not a confirmed booking" in prompt)

    print("\n=== extra: escalation_block is pure and total ===")
    check("empty policy still yields rules", len(escalation_block({}).splitlines()) >= 2)
    check(
        "non-dict policy does not crash",
        len(escalation_block({"escalation_policy": "junk"}).splitlines()) >= 2,
    )

    print("\n" + "=" * 46)
    if FAILURES:
        print(f"{len(FAILURES)} CHECK(S) FAILED")
        for name in FAILURES:
            print(f"  - {name}")
        return 1

    print("ALL PROMPT CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

