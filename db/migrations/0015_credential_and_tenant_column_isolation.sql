-- 0015 — Credential column isolation and agency-controlled tenant columns
--
-- 1. `users.password_hash` and `sessions` are authentication secrets read and
--    managed strictly through `adminSql` inside server auth boundaries.
--    Revoking them from `omni_app` ensures no `withUser()` / RLS query can ever
--    read `password_hash`, access `sessions`, or mutate `agency_members` /
--    `tenant_members`. (RLS helpers `is_agency()`, `is_tenant_member()`, and
--    `is_tenant_owner()` are SECURITY DEFINER and continue working unchanged.)
-- 2. Non-agency `omni_app` sessions (tenant owners) may update only business
--    facts (`owner_name`, `owner_phone`, `owner_email`,
--    `active_broadcast_message`, `business_hours`, `pricing_catalog`,
--    `ai_auto_reply_default`, `updated_at`), never agency-managed identity,
--    routing, or status columns.

BEGIN;

REVOKE ALL ON users FROM omni_app;
GRANT SELECT (id, email, full_name, is_active, created_at, updated_at) ON users TO omni_app;
GRANT UPDATE (full_name, updated_at) ON users TO omni_app;

REVOKE ALL ON sessions FROM omni_app;
REVOKE INSERT, UPDATE, DELETE ON agency_members FROM omni_app;
REVOKE INSERT, UPDATE, DELETE ON tenant_members FROM omni_app;

CREATE OR REPLACE FUNCTION guard_tenant_agency_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_user = 'omni_app' AND NOT is_agency() THEN
        IF NEW.name IS DISTINCT FROM OLD.name
           OR NEW.slug IS DISTINCT FROM OLD.slug
           OR NEW.flynumber_did IS DISTINCT FROM OLD.flynumber_did
           OR NEW.meta_phone_number_id IS DISTINCT FROM OLD.meta_phone_number_id
           OR NEW.default_language IS DISTINCT FROM OLD.default_language
           OR NEW.telephony_mode IS DISTINCT FROM OLD.telephony_mode
           OR NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Only agency staff may modify tenant identity, routing, or status columns'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tenant_agency_columns ON tenants;
CREATE TRIGGER trg_guard_tenant_agency_columns
    BEFORE UPDATE ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION guard_tenant_agency_columns();

COMMIT;
