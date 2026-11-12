-- Public contact capabilities use omni_app/RLS, not the table-owner pool.
-- Estimate and inspection INSERT policies remain intentionally absent: those
-- records are written only by trusted server-side worker/backend operations.
BEGIN;

CREATE OR REPLACE FUNCTION app_public_contact_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
    SELECT NULLIF(current_setting('app.public_contact_id', true), '')::uuid;
$$;

-- SECURITY DEFINER avoids recursive contacts RLS. It derives tenant identity
-- from the contact itself; a caller-supplied tenant UUID is never authority.
CREATE OR REPLACE FUNCTION app_public_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT tenant_id FROM public.contacts WHERE id = app_public_contact_id();
$$;

REVOKE ALL ON FUNCTION app_public_contact_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_public_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_public_contact_id() TO omni_app;
GRANT EXECUTE ON FUNCTION app_public_tenant_id() TO omni_app;

DROP POLICY IF EXISTS contacts_public_read ON contacts;
CREATE POLICY contacts_public_read ON contacts FOR SELECT
    USING (id = app_public_contact_id());
DROP POLICY IF EXISTS contacts_public_update ON contacts;
CREATE POLICY contacts_public_update ON contacts FOR UPDATE
    USING (id = app_public_contact_id())
    WITH CHECK (id = app_public_contact_id() AND tenant_id = app_public_tenant_id());

DROP POLICY IF EXISTS tenants_public_read ON tenants;
CREATE POLICY tenants_public_read ON tenants FOR SELECT
    USING (id = app_public_tenant_id());
DROP POLICY IF EXISTS agent_config_public_read ON tenant_agent_config;
CREATE POLICY agent_config_public_read ON tenant_agent_config FOR SELECT
    USING (tenant_id = app_public_tenant_id());
DROP POLICY IF EXISTS knowledge_public_read ON knowledge_items;
CREATE POLICY knowledge_public_read ON knowledge_items FOR SELECT
    USING (tenant_id = app_public_tenant_id() AND is_active = true);

DROP POLICY IF EXISTS messages_public_read ON messages;
CREATE POLICY messages_public_read ON messages FOR SELECT
    USING (contact_id = app_public_contact_id() AND tenant_id = app_public_tenant_id());
DROP POLICY IF EXISTS messages_public_write ON messages;
CREATE POLICY messages_public_write ON messages FOR INSERT
    WITH CHECK (contact_id = app_public_contact_id() AND tenant_id = app_public_tenant_id());

DROP POLICY IF EXISTS escalations_public_read ON conversation_escalations;
CREATE POLICY escalations_public_read ON conversation_escalations FOR SELECT
    USING (contact_id = app_public_contact_id() AND tenant_id = app_public_tenant_id());
DROP POLICY IF EXISTS escalations_public_write ON conversation_escalations;
CREATE POLICY escalations_public_write ON conversation_escalations FOR INSERT
    WITH CHECK (contact_id = app_public_contact_id() AND tenant_id = app_public_tenant_id());
DROP POLICY IF EXISTS escalations_public_notification_update ON conversation_escalations;
CREATE POLICY escalations_public_notification_update ON conversation_escalations FOR UPDATE
    USING (contact_id = app_public_contact_id() AND tenant_id = app_public_tenant_id())
    WITH CHECK (contact_id = app_public_contact_id() AND tenant_id = app_public_tenant_id());

-- WITH CHECK alone must never turn an UPDATE into cross-tenant reassignment.
CREATE OR REPLACE FUNCTION prevent_tenant_reassignment() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'tenant_id is immutable';
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'tenant_members', 'tenant_agent_config', 'agent_config_history',
        'contacts', 'messages', 'call_logs', 'ui_command_events',
        'knowledge_items', 'project_estimates', 'inspection_requests',
        'knowledge_sources', 'knowledge_bundles', 'conversation_escalations'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_immutable_tenant ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_immutable_tenant BEFORE UPDATE OF tenant_id ON %I
             FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment()', t);
    END LOOP;
END $$;

ALTER TABLE project_estimates
    DROP CONSTRAINT IF EXISTS project_estimates_square_meters_check;
ALTER TABLE project_estimates
    ADD CONSTRAINT project_estimates_square_meters_check
    CHECK (square_meters IS NULL OR (square_meters > 0 AND square_meters <= 100000));

CREATE INDEX IF NOT EXISTS idx_messages_tenant_contact_created
    ON messages (tenant_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_estimates_tenant_contact_created
    ON project_estimates (tenant_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspection_requests_tenant_contact_created
    ON inspection_requests (tenant_id, contact_id, created_at DESC);

COMMIT;
