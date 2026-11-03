"""Customer-facing voice agent.

This file replaces the previous implementation, which could not even be
constructed: it used triple inheritance over `llm.FunctionContext`, and every
parent called a bare `super().__init__()`, which resolves to the *next class in
the instance's MRO* and immediately raised

    TypeError: __init__() missing 2 required positional arguments

It also imported `VoicePipelineAgent`, removed in LiveKit Agents 1.0.

The correct v1 shape is a single `Agent` subclass whose tools are plain methods
decorated with `@function_tool`. No inheritance chain, no shared FunctionContext.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from livekit.agents import Agent, RunContext, function_tool

from services.db import Database

VALID_STAGES = (
    "new_lead",
    "contacted",
    "qualified",
    "booked",
    "dire_escalated",
    "closed_lost",
)


def is_danish(tenant: dict[str, Any], contact: dict[str, Any]) -> bool:
    lang = contact.get("preferred_language") or tenant.get("default_language") or "da-DK"
    return str(lang).lower().startswith("da")


# --- Live context helpers -----------------------------------------------------
# These exist because the old prompt ignored three columns the agency can edit:
# business_hours, pricing_catalog and escalation_policy. escalation_policy was
# even fetched from the database and then thrown away, which meant the agency
# console let you edit a rule that had no effect on the agent at all.

_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
_DAY_DA = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"]
_DAY_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

try:  # pragma: no cover - tz data is present on the target platform
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo("Europe/Copenhagen")
except Exception:  # pragma: no cover
    _TZ = None


def _now() -> datetime:
    return datetime.now(_TZ) if _TZ else datetime.now()


def _business_hours(tenant: dict[str, Any]) -> dict[str, Any]:
    hours = tenant.get("business_hours")
    return hours if isinstance(hours, dict) else {}


def open_state(tenant: dict[str, Any], now: datetime | None = None) -> tuple[bool, str]:
    """(is_open, human-readable verdict). Computed here, not guessed by the LLM."""
    moment = now or _now()
    key = _DAY_KEYS[moment.weekday()]
    day = _business_hours(tenant).get(key) or {}

    if not day:
        return False, "opening hours are not configured"
    if day.get("closed"):
        return False, "closed all day today"

    try:
        opens = datetime.strptime(str(day["open"]), "%H:%M").time()
        closes = datetime.strptime(str(day["close"]), "%H:%M").time()
    except Exception:
        return False, "opening hours are not configured"

    current = moment.time()
    if opens <= current <= closes:
        return True, f"open right now, closes at {day['close']}"
    if current < opens:
        return False, f"closed right now, opens today at {day['open']}"
    return False, f"closed for today, opens tomorrow"


def _hours_block(tenant: dict[str, Any], danish: bool) -> str:
    hours = _business_hours(tenant)
    if not hours:
        return "No opening hours configured yet."

    names = _DAY_DA if danish else _DAY_EN
    lines: list[str] = []
    for index, key in enumerate(_DAY_KEYS):
        day = hours.get(key) or {}
        if not day:
            continue
        if day.get("closed"):
            lines.append(f"{names[index]}: closed")
        else:
            lines.append(f"{names[index]}: {day.get('open')}–{day.get('close')}")
    return "\n".join(lines) if lines else "No opening hours configured yet."


def _price_block(tenant: dict[str, Any]) -> str:
    items = tenant.get("pricing_catalog")
    if not isinstance(items, list) or not items:
        return (
            "No prices are configured. If the caller asks what something costs, say that "
            "someone will confirm the exact price — do NOT estimate one."
        )

    lines: list[str] = []
    for item in items[:40]:
        if not isinstance(item, dict):
            continue
        service = str(item.get("service") or "").strip()
        if not service:
            continue
        try:
            amount = int(float(item.get("price_dkk") or 0))
        except (TypeError, ValueError):
            continue
        rendered = f"{amount:,}".replace(",", ".")
        unit = str(item.get("unit") or "fixed")
        lines.append(f"- {service}: {rendered} DKK ({unit})")

    if not lines:
        return "No prices are configured. Do not quote a figure."
    return "\n".join(lines)


def escalation_block(tenant: dict[str, Any]) -> str:
    """Composes the agency's escalation_policy into actual instructions."""
    policy = tenant.get("escalation_policy")
    if not isinstance(policy, dict):
        policy = {}

    triggers = policy.get("emergencies")
    if isinstance(triggers, list) and triggers:
        terms = ", ".join(str(t) for t in triggers if str(t).strip())
        emergency_line = f"Escalate immediately if the caller mentions any of: {terms}."
    else:
        emergency_line = (
            "Escalate immediately on water damage, flooding, a burst pipe, or severe pain."
        )

    human = policy.get("always_escalate_on_human_request", True)
    human_line = (
        "Escalate immediately whenever the caller asks for a human."
        if human
        else "Only escalate when the situation is genuinely urgent."
    )

    lines = [emergency_line, human_line]

    if policy.get("escalate_outside_opening_hours"):
        lines.append("Escalate every call that arrives outside opening hours.")

    return "\n".join(f"- {line}" for line in lines)



def build_prompt(tenant: dict[str, Any], contact: dict[str, Any], knowledge: str) -> str:
    """Compose instructions from live database state.

    Sectioned deliberately. The previous version was a flat f-string that ignored
    business_hours, pricing_catalog and escalation_policy, so the agent could not
    know whether the business was open and the agency's escalation rules had no
    effect on anything.
    """
    danish = is_danish(tenant, contact)
    now = _now()

    day_name = (_DAY_DA if danish else _DAY_EN)[now.weekday()]
    _, open_verdict = open_state(tenant, now)

    language_rule = (
        "Always speak Danish unless the caller clearly speaks English. If they switch "
        "to English, switch with them and stay there."
        if danish
        else "Always speak English unless the caller clearly speaks Danish. If they switch "
        "to Danish, switch with them and stay there."
    )

    business_prompt = (tenant.get("customer_system_prompt") or "").strip()
    if not business_prompt:
        business_prompt = f"You are the inbound AI receptionist for {tenant['name']}."

    broadcast = (tenant.get("active_broadcast_message") or "").strip()

    caller_lines: list[str] = []
    name = (contact.get("full_name") or "").strip()
    if name:
        caller_lines.append(f"Name: {name}")
    memory = (contact.get("shared_memory_summary") or "").strip()
    if memory:
        caller_lines.append(f"What we already know about them: {memory}")
    stage = contact.get("pipeline_stage")
    if stage:
        caller_lines.append(f"Current pipeline stage: {str(stage).replace('_', ' ')}")
    if not caller_lines:
        caller_lines.append("No prior history. This is a brand-new caller.")

    knowledge_block = knowledge.strip() or "Nothing extra has been configured yet."

    return f"""{business_prompt}

## LANGUAGE
{language_rule}

## WHO YOU ARE SPEAKING TO
{chr(10).join(caller_lines)}

## THE CURRENT MOMENT
It is {day_name}, {now.strftime('%H:%M')} in Denmark.
Status: {open_verdict}.

Opening hours:
{_hours_block(tenant, danish)}

## PRICES YOU MAY QUOTE
{_price_block(tenant)}
These are the only figures you may say out loud. Nothing else.

## STANDING NOTICE
{broadcast or 'No special notice today.'}

## KNOWLEDGE
{knowledge_block}

## WHEN TO ESCALATE
{escalation_block(tenant)}
When you escalate, tell the caller that the on-call person is being connected, then stop talking.

## HOW TO SPEAK
- One or two short sentences per turn. This is a phone call, not an email.
- Sound like a good receptionist: warm, calm, efficient. No filler, no upselling.
- Ask one question at a time. Never stack three questions into one turn.
- If the line is unclear, ask them to repeat instead of guessing.
- Never read out field names, lists, bullet points or markdown. Speak naturally.
- Never say you are an AI, a model or a bot unless you are asked directly. If asked, answer honestly and briefly.
- If the caller goes quiet, wait. Do not fill silence with a pitch.

## HARD RULES
1. Quote prices only from the list above. If the job is not listed, say a colleague will confirm the price — never estimate.
2. Never say something is booked unless the caller has confirmed a specific time.
3. Escalate exactly as described above. Do not invent your own escalation criteria.
4. When you learn something useful about the caller, call update_pipeline_stage to record it, silently.
5. If you do not know something, say you will have someone confirm it. Do not improvise facts.
6. Never promise an arrival time you were not given.
"""


def greeting_for(tenant: dict[str, Any], contact: dict[str, Any]) -> str:
    script = (tenant.get("greeting_script") or "").strip()
    if script:
        return script

    name = (contact.get("full_name") or "").split(" ")[0]
    company = tenant["name"]

    if is_danish(tenant, contact):
        if name:
            return f"Hej {name}, du er kommet til {company}. Hvordan kan jeg hjælpe?"
        return f"Hej, du er kommet til {company}. Hvordan kan jeg hjælpe?"
    if name:
        return f"Hi {name}, you have reached {company}. How can I help?"
    return f"Hi, you have reached {company}. How can I help?"



class CustomerAgent(Agent):
    """Single class. Tools are methods. Nothing else inherits from anything."""

    def __init__(
        self,
        *,
        tenant: dict[str, Any],
        contact: dict[str, Any],
        db: Database,
        room_name: str,
        knowledge: str,
    ) -> None:
        self.tenant = tenant
        self.contact = contact
        self.db = db
        self.room_name = room_name
        self.danish = is_danish(tenant, contact)

        super().__init__(instructions=build_prompt(tenant, contact, knowledge))

    # --- Tools -----------------------------------------------------------------

    @function_tool()
    async def check_availability_and_pricing(self, context: RunContext, query: str) -> str:
        """Look up opening hours, prices and business rules.

        Args:
            query: What the caller wants to know, e.g. "price for emergency call-out".
        """
        tenant = await self.db.get_tenant(str(self.tenant["id"]))
        if not tenant:
            return "I cannot look that up right now."

        hours = tenant.get("business_hours") or {}
        pricing = tenant.get("pricing_catalog") or []
        knowledge = await self.db.get_knowledge(str(self.tenant["id"]))

        price_lines = (
            "\n".join(
                f"- {p.get('service')}: {p.get('price_dkk')} DKK per {p.get('unit')}"
                for p in pricing
            )
            or "No prices configured."
        )

        return (
            f"Opening hours (JSON): {hours}\n"
            f"Prices:\n{price_lines}\n"
            f"Knowledge:\n{knowledge}"
        )

    @function_tool()
    async def update_pipeline_stage(
        self,
        context: RunContext,
        stage: str,
        lead_score: int,
        memory_update: str,
    ) -> str:
        """Record progress for this caller in the CRM.

        Args:
            stage: One of new_lead, contacted, qualified, booked, dire_escalated, closed_lost.
            lead_score: Integer 0-100 estimating how valuable this lead is.
            memory_update: One sentence summarising what you learned.
        """
        if stage not in VALID_STAGES:
            return f"Unknown stage '{stage}'. Valid stages: {', '.join(VALID_STAGES)}."

        score = max(0, min(100, int(lead_score)))

        await self.db.update_contact_stage(
            str(self.contact["id"]), stage, score, memory_update
        )
        await self.db.emit_event(
            str(self.tenant["id"]), "FILTER_PIPELINE", {"stage": stage}
        )
        return f"CRM updated to {stage} with score {score}."

    @function_tool()
    async def trigger_dire_escalation(
        self,
        context: RunContext,
        dire_reason: str,
        briefing_for_owner: str,
        estimated_value_dkk: float,
    ) -> str:
        """Ring the business owner immediately and put the caller on hold.

        Args:
            dire_reason: One of angry_customer, high_value_emergency, ai_unanswered_question.
            briefing_for_owner: One or two sentences the owner needs before speaking.
            estimated_value_dkk: Estimated value of the job in DKK.
        """
        reason = (
            dire_reason
            if dire_reason
            in ("angry_customer", "high_value_emergency", "ai_unanswered_question")
            else "high_value_emergency"
        )

        await self.db.update_contact_stage(
            str(self.contact["id"]), "dire_escalated", 95, briefing_for_owner
        )
        await self.db.update_call_status(
            room_name=self.room_name,
            status="dire_hold_for_owner",
            dire_reason=reason,
            briefing=briefing_for_owner,
        )

        # Look the call log up properly. The old code fabricated an id with
        # room_name.replace("call_", ""), which is not a UUID.
        call_log_id = await self.db.ensure_call_log(
            tenant_id=str(self.tenant["id"]),
            contact_id=str(self.contact["id"]),
            room_name=self.room_name,
            channel="voice_instant_webrtc",
        )

        await self.db.emit_event(
            str(self.tenant["id"]),
            "TRIGGER_DIRE_MODAL",
            {
                "callLogId": call_log_id,
                "contactId": str(self.contact["id"]),
                "customerName": self.contact.get("full_name") or "Caller",
                "phoneNumber": self.contact.get("phone_number") or "",
                "reason": reason,
                "estimatedValueDkk": float(estimated_value_dkk),
                "aiBriefing": briefing_for_owner,
            },
        )

        return (
            "Escalation triggered. The owner is being alerted. Tell the caller that "
            "the on-call person is being connected and they should stay on the line."
        )

