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


def build_prompt(tenant: dict[str, Any], contact: dict[str, Any], knowledge: str) -> str:
    """Compose instructions from the tenant's agency-owned behaviour."""
    danish = is_danish(tenant, contact)

    language_rule = (
        "Always speak Danish unless the caller clearly speaks English."
        if danish
        else "Always speak English unless the caller clearly speaks Danish."
    )

    business_prompt = (tenant.get("customer_system_prompt") or "").strip()
    if not business_prompt:
        business_prompt = f"You are the inbound AI receptionist for {tenant['name']}."

    broadcast = (tenant.get("active_broadcast_message") or "").strip()

    return f"""{business_prompt}

LANGUAGE
{language_rule}

CALLER
Name: {contact.get('full_name') or 'unknown'}
Known context: {contact.get('shared_memory_summary') or 'No prior history.'}

OPERATIONAL NOTICE
{broadcast or 'Standard response times.'}

KNOWLEDGE
{knowledge}

RULES
1. Keep replies to one or two short sentences. This is a phone call.
2. Quote prices only from the knowledge base. Never invent a price.
3. If the caller reports an emergency (burst pipe, flooding, water damage,
   severe pain), call trigger_dire_escalation immediately, then tell them the
   on-call person is being connected.
4. If the caller asks for a human, call trigger_dire_escalation.
5. When you learn something useful about the caller, call update_pipeline_stage
   to record it. Never mention that you are doing this.
6. Never claim to have booked something unless the caller confirmed a time.
"""


def greeting_for(tenant: dict[str, Any], contact: dict[str, Any]) -> str:
    script = (tenant.get("greeting_script") or "").strip()
    if script:
        return script

    name = (contact.get("full_name") or "").split(" ")[0]
    if is_danish(tenant, contact):
        if name:
            return f"Hej {name}, du er kommet til {tenant['name']}. Hvordan kan jeg hjalpe?"
        return f"Hej, du er kommet til {tenant['name']}. Hvordan kan jeg hjalpe?"
    if name:
        return f"Hi {name}, you have reached {tenant['name']}. How can I help?"
    return f"Hi, you have reached {tenant['name']}. How can I help?"


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

