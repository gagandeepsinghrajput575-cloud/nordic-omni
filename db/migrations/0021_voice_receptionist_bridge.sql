-- 0021 — Enterprise inbound voice receptionist bridge: provider bindings and a
-- durable call-session ledger.
--
-- Apply after 0020 as the schema owner. `omni_app` must not own these tables.
--
-- Two new tables, and no changes to existing ones:
--
--   tenant_telephony_bindings
--                         per-tenant provider routing for the voice receptionist:
--                         which ElevenLabs agent answers in which language, the
--                         acoustic tuning that drives barge-in, the Cal.com event
--                         type whose slots may be promised on a live call, and the
--                         number a call is forwarded to when the AI must not answer.
--                         This is the only place those five things live, so a
--                         dispatch webhook can ground a call in one read.
--
--   telephony_call_sessions
--                         the call ledger the bridge writes: monotonic status, the
--                         last measured turn latency, the transcript window and the
--                         barge-in telemetry. `web/src/lib/telephony` treats this
--                         table, not the in-memory SIP ledger, as the record of what
--                         actually happened on a call.
--
-- Why a status CHECK rather than free text: the TypeScript state machine in
-- `session-machine.ts` refuses reversals (a completed call cannot become active
-- again), and a database that accepted `active` after `completed` would let a
-- retried webhook rewrite history. The constraint below makes the same rule true
-- for anyone holding psql.
--
-- Why `language` is da-DK / en-GB rather than the tenants enum: `tenants
-- .default_language` records the operator's console preference (`en-US`), while
-- this column records what the *caller* heard. Conflating them is how a Danish
-- clinic ends up answering English-speaking callers in Danish.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Provider bindings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenant_telephony_bindings (
    tenant_id               UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    -- ElevenLabs Conversational AI agents. The English agent is optional: a
    -- tenant without one handles both languages with the Danish agent, which the
    -- prompt already instructs to follow the caller.
    elevenlabs_agent_id     TEXT,
    elevenlabs_agent_id_en  TEXT,
    elevenlabs_voice_id     TEXT,
    -- The provider reports its negotiated render; `audio_format_expectation` is
    -- what the tenant was configured for, so drift is visible instead of audible.
    audio_format_expectation TEXT NOT NULL DEFAULT 'pcm_16000'
        CHECK (audio_format_expectation IN ('pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'ulaw_8000')),
    vad_threshold           SMALLINT NOT NULL DEFAULT 65
        CHECK (vad_threshold BETWEEN 10 AND 90),
    barge_in_sensitivity    SMALLINT NOT NULL DEFAULT 85
        CHECK (barge_in_sensitivity BETWEEN 0 AND 100),
    -- 150 ms is the product contract; a tenant may only make it stricter, never
    -- looser, so no configuration can silently abandon the budget.
    barge_in_budget_ms      SMALLINT NOT NULL DEFAULT 150
        CHECK (barge_in_budget_ms BETWEEN 40 AND 150),
    echo_tail_ms            SMALLINT NOT NULL DEFAULT 90
        CHECK (echo_tail_ms BETWEEN 0 AND 400),
    speech_rate             NUMERIC(4, 3) NOT NULL DEFAULT 1.000
        CHECK (speech_rate BETWEEN 0.900 AND 1.100),
    calcom_event_type_id    TEXT,
    calcom_event_slug       TEXT,
    calcom_slot_minutes     SMALLINT NOT NULL DEFAULT 30
        CHECK (calcom_slot_minutes BETWEEN 10 AND 240),
    -- Where a call goes when the AI must not answer (paused DID, no grounding,
    -- human-forward mode). Nullable: no target means the bridge refuses, and a
    -- refusal is honest where a wrong forward is not.
    forward_to_phone        TEXT,
    timezone                VARCHAR(64) NOT NULL DEFAULT 'Europe/Copenhagen',
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_telephony_bindings_agent_shape
        CHECK (elevenlabs_agent_id IS NULL OR length(btrim(elevenlabs_agent_id)) > 0),
    CONSTRAINT tenant_telephony_bindings_forward_shape
        CHECK (forward_to_phone IS NULL OR forward_to_phone ~ '^\+[1-9][0-9]{6,14}$')
);

-- ---------------------------------------------------------------------------
-- 2. Call-session ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.telephony_call_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id         TEXT NOT NULL UNIQUE,
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    contact_id      UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    room_name       TEXT NOT NULL,
    dispatch_rule_id TEXT,
    caller_number   TEXT,
    dialed_number   TEXT,
    language        VARCHAR(5) NOT NULL
        CHECK (language IN ('da-DK', 'en-GB')),
    status          VARCHAR(16) NOT NULL DEFAULT 'connecting'
        CHECK (status IN ('connecting', 'active', 'transferring', 'completed', 'failed')),
    -- Measured speech-end -> first-audio-byte for the latest turn, in ms.
    latency_ms      INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms BETWEEN 0 AND 600000),
    barge_in_count  INTEGER NOT NULL DEFAULT 0 CHECK (barge_in_count >= 0),
    barge_in_over_budget INTEGER NOT NULL DEFAULT 0 CHECK (barge_in_over_budget >= 0),
    barge_in_worst_ms INTEGER NOT NULL DEFAULT 0 CHECK (barge_in_worst_ms >= 0),
    turn_count      INTEGER NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
    transcript      JSONB NOT NULL DEFAULT '[]'::jsonb,
    telemetry       JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider        TEXT NOT NULL DEFAULT 'elevenlabs'
        CHECK (provider IN ('elevenlabs', 'azure', 'browser_fallback')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    -- A call that ended must have started no later than it ended; the reverse is
    -- how a bad timezone on the writer looks like an infinite call.
    CONSTRAINT telephony_call_sessions_window CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_telephony_call_sessions_tenant_started
    ON public.telephony_call_sessions (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_telephony_call_sessions_open
    ON public.telephony_call_sessions (tenant_id, status)
    WHERE status IN ('connecting', 'active', 'transferring');

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
-- Agency members see every workspace; a client user sees only their own tenant.
-- A public contact capability (the browser showcase / call link) may read and
-- append its own call row, and nothing else: the tenant_id on the row is derived
-- from the capability by `app_public_tenant_id()`, never supplied by the caller.

ALTER TABLE public.tenant_telephony_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telephony_call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telephony_bindings_read ON public.tenant_telephony_bindings;
CREATE POLICY telephony_bindings_read ON public.tenant_telephony_bindings
    FOR SELECT TO omni_app
    USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

-- Bindings are agency-managed. A client user may read their own, never write: the
-- barge-in budget and the forward target are routing, and 0015 established that
-- routing columns belong to the agency.
DROP POLICY IF EXISTS telephony_bindings_write ON public.tenant_telephony_bindings;
CREATE POLICY telephony_bindings_write ON public.tenant_telephony_bindings
    FOR ALL TO omni_app
    USING (public.is_agency())
    WITH CHECK (public.is_agency());

DROP POLICY IF EXISTS telephony_sessions_read ON public.telephony_call_sessions;
CREATE POLICY telephony_sessions_read ON public.telephony_call_sessions
    FOR SELECT TO omni_app
    USING (
        (
            EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
            AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
        )
        OR (
            public.app_user_id() IS NULL
            AND tenant_id = public.app_public_tenant_id()
            AND contact_id = public.app_public_contact_id()
        )
    );

-- A session row is created by the bridge on behalf of the actor that owns the call,
-- which under RLS means: an authenticated agency/client user, or a public contact
-- capability. An anonymous identity with neither is refused by the policy, which is
-- the point — the bridge never needs an owner-level write for this table.
DROP POLICY IF EXISTS telephony_sessions_insert ON public.telephony_call_sessions;
CREATE POLICY telephony_sessions_insert ON public.telephony_call_sessions
    FOR INSERT TO omni_app
    WITH CHECK (
        (
            EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
            AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
        )
        OR (
            public.app_user_id() IS NULL
            AND tenant_id = public.app_public_tenant_id()
            AND contact_id = public.app_public_contact_id()
        )
    );

-- Updates are the state machine moving forward, so the actor test is identical.
DROP POLICY IF EXISTS telephony_sessions_update ON public.telephony_call_sessions;
CREATE POLICY telephony_sessions_update ON public.telephony_call_sessions
    FOR UPDATE TO omni_app
    USING (
        (
            EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
            AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
        )
        OR (
            public.app_user_id() IS NULL
            AND tenant_id = public.app_public_tenant_id()
            AND contact_id = public.app_public_contact_id()
        )
    )
    WITH CHECK (
        (
            EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
            AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
        )
        OR (
            public.app_user_id() IS NULL
            AND tenant_id = public.app_public_tenant_id()
            AND contact_id = public.app_public_contact_id()
        )
    );

-- No DELETE policy exists at all: a call record is a legal artefact of a recorded
-- conversation, and only a migration run by the owner may remove one.

GRANT SELECT ON public.tenant_telephony_bindings TO omni_app;
GRANT SELECT, INSERT, UPDATE ON public.telephony_call_sessions TO omni_app;

-- ---------------------------------------------------------------------------
-- 4. Monotonic status guard
-- ---------------------------------------------------------------------------
-- The TypeScript machine is the primary authority; this trigger is the backstop
-- for anything that writes the table by hand (an operator psql session, a replayed
-- webhook after a deploy). It rejects regressions out of band, in the same
-- direction the state machine moves.

CREATE OR REPLACE FUNCTION public.guard_telephony_session_progression()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    rank_old INTEGER;
    rank_new INTEGER;
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    rank_old := CASE OLD.status
        WHEN 'connecting' THEN 1
        WHEN 'active' THEN 2
        WHEN 'transferring' THEN 3
        WHEN 'completed' THEN 4
        WHEN 'failed' THEN 4
        ELSE 0
    END;
    rank_new := CASE NEW.status
        WHEN 'connecting' THEN 1
        WHEN 'active' THEN 2
        WHEN 'transferring' THEN 3
        WHEN 'completed' THEN 4
        WHEN 'failed' THEN 4
        ELSE 0
    END;

    -- `transferring -> active` is a legitimate hand-back (nobody answered), and
    -- `connecting -> *` is the normal path. Everything that moves a terminal call
    -- backwards is refused.
    IF rank_old = 4 AND rank_new < 4 THEN
        RAISE EXCEPTION 'telephony call % is %; a terminal call cannot return to %',
            OLD.call_id, OLD.status, NEW.status
            USING ERRCODE = '42501';
    END IF;
    IF rank_new < rank_old AND NOT (OLD.status = 'transferring' AND NEW.status = 'active') THEN
        RAISE EXCEPTION 'telephony call % cannot move backwards from % to %',
            OLD.call_id, OLD.status, NEW.status
            USING ERRCODE = '42501';
    END IF;

    IF NEW.status IN ('completed', 'failed') AND NEW.ended_at IS NULL THEN
        NEW.ended_at := NOW();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_telephony_session_progression ON public.telephony_call_sessions;
CREATE TRIGGER trg_guard_telephony_session_progression
    BEFORE UPDATE ON public.telephony_call_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_telephony_session_progression();

COMMIT;

-- Verification (run manually after applying):
--   select count(*) from tenant_telephony_bindings;     -- expect 0: defaults apply
--   select count(*) from telephony_call_sessions;       -- expect 0
-- As omni_app, a client user must see only their own tenant's calls:
--   begin; select set_config('app.user_id', '<client-owner-uuid>', true);
--   select count(*) from telephony_call_sessions; rollback;
