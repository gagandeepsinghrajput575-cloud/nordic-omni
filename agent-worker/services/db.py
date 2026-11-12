"""PostgreSQL access for the voice worker.

Replaces `services/supabase_service.py`. Two things are fixed here:

  * `updated_at` is a real datetime, not the literal string "now()" (which
    PostgREST silently rejected before).
  * The dire-escalation flow looks the call log up **by room_name** instead of
    inventing an id with `room_name.replace("call_", "")`.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Optional

from services.phone import normalize_phone

import asyncpg


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalized_phone_sql(column: str) -> str:
    """SQL equivalent of services.phone.normalize_phone for indexed columns."""
    digits = f"regexp_replace({column}, '[^0-9]', '', 'g')"
    return (
        f"(CASE WHEN {digits} LIKE '00%' "
        f"THEN '+' || substr({digits}, 3) ELSE '+' || {digits} END)"
    )


class Database:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._pool: Optional[asyncpg.Pool] = None
        self._lifecycle_lock = asyncio.Lock()

    async def connect(self) -> None:
        async with self._lifecycle_lock:
            if self._pool is not None:
                return
            try:
                self._pool = await asyncpg.create_pool(
                    self._dsn,
                    min_size=0,
                    max_size=2,
                    command_timeout=10,
                    timeout=10,
                    max_inactive_connection_lifetime=30,
                    server_settings={
                        "application_name": "nordic-omni-worker",
                        "statement_timeout": "10000",
                        "lock_timeout": "2000",
                        "idle_in_transaction_session_timeout": "10000",
                    },
                )
            except BaseException:
                self._pool = None
                raise

    @property
    def is_connected(self) -> bool:
        return self._pool is not None and not self._pool.is_closing()

    async def close(self) -> None:
        async with self._lifecycle_lock:
            pool, self._pool = self._pool, None
            if pool is not None:
                await pool.close()

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
                   c.greeting_script, c.escalation_policy, c.voice_id, c.stt_language
            FROM tenants t
            LEFT JOIN tenant_agent_config c ON c.tenant_id = t.id
            WHERE t.id = $1
            """,
            tenant_id,
        )
        if not row:
            return None
        d = dict(row)
        for key in ("business_hours", "pricing_catalog", "escalation_policy"):
            val = d.get(key)
            if isinstance(val, str):
                try:
                    d[key] = json.loads(val)
                except Exception:
                    pass
        return d

    async def get_tenant_by_did(self, did: str) -> Optional[dict[str, Any]]:
        normalized = normalize_phone(did)
        if not normalized:
            return None
        row = await self.pool.fetchrow(
            f"""
            SELECT t.*, c.customer_system_prompt, c.copilot_system_prompt,
                   c.greeting_script, c.escalation_policy, c.voice_id, c.stt_language
            FROM tenants t
            LEFT JOIN tenant_agent_config c ON c.tenant_id = t.id
            WHERE {_normalized_phone_sql("t.flynumber_did")} = $1
              AND t.status = 'active'
            LIMIT 1
            """,
            normalized,
        )
        if not row:
            return None
        tenant = dict(row)
        for key in ("business_hours", "pricing_catalog", "escalation_policy"):
            value = tenant.get(key)
            if isinstance(value, str):
                try:
                    tenant[key] = json.loads(value)
                except Exception:
                    pass
        return tenant

    async def get_contact(self, contact_id: str, tenant_id: str) -> Optional[dict[str, Any]]:
        row = await self.pool.fetchrow(
            "SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2",
            contact_id,
            tenant_id,
        )
        return dict(row) if row else None

    async def get_contact_by_phone(self, tenant_id: str, phone: str) -> Optional[dict[str, Any]]:
        normalized = normalize_phone(phone)
        if not normalized:
            return None
        row = await self.pool.fetchrow(
            f"""
            SELECT * FROM contacts
            WHERE tenant_id = $1
              AND {_normalized_phone_sql("phone_number")} = $2
            LIMIT 1
            """,
            tenant_id,
            normalized,
        )
        return dict(row) if row else None

    async def get_or_create_inbound_contact(
        self, *, tenant_id: str, phone: str, language: str = "da"
    ) -> Optional[dict[str, Any]]:
        normalized = normalize_phone(phone)
        if not normalized:
            return None
        existing = await self.get_contact_by_phone(tenant_id, normalized)
        if existing:
            return existing
        row = await self.pool.fetchrow(
            f"""
            INSERT INTO contacts (
              tenant_id, phone_number, preferred_language, preferred_channel,
              pipeline_stage, lead_score, shared_memory_summary
            ) VALUES ($1, $2, $3, 'voice_inbound'::channel_type, 'new_lead', 50,
                      'Indgående telefonopkald')
            ON CONFLICT (tenant_id, {_normalized_phone_sql("phone_number")})
              WHERE phone_number IS NOT NULL
              DO NOTHING
            RETURNING *
            """,
            tenant_id,
            normalized,
            "da" if language.startswith("da") else "en",
        )
        if row:
            return dict(row)
        # Another worker inserted the same caller between SELECT and INSERT.
        return await self.get_contact_by_phone(tenant_id, normalized)

    async def get_recent_messages(
        self, tenant_id: str, contact_id: str, limit: int = 12
    ) -> list[dict[str, Any]]:
        rows = await self.pool.fetch(
            """
            SELECT sender, channel::text AS channel, content, created_at
            FROM (
              SELECT sender, channel, content, created_at
              FROM messages
              WHERE tenant_id = $1 AND contact_id = $2
              ORDER BY created_at DESC
              LIMIT $3
            ) recent
            ORDER BY created_at ASC
            """,
            tenant_id,
            contact_id,
            max(1, min(30, limit)),
        )
        return [dict(row) for row in rows]

    async def persist_transcript_messages(
        self, *, tenant_id: str, room_name: str, turns: list[dict[str, Any]]
    ) -> None:
        if not turns:
            return
        call = await self.pool.fetchrow(
            """
            SELECT id, contact_id, channel::text AS channel
            FROM call_logs WHERE room_name = $1 AND tenant_id = $2 LIMIT 1
            """,
            room_name,
            tenant_id,
        )
        if not call or not call["contact_id"]:
            return
        channel = (
            "voice_inbound"
            if str(call["channel"]) == "voice_inbound"
            else "voice_instant_webrtc"
        )
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                for index, turn in enumerate(turns):
                    role = str(turn.get("role") or "")
                    if role not in ("assistant", "user"):
                        continue
                    content = str(turn.get("content") or "").strip()
                    if not content:
                        continue
                    sender = "ai" if role == "assistant" else "customer"
                    direction = "outbound" if role == "assistant" else "inbound"
                    await conn.execute(
                        """
                        INSERT INTO messages
                          (tenant_id, contact_id, channel, direction, sender,
                           content, external_id, metadata)
                        VALUES ($1,$2,$3::channel_type,$4,$5,$6,$7,$8::jsonb)
                        ON CONFLICT DO NOTHING
                        """,
                        tenant_id,
                        call["contact_id"],
                        channel,
                        direction,
                        sender,
                        content[:8000],
                        f"call:{call['id']}:{index}",
                        json.dumps({"callLogId": str(call["id"]), "source": "voice"}),
                    )

    async def record_escalation(
        self,
        *,
        tenant_id: str,
        contact_id: str,
        channel: str,
        reason: str,
        urgency: int,
        briefing: str,
        payload: dict[str, Any],
    ) -> str:
        row = await self.pool.fetchrow(
            """
            INSERT INTO conversation_escalations
              (tenant_id, contact_id, channel, reason, urgency, briefing, payload)
            SELECT $1,$2,$3,$4,$5,$6,$7::jsonb
            WHERE EXISTS (
              SELECT 1 FROM contacts WHERE id = $2 AND tenant_id = $1
            )
            RETURNING id
            """,
            tenant_id,
            contact_id,
            channel,
            reason,
            max(1, min(5, urgency)),
            briefing[:1200],
            json.dumps(payload),
        )
        if not row:
            raise RuntimeError("escalation contact is outside the worker tenant")
        return str(row["id"])

    async def set_escalation_notification(
        self, escalation_id: str, *, tenant_id: str, delivered: bool, error: Optional[str] = None
    ) -> None:
        await self.pool.execute(
            """
            UPDATE conversation_escalations
               SET n8n_status = $3,
                   n8n_error = $4,
                   status = CASE WHEN $3::text = 'delivered' THEN 'notified' ELSE status END
             WHERE id = $1 AND tenant_id = $2
            """,
            escalation_id,
            tenant_id,
            "delivered" if delivered else "failed",
            error[:500] if error else None,
        )

    async def get_knowledge(self, tenant_id: str) -> str:
        rows = await self.pool.fetch(
            """
            SELECT title, content FROM knowledge_items
            WHERE tenant_id = $1 AND is_active = true
            ORDER BY priority DESC, category, title
            """,
            tenant_id,
        )
        if not rows:
            return "No knowledge items configured."
        return "\n".join(f"- {r['title']}: {r['content']}" for r in rows)

    async def ensure_call_log(
        self, *, tenant_id: str, contact_id: str, room_name: str, channel: str
    ) -> str:
        """Atomically claim a room without reviving a terminal call.

        The single upsert removes the SELECT/INSERT unique-key race with token
        creation and repeated tool calls. The conflict predicate also prevents
        a room-name collision from crossing tenant or contact boundaries.
        """
        row = await self.pool.fetchrow(
            """
            INSERT INTO call_logs (tenant_id, contact_id, room_name, channel, status)
            SELECT $1, $2, $3, $4, 'in_progress'
            WHERE EXISTS (
              SELECT 1 FROM contacts WHERE id = $2 AND tenant_id = $1
            )
            ON CONFLICT (room_name) DO UPDATE
               SET status = CASE
                     WHEN call_logs.status IN ('completed', 'missed')
                     THEN call_logs.status ELSE 'in_progress'::call_status END,
                   updated_at = CASE
                     WHEN call_logs.status IN ('completed', 'missed')
                     THEN call_logs.updated_at ELSE now() END
             WHERE call_logs.tenant_id = $1
               AND call_logs.contact_id = $2
            RETURNING id
            """,
            tenant_id,
            contact_id,
            room_name,
            channel,
        )
        if not row:
            raise RuntimeError("call room conflicts with another tenant or contact")
        return str(row["id"])

    # --- Writes ----------------------------------------------------------------

    async def update_contact_stage(
        self, contact_id: str, tenant_id: str, stage: str, lead_score: int, memory_update: str
    ) -> None:
        await self.pool.execute(
            """
            UPDATE contacts
               SET pipeline_stage = CASE
                     WHEN pipeline_stage IN ('closed_won', 'closed_lost') THEN pipeline_stage
                     WHEN $3::pipeline_stage = 'dire_escalated' THEN 'dire_escalated'::pipeline_stage
                     WHEN pipeline_stage IN ('booked', 'dire_escalated') THEN pipeline_stage
                     WHEN pipeline_stage = 'qualified'
                      AND $3::pipeline_stage IN ('new_lead', 'contacted') THEN pipeline_stage
                     WHEN pipeline_stage = 'contacted'
                      AND $3::pipeline_stage = 'new_lead' THEN pipeline_stage
                     ELSE $3::pipeline_stage
                   END,
                   lead_score = $4,
                   shared_memory_summary = CASE
                     WHEN nullif(trim($5), '') IS NULL THEN shared_memory_summary
                     ELSE left(concat_ws(E'\n', nullif(shared_memory_summary, ''), $5::text), 12000)
                   END,
                   updated_at = $6
             WHERE id = $1 AND tenant_id = $2
            """,
            contact_id,
            tenant_id,
            stage,
            lead_score,
            memory_update,
            _now(),
        )

    async def record_project_estimate(
        self, *, tenant_id: str, contact_id: str, call_log_id: str,
        project_type: str, scope_details: str, square_meters: Optional[float],
        estimated_min_dkk: float, estimated_max_dkk: float, estimated_value_dkk: float,
        scope_summary: str, followup_notes: str, lead_score: int = 85,
    ) -> None:
        """Persist estimate history and the headline CRM value atomically."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                contact_update = await conn.execute(
                    """
                    UPDATE contacts
                       SET estimated_value_dkk = $3,
                           pipeline_stage = CASE
                             WHEN pipeline_stage IN ('new_lead', 'contacted', 'qualified')
                             THEN 'qualified'::pipeline_stage ELSE pipeline_stage END,
                           lead_score = GREATEST(lead_score, $4),
                           shared_memory_summary = left(
                             concat_ws(E'\n', nullif(shared_memory_summary, ''), $5::text), 12000),
                           updated_at = $6
                     WHERE id = $1 AND tenant_id = $2
                    """,
                    contact_id, tenant_id, estimated_value_dkk, lead_score, scope_summary, _now(),
                )
                if contact_update != "UPDATE 1":
                    raise RuntimeError("estimate contact is outside the worker tenant")
                estimate_insert = await conn.execute(
                    """
                    INSERT INTO project_estimates (
                      tenant_id, contact_id, call_log_id, project_type, scope_details,
                      square_meters, estimated_min_dkk, estimated_max_dkk,
                      estimated_value_dkk, followup_notes
                    )
                    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
                    WHERE $3::uuid IS NULL OR EXISTS (
                      SELECT 1 FROM call_logs
                      WHERE id = $3 AND tenant_id = $1 AND contact_id = $2
                    )
                    """,
                    tenant_id, contact_id, call_log_id, project_type, scope_details,
                    square_meters, estimated_min_dkk, estimated_max_dkk,
                    estimated_value_dkk, followup_notes,
                )
                if estimate_insert != "INSERT 0 1":
                    raise RuntimeError("estimate call log is outside the worker tenant/contact")
                await conn.execute(
                    """
                    INSERT INTO ui_command_events (tenant_id, command_type, payload)
                    VALUES ($1, 'PROJECT_ESTIMATE_RECORDED', $2::jsonb)
                    """,
                    tenant_id,
                    json.dumps({"contactId": contact_id, "callLogId": call_log_id,
                                "estimatedValueDkk": estimated_value_dkk}),
                )

    async def request_inspection(
        self, *, tenant_id: str, contact_id: str, call_log_id: str,
        requested_time_text: str, address: str, notes: str, status: str = "requested",
    ) -> None:
        """Record interest without pretending a calendar booking was confirmed."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                inspection_insert = await conn.execute(
                    """
                    INSERT INTO inspection_requests (
                      tenant_id, contact_id, call_log_id, requested_time_text,
                      address, notes, status
                    )
                    SELECT $1,$2,$3,$4,$5,$6,$7
                    WHERE EXISTS (
                      SELECT 1 FROM contacts WHERE id = $2 AND tenant_id = $1
                    )
                      AND ($3::uuid IS NULL OR EXISTS (
                        SELECT 1 FROM call_logs
                        WHERE id = $3 AND tenant_id = $1 AND contact_id = $2
                      ))
                    """,
                    tenant_id, contact_id, call_log_id, requested_time_text, address, notes, status,
                )
                if inspection_insert != "INSERT 0 1":
                    raise RuntimeError("inspection contact/call is outside the worker tenant")
                await conn.execute(
                    """
                    INSERT INTO ui_command_events (tenant_id, command_type, payload)
                    VALUES ($1, 'INSPECTION_REQUESTED', $2::jsonb)
                    """,
                    tenant_id,
                    json.dumps({"contactId": contact_id, "callLogId": call_log_id, "status": status}),
                )

    async def update_call_status(
        self,
        *,
        room_name: str,
        tenant_id: str,
        status: str,
        dire_reason: Optional[str] = None,
        briefing: Optional[str] = None,
    ) -> None:
        await self.pool.execute(
            """
            UPDATE call_logs
               SET status = $3::call_status,
                   dire_reason = COALESCE($4::dire_reason, dire_reason),
                   summary = COALESCE($5, summary),
                   updated_at = $6
             WHERE room_name = $1 AND tenant_id = $2
               AND status NOT IN ('completed', 'missed')
            """,
            room_name,
            tenant_id,
            status,
            dire_reason,
            briefing,
            _now(),
        )

    async def finalise_call(
        self,
        *,
        tenant_id: str,
        room_name: str,
        status: str,
        turns: list[dict[str, Any]],
        duration: int,
    ) -> None:
        await self.pool.execute(
            """
            UPDATE call_logs
               SET status = CASE
                     WHEN status IN ('completed', 'missed') THEN status
                     ELSE $3::call_status END,
                   transcript_full = CASE
                     WHEN jsonb_array_length(transcript_full) > 0
                      AND jsonb_array_length($4::jsonb) = 0
                     THEN transcript_full ELSE $4::jsonb END,
                   duration_seconds = GREATEST(duration_seconds, $5),
                   updated_at = now()
             WHERE room_name = $1 AND tenant_id = $2
            """,
            room_name,
            tenant_id,
            status,
            json.dumps(turns),
            max(0, duration),
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

    async def set_recording(
        self,
        *,
        room_name: str,
        tenant_id: str,
        status: str,
        path: Optional[str] = None,
        recorded_bytes: Optional[int] = None,
        error: Optional[str] = None,
    ) -> None:
        """Record a complete, SQL-CHECK-compatible recording outcome."""
        if status not in {"ok", "failed", "skipped"}:
            raise ValueError(f"invalid recording status: {status}")
        if status == "ok" and (not path or not recorded_bytes or recorded_bytes <= 0):
            raise ValueError("an ok recording requires a path and positive byte count")
        if status == "failed" and not error:
            raise ValueError("a failed recording requires an error")
        await self.pool.execute(
            """
            UPDATE call_logs
               SET recording_path   = $3,
                   recording_bytes  = $4,
                   recording_status = $5::varchar(20),
                   recording_error  = $6,
                   recording_url    = CASE WHEN $5::varchar(20) = 'ok'
                                           THEN '/api/recordings/' || id::text
                                           ELSE NULL END,
                   updated_at       = now()
             WHERE room_name = $1 AND tenant_id = $2
            """,
            room_name,
            tenant_id,
            path,
            recorded_bytes,
            status,
            error,
        )

    async def set_transcript(
        self,
        *,
        room_name: str,
        tenant_id: str,
        turns: list[dict[str, Any]],
        duration: int = 0,
    ) -> None:
        """Persist the conversation locally so it can be reviewed and shown.

        This is what fills the "Samtale" panel and what you paste into a
        reviewer to check whether the Danish was correct.
        """
        await self.pool.execute(
            """
            UPDATE call_logs
               SET transcript_full  = $3::jsonb,
                   duration_seconds = GREATEST(duration_seconds, $4),
                   updated_at       = now()
             WHERE room_name = $1 AND tenant_id = $2
            """,
            room_name,
            tenant_id,
            json.dumps(turns),
            max(0, duration),
        )
