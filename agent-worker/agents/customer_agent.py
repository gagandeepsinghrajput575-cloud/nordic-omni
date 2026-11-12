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
import json
from typing import Any

from livekit.agents import Agent, RunContext, function_tool

from agents.estimation import EstimateError, calculate_estimate
from services.db import Database
from services.notifications import notify_owner_escalation

VALID_STAGES = (
    "new_lead",
    "contacted",
    "qualified",
    "booked",
    "dire_escalated",
    "closed_won",
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
    if isinstance(hours, str):
        try:
            hours = json.loads(hours)
        except Exception:
            return {}
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
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except Exception:
            items = []
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
        item_id = str(item.get("id") or "").strip()
        bracket = ""
        if item.get("estimate_min_dkk") and item.get("estimate_max_dkk"):
            bracket = (
                f"; estimate_model={item.get('estimate_model', 'fixed')}"
                f"; min={item['estimate_min_dkk']}; max={item['estimate_max_dkk']}"
            )
        lines.append(
            f"- catalog_item_id={item_id}; {service}: {rendered} DKK ({unit}){bracket}"
        )

    if not lines:
        return "No prices are configured. Do not quote a figure."
    return "\n".join(lines)


def escalation_block(tenant: dict[str, Any]) -> str:
    """Composes the agency's escalation_policy into actual instructions."""
    policy = tenant.get("escalation_policy")
    if isinstance(policy, str):
        try:
            policy = json.loads(policy)
        except Exception:
            policy = {}
    if not isinstance(policy, dict):
        policy = {}

    triggers = policy.get("emergency_keywords") or policy.get("emergencies")
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



def build_prompt(
    tenant: dict[str, Any],
    contact: dict[str, Any],
    knowledge: str,
    history: list[dict[str, Any]] | None = None,
) -> str:
    """Compose instructions from live database state.

    Sectioned deliberately. The previous version was a flat f-string that ignored
    business_hours, pricing_catalog and escalation_policy, so the agent could not
    know whether the business was open and the agency's escalation rules had no
    effect on anything.
    """
    danish = is_danish(tenant, contact)
    now = _now()

    persona_name = (
        "Nova"
        if "nova" in str(tenant.get("voice_id", "")).lower()
        else ("Jeppe" if "jeppe" in str(tenant.get("voice_id", "")).lower() else "Christel")
    )

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
    history_lines = []
    for item in (history or [])[-12:]:
        sender = str(item.get("sender") or "")
        speaker = "Kunden" if sender == "customer" else "Receptionisten"
        channel = str(item.get("channel") or "")
        content = str(item.get("content") or "").strip()
        if content:
            history_lines.append(f"- {speaker} ({channel}): {content[:700]}")
    history_block = (
        "The customer has already talked or written to us. Continue naturally from this; "
        "never ask again for facts they already gave.\n" + "\n".join(history_lines)
        if history_lines
        else "No previous cross-channel messages."
    )

    return f"""{business_prompt}

## LANGUAGE
{language_rule}

## WHO YOU ARE SPEAKING TO
{chr(10).join(caller_lines)}

## CROSS-CHANNEL HISTORY
{history_block}

## THE CURRENT MOMENT
It is {day_name}, {now.strftime('%H:%M')} in Denmark.
Status: {open_verdict}.

Opening hours:
{_hours_block(tenant, danish)}

## PRICES YOU MAY QUOTE
{_price_block(tenant)}
These are the only figures you may say out loud. Nothing else.

## PROJECT ESTIMATION & SCOPING RULES
- For renovations (badeværelse, køkken, tilbygning, tagarbejde), ask one focused question at a time about catalog item, square meters when relevant, property type, condition, and materials.
- Use only the configured catalog brackets. Never calculate or choose the saved amount yourself: call `record_project_estimate` with the exact `catalog_item_id` and scope. The tool calculates the minimum, maximum and midpoint deterministically.
- Always say the full legal guardrail: "et vejledende overslag, ikke et bindende tilbud".
- Offer a free, non-binding inspection ("gratis uforpligtende besigtigelse"). If the caller wants one, call `request_inspection`; this records a request only and is not a confirmed booking.
- For standard hourly craft services, quote the exact rates above.
- If the job or bracket is not listed, say a colleague will confirm the price — never estimate.

## STANDING NOTICE
{broadcast or 'No special notice today.'}

## KNOWLEDGE
{knowledge_block}

## WHEN TO ESCALATE
Reception mode: {tenant.get('reception_mode', 'voice_ai')}.
In voice_ai mode, record and qualify requests; never promise a live transfer.
In hybrid mode, use the escalation tool for urgent or human-requested cases.
{escalation_block(tenant)}
When you escalate, say only that the urgent request has been recorded for the on-call person. Never claim a live owner connection unless the system has explicitly confirmed one. Never say you sent, forwarded or delivered the request to the owner unless the tool result explicitly confirms delivery; even then, do not claim the owner has seen it.

## HOW TO SPEAK (NATURAL CONVERSATIONAL FLUENCY, WARMTH & HUMAN EMOTION)
- Real Human Conversational Character: You are {persona_name}, a warm, knowledgeable, and calm coordinator for Dansk Byg & Renovering. Speak with natural human warmth, grounded confidence, and authentic trade pride. Never sound like an aggressive salesperson, a rigid bot, or a repetitive telemarketer.
- Dynamic Conversational Rhythm (Never Sound Like a Telemarketer or Questionnaire):
  * DO NOT force a question at the end of every turn. A real person speaks in statements, comments, thoughtful reactions, and pleasant observations.
  * Answer the caller's actual point first. If the caller asks about Morten ("Is Morten a good guy?"), answer warmly about Morten and let the answer breathe naturally — do NOT immediately pivot back to a sales pitch or repeat "Shall we book an inspection for Lyngby?".
  * Never repeat the same question or call-to-action if you already asked it in recent turns and the caller moved on or didn't respond to it. Follow the customer's conversational flow.
  * Vary your turn endings: often end with a warm affirmation ("Det finder vi helt sikkert en god løsning på.", "Det er altid spændende med et nyt projekt."), a reassuring statement, or an observation. Only ask a question when you genuinely need new information or the customer is waiting for direction.
- Authentic Grounded Danish Demeanor:
  * Danish craftsmanship culture is grounded, reliable, friendly, and unpretentious (no exaggerated American hype).
  * Instead of hyper-cheery "Jeg har det bare fantastisk!", respond naturally and warmly: "Jamen goddag! Det går rigtig godt her, tak fordi du spørger." or "Jo tak, her kører det derudad! Hvad kan vi hjælpe med i dag?".
  * Use authentic spoken Danish idioms: "Jamen goddag!", "Lige præcis", "Helt sikkert", "Det kigger vi meget gerne på", "Det finder vi ud af", "Ingen problem overhovedet".
- Emotion & Empathy: React to the customer's feelings like a real colleague. If they are planning a renovation, share in the excitement: "Det er et klassisk projekt, som virkelig kan løfte boligen." If they sound uncertain or stressed, reassure them calmly: "Det forstår jeg fuldstændig, det er en stor beslutning, men vi tager det hele i dit tempo."
- Natural Pacing: Speak at a fluid, comfortable conversational tempo (not slow, not rushed). Keep your turns to 1–2 natural sentences.
- Bilingual Fluency: If the caller speaks English, switch smoothly and speak warm, idiomatic, completely natural English. If they speak Danish, speak authentic, natural Danish.
- Never read out bullet points, field names, or markdown. Say "kvadratmeter" not "m2", "for eksempel" not "f.eks.".
- Never say you are an AI, a model or a bot unless directly asked. If asked, confirm honestly and concisely.

## HARD RULES
1. Quote prices only from the list above. If the job is not listed, say a colleague will confirm the price — never estimate.
2. Never say an inspection is booked or confirmed. `request_inspection` only records an unconfirmed request for the contractor to review.
3. Clearly clarify all estimates as "vejledende overslag" (non-binding).
4. Escalate exactly as described above. Do not invent your own escalation criteria.
5. When a project is scoped, call `record_project_estimate` to record it.
6. When you learn something useful about the caller, call update_pipeline_stage to record it, silently.
7. If you do not know something, say you will have someone confirm it. Do not improvise facts.
8. Never promise an arrival time you were not given.
"""


def greeting_for(tenant: dict[str, Any], contact: dict[str, Any]) -> str:
    script = (tenant.get("greeting_script") or "").strip()
    danish = is_danish(tenant, contact)

    if script:
        base = script
    else:
        name = (contact.get("full_name") or "").split(" ")[0]
        company = tenant["name"]
        if danish:
            base = (
                f"Hej {name}, du er kommet til {company}. Hvordan kan jeg hjælpe?"
                if name
                else f"Hej, du er kommet til {company}. Hvordan kan jeg hjælpe?"
            )
        else:
            base = (
                f"Hi {name}, you have reached {company}. How can I help?"
                if name
                else f"Hi, you have reached {company}. How can I help?"
            )

    # Recording consent. Danish rules require the caller to be told, and a
    # business owner will ask "is that legal?" before they buy anything. Hearing
    # the AI say it unprompted is the answer.
    if tenant.get("record_calls", True):
        base = f"{base} {'Dette opkald bliver optaget.' if danish else 'This call is being recorded.'}"

    return base



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
        history: list[dict[str, Any]] | None = None,
        channel: str = "voice_instant_webrtc",
    ) -> None:
        self.tenant = tenant
        self.contact = contact
        self.db = db
        self.room_name = room_name
        self.danish = is_danish(tenant, contact)
        self.history = history or []
        self.channel = (
            "voice_inbound" if channel == "voice_inbound" else "voice_instant_webrtc"
        )

        super().__init__(instructions=build_prompt(tenant, contact, knowledge, self.history))

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
        if stage == "booked":
            return (
                "En booket status kræver en særskilt bekræftet aftale. "
                "Registrer i stedet en besigtigelsesanmodning; den er ikke bekræftet. "
                "(A booked stage requires a separately confirmed appointment.)"
            )

        score = max(0, min(100, int(lead_score)))

        await self.db.update_contact_stage(
            str(self.contact["id"]), str(self.tenant["id"]), stage, score, memory_update
        )
        await self.db.emit_event(
            str(self.tenant["id"]), "FILTER_PIPELINE", {"stage": stage}
        )
        return f"CRM updated to {stage} with score {score}."

    @function_tool()
    async def record_project_estimate(
        self,
        context: RunContext,
        catalog_item_id: str,
        project_type: str,
        scope_details: str,
        square_meters: float | None,
        followup_notes: str,
    ) -> str:
        """Calculate and save a catalog-grounded, non-binding project estimate.

        Args:
            catalog_item_id: The exact catalog_item_id shown in the price list.
            project_type: Human-readable project type for the CRM.
            scope_details: Property, condition, materials and work included.
            square_meters: Scope in square meters, or null for fixed-price work.
            followup_notes: Address and inspection preferences.
        """
        catalog = self.tenant.get("pricing_catalog") or []
        if isinstance(catalog, str):
            try:
                catalog = json.loads(catalog)
            except Exception:
                catalog = []
        try:
            estimate = calculate_estimate(catalog, catalog_item_id, square_meters)
        except EstimateError as exc:
            message = str(exc)
            return (
                f"Overslaget kunne ikke beregnes: {message} Bed en kollega bekræfte prisen."
                if self.danish
                else f"The estimate could not be calculated: {message} A colleague must confirm the price."
            )

        call_log_id = await self.db.ensure_call_log(
            tenant_id=str(self.tenant["id"]),
            contact_id=str(self.contact["id"]),
            room_name=self.room_name,
            channel=self.channel,
        )
        summary = (
            f"Overslag: {project_type} ({estimate.minimum:,.0f}-{estimate.maximum:,.0f} DKK). "
            f"Omfang: {scope_details}. Noter: {followup_notes}"
        ).replace(",", ".")
        await self.db.record_project_estimate(
            tenant_id=str(self.tenant["id"]),
            contact_id=str(self.contact["id"]),
            call_log_id=call_log_id,
            project_type=project_type,
            scope_details=scope_details,
            square_meters=estimate.square_meters,
            estimated_min_dkk=estimate.minimum,
            estimated_max_dkk=estimate.maximum,
            estimated_value_dkk=estimate.midpoint,
            scope_summary=summary,
            followup_notes=followup_notes,
            lead_score=85,
        )
        low = f"{estimate.minimum:,.0f}".replace(",", ".")
        high = f"{estimate.maximum:,.0f}".replace(",", ".")
        if self.danish:
            return (
                f"Et vejledende overslag ligger mellem {low} og {high} kroner. "
                "Det er et vejledende overslag, ikke et bindende tilbud. "
                "Tilbyd en gratis uforpligtende besigtigelse."
            )
        return (
            f"A non-binding estimate is between DKK {low} and {high}. "
            "This is a guide, not a binding quote. Offer a free inspection."
        )

    @function_tool()
    async def request_inspection(
        self,
        context: RunContext,
        requested_time_text: str,
        address: str,
        notes: str,
    ) -> str:
        """Record an inspection request for review; never confirms a booking.

        Args:
            requested_time_text: The caller's preferred time, in their own words.
            address: Property address for the inspection.
            notes: Access details or anything the contractor should know.
        """
        call_log_id = await self.db.ensure_call_log(
            tenant_id=str(self.tenant["id"]),
            contact_id=str(self.contact["id"]),
            room_name=self.room_name,
            channel=self.channel,
        )
        await self.db.request_inspection(
            tenant_id=str(self.tenant["id"]),
            contact_id=str(self.contact["id"]),
            call_log_id=call_log_id,
            requested_time_text=requested_time_text,
            address=address,
            notes=notes,
            status="requested",
        )
        if self.danish:
            return (
                "Besigtigelsesanmodningen er registreret til gennemsyn. "
                "Tiden er ikke bekræftet endnu; kontoret vender tilbage."
            )
        return (
            "The inspection request has been recorded for review. "
            "The time is not confirmed yet; the office will follow up."
        )


    @function_tool()
    async def trigger_dire_escalation(
        self,
        context: RunContext,
        dire_reason: str,
        briefing_for_owner: str,
        estimated_value_dkk: float,
    ) -> str:
        """Record an urgent request for the owner without claiming a live transfer.

        Args:
            dire_reason: One of angry_customer, high_value_emergency, ai_unanswered_question, human_requested.
            briefing_for_owner: One or two sentences the owner needs before speaking.
            estimated_value_dkk: Estimated value of the job in DKK.
        """
        reason = (
            dire_reason
            if dire_reason
            in (
                "angry_customer",
                "high_value_emergency",
                "ai_unanswered_question",
                "human_requested",
            )
            else "high_value_emergency"
        )
        call_dire_reason = (
            "ai_unanswered_question" if reason == "human_requested" else reason
        )

        await self.db.update_contact_stage(
            str(self.contact["id"]), str(self.tenant["id"]),
            "dire_escalated", 95, briefing_for_owner,
        )
        await self.db.update_call_status(
            room_name=self.room_name,
            tenant_id=str(self.tenant["id"]),
            status="dire_hold_for_owner",
            dire_reason=call_dire_reason,
            briefing=briefing_for_owner,
        )

        # Look the call log up properly. The old code fabricated an id with
        # room_name.replace("call_", ""), which is not a UUID.
        call_log_id = await self.db.ensure_call_log(
            tenant_id=str(self.tenant["id"]),
            contact_id=str(self.contact["id"]),
            room_name=self.room_name,
            channel=self.channel,
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

        payload = {
            "event": "owner_escalation",
            "tenant": {
                "id": str(self.tenant["id"]),
                "name": self.tenant["name"],
                "slug": self.tenant["slug"],
            },
            "contact": {
                "id": str(self.contact["id"]),
                "name": self.contact.get("full_name"),
                "phone": self.contact.get("phone_number"),
                "email": self.contact.get("email"),
            },
            "owner": {
                "name": self.tenant.get("owner_name"),
                "phone": self.tenant.get("owner_phone"),
                "email": self.tenant.get("owner_email"),
            },
            "channel": self.channel,
            "reason": reason,
            "urgency": 5 if estimated_value_dkk >= 100000 or reason == "high_value_emergency" else 4,
            "briefing": briefing_for_owner[:1200],
            "createdAt": _now().isoformat(),
        }
        escalation_id = await self.db.record_escalation(
            tenant_id=str(self.tenant["id"]),
            contact_id=str(self.contact["id"]),
            channel=self.channel,
            reason=reason,
            urgency=payload["urgency"],
            briefing=briefing_for_owner,
            payload=payload,
        )
        delivered, notify_error = await notify_owner_escalation(payload)
        if delivered or notify_error:
            await self.db.set_escalation_notification(
                escalation_id,
                tenant_id=str(self.tenant["id"]),
                delivered=delivered,
                error=notify_error,
            )

        if self.danish:
            return (
                "Den akutte henvendelse er sendt til kontorets arbejdsgang. "
                "Der er ikke etableret en live forbindelse. Fortæl kunden sandheden."
                if delivered
                else "Den akutte henvendelse er registreret til den vagthavende. "
                "Der er ikke etableret en live forbindelse. Fortæl kunden sandheden."
            )
        return (
            "The urgent request has been sent to the office workflow. "
            "No live connection has been established. Tell the caller that truthfully."
            if delivered
            else "The urgent request has been recorded for the on-call person. "
            "No live connection has been established. Tell the caller that truthfully."
        )

