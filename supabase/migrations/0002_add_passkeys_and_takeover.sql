-- ==============================================================================
-- MIGRATION: 0002_add_passkeys_and_takeover.sql
-- PROJECT: Multi-Tenant Omnichannel Voice & Meta AI Platform (NORDIC-OMNI)
-- DESCRIPTION: Adds client passkey security, AI prompt overrides, live human
--              takeover (AI Auto-Pilot pause/resume), and owner broadcast alerts.
-- ==============================================================================

-- 1. ADD PASSKEY & PROMPT OVERRIDES TO TENANTS
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS client_passkey VARCHAR(64) UNIQUE,
ADD COLUMN IF NOT EXISTS customer_system_prompt TEXT,
ADD COLUMN IF NOT EXISTS copilot_system_prompt TEXT,
ADD COLUMN IF NOT EXISTS active_broadcast_message TEXT,
ADD COLUMN IF NOT EXISTS ai_auto_reply_default BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_tenants_client_passkey ON tenants (client_passkey);

-- 2. ADD HUMAN TAKEOVER CONTROLS TO CONTACTS
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS ai_auto_reply_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS last_human_takeover_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_ai_auto_reply ON contacts (tenant_id, ai_auto_reply_enabled);

-- 3. SEED PASSKEYS & DEFAULT PROMPTS FOR INITIAL TENANTS
UPDATE tenants 
SET client_passkey = 'CPK-KBH-8899-DEMO',
    customer_system_prompt = COALESCE(customer_system_prompt, 'Du er AI-receptionisten for København VVS & Akut Døgnvagt. Vær autoritativ, rolig og handlingsorienteret på flydende dansk.'),
    copilot_system_prompt = COALESCE(copilot_system_prompt, 'Du er den personlige driftsassistent (God Mode) for Jens Møller hos København VVS.')
WHERE slug = 'kbh-vvs' AND client_passkey IS NULL;

UPDATE tenants 
SET client_passkey = 'CPK-DENTAL-1234-DEMO',
    customer_system_prompt = COALESCE(customer_system_prompt, 'You are the bilingual AI receptionist for Nordic Dental Strøget. Assist international expats and local Danes with dental care.'),
    copilot_system_prompt = COALESCE(copilot_system_prompt, 'You are the executive AI operations co-pilot for Dr. Mette Lind at Nordic Dental Strøget.')
WHERE slug = 'nordic-dental' AND client_passkey IS NULL;
