-- Agency control plane: workspace lifecycle, sub-account logins, reception mode,
-- and a durable outbound webhook outbox. Client logins never gain access to the
-- agency-only tables or management actions.

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('active', 'paused', 'suspended', 'archived'));

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reception_mode VARCHAR(20) NOT NULL DEFAULT 'voice_ai'
    CHECK (reception_mode IN ('voice_ai', 'human_forward', 'hybrid'));

COMMENT ON COLUMN tenants.reception_mode IS
    'Agency-controlled reception policy: voice_ai dispatches the AI; hybrid lets AI answer and escalate; human_forward disables AI dispatch and routes SIP calls to the owner when an outbound SIP trunk is configured.';

-- RLS permits an owner to update business facts, but not operational controls.
-- Column-level enforcement also covers a compromised/forged client action.
CREATE OR REPLACE FUNCTION guard_agency_tenant_controls() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF session_user::regrole::oid <> (SELECT relowner FROM pg_class WHERE oid = TG_RELID)
       AND NOT is_agency() AND (
        NEW.status IS DISTINCT FROM OLD.status OR
        NEW.reception_mode IS DISTINCT FROM OLD.reception_mode OR
        NEW.telephony_mode IS DISTINCT FROM OLD.telephony_mode OR
        NEW.flynumber_did IS DISTINCT FROM OLD.flynumber_did
       ) THEN
        RAISE EXCEPTION 'Only the agency may change workspace controls' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_agency_tenant_controls ON tenants;
CREATE TRIGGER trg_agency_tenant_controls BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION guard_agency_tenant_controls();

-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_members_agency_update ON tenant_members;
CREATE POLICY tenant_members_agency_update ON tenant_members FOR UPDATE
    USING (is_agency()) WITH CHECK (is_agency());
DROP POLICY IF EXISTS tenant_members_agency_delete ON tenant_members;
CREATE POLICY tenant_members_agency_delete ON tenant_members FOR DELETE
    USING (is_agency());

CREATE TABLE IF NOT EXISTS user_security (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    session_version INT NOT NULL DEFAULT 0,
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_security ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_security_read ON user_security;
CREATE POLICY user_security_read ON user_security FOR SELECT
    USING (user_id = app_user_id() OR is_agency());
DROP POLICY IF EXISTS user_security_agency_insert ON user_security;
CREATE POLICY user_security_agency_insert ON user_security FOR INSERT
    WITH CHECK (is_agency());
DROP POLICY IF EXISTS user_security_agency_update ON user_security;
CREATE POLICY user_security_agency_update ON user_security FOR UPDATE
    USING (is_agency()) WITH CHECK (is_agency());
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION complete_password_change(p_user_id UUID, p_hash TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_user_id IS DISTINCT FROM app_user_id() THEN RAISE EXCEPTION 'Not permitted'; END IF;
    UPDATE users SET password_hash = p_hash WHERE id = p_user_id;
    UPDATE user_security SET must_change_password = false, updated_at = now() WHERE user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION complete_password_change(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_password_change(UUID, TEXT) TO omni_app;

CREATE OR REPLACE FUNCTION provision_tenant_member(
    p_tenant_id UUID, p_email TEXT, p_password_hash TEXT,
    p_full_name TEXT, p_role TEXT, p_is_new BOOLEAN
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID;
BEGIN
    IF NOT is_agency() THEN RAISE EXCEPTION 'Agency access required'; END IF;
    IF p_role NOT IN ('owner', 'staff') THEN RAISE EXCEPTION 'Invalid membership role'; END IF;
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
        RAISE EXCEPTION 'Workspace not found';
    END IF;
    IF p_is_new THEN
        IF EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(p_email)) THEN
            RAISE EXCEPTION 'EMAIL_EXISTS';
        END IF;
        INSERT INTO users (email, password_hash, full_name)
        VALUES (lower(p_email), p_password_hash, p_full_name) RETURNING id INTO v_user_id;
    ELSE
        SELECT id INTO v_user_id FROM users WHERE lower(email) = lower(p_email) FOR UPDATE;
        IF v_user_id IS NULL OR EXISTS (SELECT 1 FROM agency_members WHERE user_id = v_user_id)
           OR EXISTS (SELECT 1 FROM tenant_members WHERE user_id = v_user_id AND tenant_id <> p_tenant_id) THEN
            RAISE EXCEPTION 'Account is not available in this workspace';
        END IF;
    END IF;
    INSERT INTO tenant_members (tenant_id, user_id, role)
    VALUES (p_tenant_id, v_user_id, p_role)
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role;
    UPDATE users SET is_active = true WHERE id = v_user_id;
    INSERT INTO user_security (user_id, session_version, must_change_password)
    VALUES (v_user_id, 1, true)
    ON CONFLICT (user_id) DO UPDATE
      SET session_version = user_security.session_version + 1,
          must_change_password = true, updated_at = now();
    DELETE FROM sessions WHERE user_id = v_user_id;
    RETURN v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION provision_tenant_member(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_tenant_member(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO omni_app;

-- Outbound webhooks. NULL tenant_id = agency-global (every workspace).
-- Secrets are readable only through agency RLS; the UI masks them after save.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    url         TEXT NOT NULL,
    secret      TEXT NOT NULL,
    events      TEXT[] NOT NULL DEFAULT ARRAY['call.started','call.completed','call.missed','lead.created','lead.updated','escalation.created','escalation.resolved'],
    is_enabled  BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_scope ON webhook_endpoints (tenant_id, is_enabled);

CREATE TABLE IF NOT EXISTS webhook_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    event_type  VARCHAR(60) NOT NULL,
    entity_id   UUID,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON webhook_events (created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id     UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_id        UUID NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sending', 'delivered', 'failed', 'cancelled')),
    attempts        INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    response_status INT,
    error           TEXT,
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (endpoint_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
    ON webhook_deliveries (next_attempt_at, created_at) WHERE status IN ('pending', 'failed');

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_endpoints_agency ON webhook_endpoints;
CREATE POLICY webhook_endpoints_agency ON webhook_endpoints FOR ALL
    USING (is_agency()) WITH CHECK (is_agency());
DROP POLICY IF EXISTS webhook_events_agency ON webhook_events;
CREATE POLICY webhook_events_agency ON webhook_events FOR ALL
    USING (is_agency()) WITH CHECK (is_agency());
DROP POLICY IF EXISTS webhook_deliveries_agency ON webhook_deliveries;
CREATE POLICY webhook_deliveries_agency ON webhook_deliveries FOR ALL
    USING (is_agency()) WITH CHECK (is_agency());

-- Fan out one durable event to every matching enabled endpoint.
CREATE OR REPLACE FUNCTION enqueue_webhook_event(
    p_tenant_id UUID, p_event_type TEXT, p_entity_id UUID, p_payload JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id UUID;
BEGIN
    INSERT INTO webhook_events (tenant_id, event_type, entity_id, payload)
    VALUES (p_tenant_id, p_event_type, p_entity_id, p_payload)
    RETURNING id INTO v_event_id;

    INSERT INTO webhook_deliveries (endpoint_id, event_id)
    SELECT e.id, v_event_id
    FROM webhook_endpoints e
    WHERE e.is_enabled
      AND (e.tenant_id IS NULL OR e.tenant_id = p_tenant_id)
      AND p_event_type = ANY(e.events)
    ON CONFLICT (endpoint_id, event_id) DO NOTHING;

    RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION webhook_contact_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM enqueue_webhook_event(NEW.tenant_id, 'lead.created', NEW.id, jsonb_build_object(
            'id', NEW.id, 'tenantId', NEW.tenant_id, 'name', NEW.full_name,
            'phone', NEW.phone_number, 'email', NEW.email, 'stage', NEW.pipeline_stage,
            'estimatedValueDkk', NEW.estimated_value_dkk, 'createdAt', NEW.created_at));
    ELSIF TG_OP = 'UPDATE' AND (
        NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage
        OR NEW.estimated_value_dkk IS DISTINCT FROM OLD.estimated_value_dkk
        OR NEW.ai_auto_reply_enabled IS DISTINCT FROM OLD.ai_auto_reply_enabled
    ) THEN
        PERFORM enqueue_webhook_event(NEW.tenant_id, 'lead.updated', NEW.id, jsonb_build_object(
            'id', NEW.id, 'tenantId', NEW.tenant_id, 'name', NEW.full_name,
            'stage', NEW.pipeline_stage, 'estimatedValueDkk', NEW.estimated_value_dkk,
            'aiAutoReplyEnabled', NEW.ai_auto_reply_enabled, 'updatedAt', NEW.updated_at));
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION webhook_call_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN v_event := 'call.started';
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
          AND NEW.status IN ('completed', 'missed') THEN
        v_event := CASE WHEN NEW.status = 'completed' THEN 'call.completed' ELSE 'call.missed' END;
    END IF;
    IF v_event IS NOT NULL THEN
        PERFORM enqueue_webhook_event(NEW.tenant_id, v_event, NEW.id, jsonb_build_object(
            'id', NEW.id, 'tenantId', NEW.tenant_id, 'contactId', NEW.contact_id,
            'status', NEW.status, 'channel', NEW.channel, 'roomName', NEW.room_name,
            'durationSeconds', NEW.duration_seconds, 'createdAt', NEW.created_at));
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION webhook_escalation_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM enqueue_webhook_event(NEW.tenant_id, 'escalation.created', NEW.id, jsonb_build_object(
            'id', NEW.id, 'tenantId', NEW.tenant_id, 'contactId', NEW.contact_id,
            'reason', NEW.reason, 'urgency', NEW.urgency, 'briefing', NEW.briefing,
            'status', NEW.status, 'createdAt', NEW.created_at));
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM enqueue_webhook_event(NEW.tenant_id, 'escalation.resolved', NEW.id, jsonb_build_object(
            'id', NEW.id, 'tenantId', NEW.tenant_id, 'contactId', NEW.contact_id,
            'status', NEW.status, 'resolvedAt', NEW.resolved_at));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webhook_contacts ON contacts;
CREATE TRIGGER trg_webhook_contacts AFTER INSERT OR UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION webhook_contact_event();
DROP TRIGGER IF EXISTS trg_webhook_calls ON call_logs;
CREATE TRIGGER trg_webhook_calls AFTER INSERT OR UPDATE ON call_logs
    FOR EACH ROW EXECUTE FUNCTION webhook_call_event();
DROP TRIGGER IF EXISTS trg_webhook_escalations ON conversation_escalations;
CREATE TRIGGER trg_webhook_escalations AFTER INSERT OR UPDATE ON conversation_escalations
    FOR EACH ROW EXECUTE FUNCTION webhook_escalation_event();

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['webhook_endpoints','webhook_deliveries'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$I', t);
        EXECUTE format('CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_endpoints, webhook_events, webhook_deliveries TO omni_app;
GRANT EXECUTE ON FUNCTION enqueue_webhook_event(UUID, TEXT, UUID, JSONB) TO omni_app;
