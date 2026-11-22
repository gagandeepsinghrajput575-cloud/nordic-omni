-- 0021 — Client Feature Provisioning, Master Opt-Out, and Email Whitelist
--
-- Enables white-label feature toggles per client workspace:
-- 1. `enabled_features`: JSONB array of permitted feature keys ('chatbot', 'antigravity', 'ai_caller', 'leads_crm', 'meta_ads', 'ai_seo', 'settings').
-- 2. `master_opt_out`: Boolean master kill switch that shuts down all AI capabilities for a client.
-- 3. `allowed_sender_emails`: JSONB array of whitelisted outbound sender emails for the client.
-- 4. Agency-only write protection: Only agency members can modify these feature flags.

BEGIN;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS enabled_features JSONB NOT NULL DEFAULT '["ai_caller", "chatbot", "leads_crm", "antigravity", "settings"]'::jsonb,
    ADD COLUMN IF NOT EXISTS master_opt_out BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS allowed_sender_emails JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Ensure omni_app has permissions to read and update these columns
GRANT SELECT (enabled_features, master_opt_out, allowed_sender_emails) ON tenants TO omni_app;
GRANT UPDATE (enabled_features, master_opt_out, allowed_sender_emails) ON tenants TO omni_app;

-- Update agency guard trigger so non-agency clients cannot toggle their own features
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
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.enabled_features IS DISTINCT FROM OLD.enabled_features
           OR NEW.master_opt_out IS DISTINCT FROM OLD.master_opt_out
           OR NEW.allowed_sender_emails IS DISTINCT FROM OLD.allowed_sender_emails THEN
            RAISE EXCEPTION 'Only agency staff may modify tenant identity, routing, status, or feature provisioning columns'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;
