-- Tenant members can close an escalation they have handled.
BEGIN;
DROP POLICY IF EXISTS escalations_member_update ON conversation_escalations;
CREATE POLICY escalations_member_update ON conversation_escalations FOR UPDATE
    USING (is_tenant_member(tenant_id) OR is_agency())
    WITH CHECK (is_tenant_member(tenant_id) OR is_agency());
COMMIT;
