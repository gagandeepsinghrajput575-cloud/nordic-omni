"""PostgreSQL access for the voice worker.

Replaces `services/supabase_service.py`. Two things are fixed here:

  * `updated_at` is a real datetime, not the literal string "now()" (which
    PostgREST silently rejected before).
  * The dire-escalation flow looks the call log up **by room_name** instead of
    inventing an id with `room_name.replace("call_", "")`.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Database:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._pool: Optional[asyncpg.Pool] = None

    async def connect(self) -> None:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(self._dsn, min_size=1, max_size=4)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("Database.connect() was not awaited")
        return self._pool

    # --- Reads -----------------------------------------------------------------

    async def get_tenant(self, tenant_id: str) -> Optional[dict[str, Any]]:
        row = await self.pool.fetchrow(
            """
            SELECT t.*, c.customer_system_prompt, c.copilot_system_prompt,
                   c.greeting_script, c.escalation_policy, c.voice_id
            FROM tenants t
            LEFT JOIN tenant_agent_config c ON c.tenant_id = t.id
            WHERE t.id = $1
            """,
            tenant_id,
        )
        return dict(row) if row else None

    async def get_contact(self, contact_id: str) -> Optional[dict[str, Any]]:
        row = await self.pool.fetchrow("SELECT * FROM contacts WHERE id = $1", contact_id)
        return dict(row) if row else None

    async def get_contact_by_phone(self, tenant_id: str, phone: str) -> Optional[dict[str, Any]]:
        row = await self.pool.fetchrow(
            "SELECT * FROM contacts WHERE tenant_id = $1 AND phone_number = $2 LIMIT 1",
            tenant_id,
            phone,
        )
        return dict(row) if row else None

    async def get_knowledge(self, tenant_id: str) -> str:
        rows = await self.pool.fetch(
            """
            SELECT title, content FROM knowledge_items
            WHERE tenant_id = $1 AND is_active = true
            ORDER BY category, title
            """,
            tenant_id,
        )
        if not rows:
            return "No knowledge items configured."
        return "\n".join(f"- {r['title']}: {r['content']}" for r in rows)

    async def ensure_call_log(
        self, *, tenant_id: str, contact_id: str, room_name: str, channel: str
    ) -> str:
        row = await self.pool.fetchrow(
            "SELECT id FROM call_logs WHERE room_name = $1 LIMIT 1", room_name
        )
        if row:
            return str(row["id"])

        new = await self.pool.fetchrow(
            """
            INSERT INTO call_logs (tenant_id, contact_id, room_name, channel, status)
            VALUES ($1, $2, $3, $4, 'in_progress')
            RETURNING id
            """,
            tenant_id,
            contact_id,
            room_name,
            channel,
        )
        return str(new["id"])

    # --- Writes ----------------------------------------------------------------

    async def update_contact_stage(
        self, contact_id: str, stage: str, lead_score: int, memory_update: str
    ) -> None:
        await self.pool.execute(
            """
            UPDATE contacts
               SET pipeline_stage = $2::pipeline_stage,
                   lead_score = $3,
                   shared_memory_summary = $4,
                   updated_at = $5
             WHERE id = $1
            """,
            contact_id,
            stage,
            lead_score,
            memory_update,
            _now(),
        )

    async def update_call_status(
        self,
        *,
        room_name: str,
        status: str,
        dire_reason: Optional[str] = None,
        briefing: Optional[str] = None,
    ) -> None:
        await self.pool.execute(
            """
            UPDATE call_logs
               SET status = $2::call_status,
                   dire_reason = COALESCE($3::dire_reason, dire_reason),
                   summary = COALESCE($4, summary),
                   updated_at = $5
             WHERE room_name = $1
            """,
            room_name,
            status,
            dire_reason,
            briefing,
            _now(),
        )

    async def emit_event(self, tenant_id: str, command_type: str, payload: dict[str, Any]) -> None:
        await self.pool.execute(
            """
            INSERT INTO ui_command_events (tenant_id, command_type, payload)
            VALUES ($1, $2, $3::jsonb)
            """,
            tenant_id,
            command_type,
            json.dumps(payload),
        )
