-- ============================================================================
-- 0019: Direct Agency <-> Client Omnichannel Chat & Co-Pilot Bridge
--       (Trekants-Kommunikation)
-- ============================================================================
--
-- One unified thread per (tenant, contact) that the agency operator and the
-- client both write into, with the AI co-pilot as a third participant.
--
-- Design notes:
--
--   * `sender_role` is a real enum with a CHECK, not free text. A client must
--     never be able to persist 'agency_operator' by sending a crafted body; the
--     route stamps the role from the session, and this column is the backstop.
--
--   * `agency_client_chat_state.ai_enabled` is the human-takeover latch. It is a
--     row per tenant rather than component state, so "an operator spoke, so the
--     bot stays quiet" survives reloads and applies to the client's endpoint too.
--
--   * The co-pilot may never write a fact it cannot ground. Mutations it
--     proposes live in `copilot_mutations` with status 'proposed' and are only
--     applied by an explicit human approval call.
--
--   * RLS is the second line of defence; the routes authorize first. Both read
--     the same helpers as the rest of the schema (is_agency / is_tenant_owner
--     plus the active-user guard introduced in 0015).

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ACTOR ROLES
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_sender_role') THEN
        CREATE TYPE chat_sender_role AS ENUM ('agency_operator', 'client', 'ai_copilot');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_message_kind') THEN
        CREATE TYPE chat_message_kind AS ENUM ('message', 'delegation', 'system');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'copilot_delegation_status') THEN
        CREATE TYPE copilot_delegation_status AS ENUM ('pending', 'sent', 'answered', 'closed');
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. MESSAGES
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agency_client_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- The client's contact row. Null only for agency-only threads.
    contact_id      UUID REFERENCES contacts(id) ON DELETE CASCADE,
    sender_role     chat_sender_role NOT NULL,
    -- The user row (agency/portal) behind the role. NULL for the co-pilot,
    -- which has no session identity of its own.
    sender_ref      UUID,
    channel         VARCHAR(24) NOT NULL DEFAULT 'web_chat'
                    CHECK (channel IN ('web_chat', 'whatsapp', 'voice_inbound', 'portal')),
    kind            chat_message_kind NOT NULL DEFAULT 'message',
    body            TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
    delegation_id   UUID,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- The co-pilot is a system actor: it must never be attributed to a person.
    CONSTRAINT agency_client_messages_copilot_has_no_ref
        CHECK (sender_role <> 'ai_copilot' OR sender_ref IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_agency_client_messages_thread
    ON agency_client_messages (tenant_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_client_messages_tenant_created
    ON agency_client_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_client_messages_delegation
    ON agency_client_messages (delegation_id) WHERE delegation_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. DELEGATIONS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS copilot_delegations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
    status              copilot_delegation_status NOT NULL DEFAULT 'pending',
    -- The operator's words, verbatim. Never rewritten: it is the audit trail.
    instruction         TEXT NOT NULL CHECK (length(btrim(instruction)) BETWEEN 4 AND 600),
    topic               TEXT,
    question            TEXT,
    answer              TEXT,
    summary             TEXT,
    -- True when the co-pilot could not ground the answer in agency data.
    needs_agency_input  BOOLEAN NOT NULL DEFAULT FALSE,
    created_by          UUID NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,

    -- An answered delegation must carry both the question we asked and the
    -- answer we got; otherwise the operator cannot audit what was agreed.
    CONSTRAINT copilot_delegations_answered_is_complete
        CHECK (status <> 'answered' OR (question IS NOT NULL AND answer IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_copilot_delegations_tenant_status
    ON copilot_delegations (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_delegations_contact
    ON copilot_delegations (contact_id, created_at DESC);

ALTER TABLE agency_client_messages
    DROP CONSTRAINT IF EXISTS agency_client_messages_delegation_fk;
ALTER TABLE agency_client_messages
    ADD CONSTRAINT agency_client_messages_delegation_fk
    FOREIGN KEY (delegation_id) REFERENCES copilot_delegations(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 4. PROPOSED MUTATIONS (staged, never auto-applied)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS copilot_mutations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind          VARCHAR(32) NOT NULL
                  CHECK (kind IN ('pricing', 'business_hours', 'owner_contact', 'broadcast')),
    -- Danish one-liner shown to the approver.
    summary       TEXT NOT NULL CHECK (length(btrim(summary)) > 0),
    -- [{ field, before, after }] — the exact human-reviewable delta.
    diff          JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- The machine change, applied only on explicit approval.
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    status        VARCHAR(16) NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed', 'approved', 'rejected')),
    proposed_by   UUID,
    decided_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_copilot_mutations_tenant_status
    ON copilot_mutations (tenant_id, status, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. PER-TENANT CHAT STATE (the human-takeover latch)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agency_client_chat_state (
    tenant_id      UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    ai_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    paused_reason  TEXT,
    updated_by     UUID,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 6. ROLE STAMPING BACKSTOP
-- ----------------------------------------------------------------------------
--
-- A portal session must never insert an agency_operator or ai_copilot row, even
-- if the API layer were bypassed. RLS already limits which tenants are visible;
-- this pins which *roles* a non-agency session may claim.

CREATE OR REPLACE FUNCTION guard_chat_sender_role() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
    -- omni_app runs with app.user_id set. Agency staff may speak as the agency.
    IF NEW.sender_role IN ('agency_operator', 'ai_copilot') AND NOT public.is_agency() THEN
        RAISE EXCEPTION 'only agency sessions may post as %', NEW.sender_role;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agency_client_messages_role_guard ON agency_client_messages;
CREATE TRIGGER agency_client_messages_role_guard
    BEFORE INSERT ON agency_client_messages
    FOR EACH ROW EXECUTE FUNCTION guard_chat_sender_role();

-- Messages are append-only evidence of what was said. Editing or deleting a
-- message after the fact would break the operator's audit trail.
CREATE OR REPLACE FUNCTION guard_chat_message_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'chat messages are append-only';
END;
$$;

DROP TRIGGER IF EXISTS agency_client_messages_immutable ON agency_client_messages;
CREATE TRIGGER agency_client_messages_immutable
    BEFORE UPDATE OR DELETE ON agency_client_messages
    FOR EACH ROW EXECUTE FUNCTION guard_chat_message_immutable();

-- A delegation may only move forward through its lifecycle.
CREATE OR REPLACE FUNCTION guard_delegation_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
    IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
        RAISE EXCEPTION 'a closed delegation cannot be reopened';
    END IF;
    IF OLD.status = 'answered' AND NEW.status = 'pending' THEN
        RAISE EXCEPTION 'an answered delegation cannot return to pending';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS copilot_delegations_transition ON copilot_delegations;
CREATE TRIGGER copilot_delegations_transition
    BEFORE UPDATE ON copilot_delegations
    FOR EACH ROW EXECUTE FUNCTION guard_delegation_transition();

-- tenant_id is immutable on every table that carries it (0013 helper).
DROP TRIGGER IF EXISTS agency_client_messages_tenant_immutable ON agency_client_messages;
CREATE TRIGGER agency_client_messages_tenant_immutable
    BEFORE UPDATE ON agency_client_messages
    FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment();

DROP TRIGGER IF EXISTS copilot_delegations_tenant_immutable ON copilot_delegations;
CREATE TRIGGER copilot_delegations_tenant_immutable
    BEFORE UPDATE ON copilot_delegations
    FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment();

DROP TRIGGER IF EXISTS copilot_mutations_tenant_immutable ON copilot_mutations;
CREATE TRIGGER copilot_mutations_tenant_immutable
    BEFORE UPDATE ON copilot_mutations
    FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment();

-- ----------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
--
-- Every policy repeats the active-user guard: a deactivated user must lose
-- access even if their session token is still valid.

ALTER TABLE agency_client_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_delegations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_mutations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_client_chat_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agency_client_messages_read ON agency_client_messages;
CREATE POLICY agency_client_messages_read ON agency_client_messages
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS agency_client_messages_write ON agency_client_messages;
CREATE POLICY agency_client_messages_write ON agency_client_messages
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS copilot_delegations_read ON copilot_delegations;
CREATE POLICY copilot_delegations_read ON copilot_delegations
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS copilot_delegations_write ON copilot_delegations;
CREATE POLICY copilot_delegations_write ON copilot_delegations
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS copilot_delegations_update ON copilot_delegations;
CREATE POLICY copilot_delegations_update ON copilot_delegations
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS copilot_mutations_read ON copilot_mutations;
CREATE POLICY copilot_mutations_read ON copilot_mutations
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS copilot_mutations_write ON copilot_mutations;
CREATE POLICY copilot_mutations_write ON copilot_mutations
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS copilot_mutations_update ON copilot_mutations;
CREATE POLICY copilot_mutations_update ON copilot_mutations
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS agency_client_chat_state_read ON agency_client_chat_state;
CREATE POLICY agency_client_chat_state_read ON agency_client_chat_state
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS agency_client_chat_state_write ON agency_client_chat_state;
CREATE POLICY agency_client_chat_state_write ON agency_client_chat_state
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

DROP POLICY IF EXISTS agency_client_chat_state_update ON agency_client_chat_state;
CREATE POLICY agency_client_chat_state_update ON agency_client_chat_state
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
        AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
    );

-- ----------------------------------------------------------------------------
-- 8. GRANTS
-- ----------------------------------------------------------------------------

GRANT SELECT, INSERT ON public.agency_client_messages TO omni_app;
GRANT SELECT, INSERT, UPDATE ON public.copilot_delegations TO omni_app;
GRANT SELECT, INSERT, UPDATE ON public.copilot_mutations TO omni_app;
GRANT SELECT, INSERT, UPDATE ON public.agency_client_chat_state TO omni_app;

COMMIT;
