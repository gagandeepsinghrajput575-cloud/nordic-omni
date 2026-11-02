"""Owner-facing co-pilot ("God mode") voice agent.

Rewritten for LiveKit Agents 1.x, same as the customer agent: one `Agent`
subclass, tools as methods, no FunctionContext inheritance.
"""

from __future__ import annotations

from typing import Any

from livekit.agents import Agent, RunContext, function_tool

from services.db import Database


def build_preamble(tenant: dict[str, Any]) -> str:
    danish = str(tenant.get("default_language", "da-DK")).lower().startswith("da")
    business_prompt = (tenant.get("copilot_system_prompt") or "").strip()
    if not business_prompt:
        business_prompt = (
            f"You are the operations co-pilot for the owner of {tenant['name']}."
        )

    language = "Always speak Danish." if danish else "Always speak English."

    return f"""{business_prompt}

LANGUAGE
{language}

RULES
1. Be brief and operational. The owner is busy.
2. Never invent figures. If you do not know something, say so.
3. Only change availability when the owner explicitly asks you to.
"""


class OwnerCopilotAgent(Agent):
    def __init__(self, *, tenant: dict[str, Any], db: Database) -> None:
        self.tenant = tenant
        self.db = db
        super().__init__(instructions=build_preamble(tenant))

    @function_tool()
    async def brief_owner(self, context: RunContext) -> str:
        """Give the owner a short spoken summary of today's pipeline."""
        rows = await self.db.pool.fetch(
            """
            SELECT
              count(*)                                                  AS leads,
              coalesce(sum(estimated_value_dkk), 0)                      AS value,
              count(*) FILTER (WHERE pipeline_stage = 'booked')          AS booked,
              count(*) FILTER (WHERE pipeline_stage = 'dire_escalated')  AS dire
            FROM contacts
            WHERE tenant_id = $1
            """,
            str(self.tenant["id"]),
        )
        r = rows[0]
        return (
            f"{r['leads']} leads, total pipeline {int(r['value'])} DKK, "
            f"{r['booked']} booked, {r['dire']} open emergencies."
        )

    @function_tool()
    async def set_broadcast(self, context: RunContext, message: str) -> str:
        """Set the operational notice shown to customers and used by the agent.

        Args:
            message: The notice to publish. Keep it under 200 characters.
        """
        await self.db.pool.execute(
            """
            UPDATE tenants
               SET active_broadcast_message = $2, updated_at = now()
             WHERE id = $1
            """,
            str(self.tenant["id"]),
            message,
        )
        await self.db.emit_event(
            str(self.tenant["id"]),
            "PULSE_METRIC",
            {"metricId": "broadcast_update", "message": message},
        )
        return "Broadcast updated."
