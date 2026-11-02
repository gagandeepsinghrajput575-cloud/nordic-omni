-- ==============================================================================
-- MIGRATION: 0001_baseline.sql
-- PROJECT:   NORDIC-OMNI
-- TARGET:    Plain PostgreSQL 15+ (self-hosted). NO Supabase, NO PostgREST.
-- PURPOSE:   Tenancy model, Facts vs Behaviour split, single message table,
--            and RLS enforcement. This file supersedes
--            supabase/migrations/0001 + 0002.
--
-- DESIGN RULE (locked):
--   FACTS      -> client-editable   -> tenants
--   BEHAVIOUR  -> agency-only      -> tenant_agent_config
--   This boundary is enforced by Row Level Security, NOT by hiding UI buttons.
-- ==============================================================================

-- 1. EXTENSIONS -----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgvector is optional; nothing in the application uses it yet.
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable - continuing without it';
END $$;

-- 2. ENUMS ----------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE language_code AS ENUM ('da-DK', 'en-US');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE telephony_mode AS ENUM ('zero_cost_webrtc', 'paid_sip_trunk');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE pipeline_stage AS ENUM (
        'new_lead', 'contacted', 'qualified', 'booked',
        'dire_escalated', 'closed_won', 'closed_lost'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE channel_type AS ENUM (
        'lead_form', 'whatsapp', 'instagram',
        'voice_inbound', 'voice_instant_webrtc', 'owner_whisper'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE call_status AS ENUM (
        'ringing', 'in_progress', 'dire_hold_for_owner',
        'owner_consulting_ai', 'merged_live_with_owner',
        'ai_relaying_owner_instruction', 'completed', 'missed'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE dire_reason AS ENUM (
        'angry_customer', 'high_value_emergency', 'ai_unanswered_question'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. IDENTITY: users + sessions -------------------------------------------------
-- Replaces Supabase Auth AND the client-side passkey modal.
-- Sessions are server-side rows so they can be revoked instantly.

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     VARCHAR(255),
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, expires_at DESC);

-- Agency staff: full access to every tenant. This is the "God mode" role.
CREATE TABLE IF NOT EXISTS agency_members (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL DEFAULT 'admin'
               CHECK (role IN ('admin', 'support')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Client staff: access to ONE tenant, with a role that limits what they may write.
CREATE TABLE IF NOT EXISTS tenant_members (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id  UUID NOT NULL,
    role       VARCHAR(20) NOT NULL DEFAULT 'owner'
               CHECK (role IN ('owner', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON tenant_members (tenant_id);

-- 4. TENANTS (FACTS — client-editable) -----------------------------------------
-- Contains ONLY business facts. No prompts. No credentials.
-- Removed vs. old schema: owner_pin, client_passkey, customer_system_prompt,
-- copilot_system_prompt, system_prompt_overrides.

CREATE TABLE IF NOT EXISTS tenants (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                      VARCHAR(255) NOT NULL,
    slug                      VARCHAR(100) UNIQUE NOT NULL,
    flynumber_did             VARCHAR(50) UNIQUE,
    -- Meta/WhatsApp business phone_number_id. The ONLY safe way to route an
    -- inbound WhatsApp message to a tenant. Never guess from created_at.
    meta_phone_number_id      VARCHAR(64) UNIQUE,
    owner_name                VARCHAR(255) NOT NULL,
    owner_phone               VARCHAR(50) NOT NULL,
    owner_email               VARCHAR(255) NOT NULL,
    default_language          language_code NOT NULL DEFAULT 'da-DK',
    telephony_mode            telephony_mode NOT NULL DEFAULT 'zero_cost_webrtc',
    business_hours            JSONB NOT NULL DEFAULT '{
        "mon": {"open": "08:00", "close": "16:30", "closed": false},
        "tue": {"open": "08:00", "close": "16:30", "closed": false},
        "wed": {"open": "08:00", "close": "16:30", "closed": false},
        "thu": {"open": "08:00", "close": "16:30", "closed": false},
        "fri": {"open": "08:00", "close": "15:00", "closed": false},
        "sat": {"open": "09:00", "close": "13:00", "closed": true},
        "sun": {"open": "00:00", "close": "00:00", "closed": true}
    }'::jsonb,
    pricing_catalog           JSONB NOT NULL DEFAULT '[]'::jsonb,
    active_broadcast_message  TEXT,
    ai_auto_reply_default     BOOLEAN NOT NULL DEFAULT true,
    status                    VARCHAR(20) NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'paused', 'archived')),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);

ALTER TABLE tenant_members DROP CONSTRAINT IF EXISTS fk_tenant_members_tenant;
ALTER TABLE tenant_members
    ADD CONSTRAINT fk_tenant_members_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- 5. TENANT AGENT CONFIG (BEHAVIOUR — agency-only) -----------------------------
-- Split out so a client can READ how their AI behaves but can never WRITE it.
-- RLS enforces this: there is no client INSERT/UPDATE policy on this table.

CREATE TABLE IF NOT EXISTS tenant_agent_config (
    tenant_id              UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    customer_system_prompt TEXT NOT NULL,
    copilot_system_prompt  TEXT NOT NULL,
    greeting_script        TEXT,
    escalation_policy      JSONB NOT NULL DEFAULT '{
        "emergency_keywords": ["akut", "vandskade", "oversvømmelse", "sprængt",
                               "emergency", "urgent", "flood", "burst", "leak"],
        "emergency_fee_dkk": 2200,
        "always_escalate_on_human_request": true,
        "min_lead_score_to_book": 50
    }'::jsonb,
    voice_id               VARCHAR(100),
    stt_language           VARCHAR(20) NOT NULL DEFAULT 'multi',
    updated_by             UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prompt version history: lets the agency roll back a bad prompt.
CREATE TABLE IF NOT EXISTS agent_config_history (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_system_prompt TEXT NOT NULL,
    copilot_system_prompt  TEXT NOT NULL,
    greeting_script        TEXT,
    escalation_policy      JSONB,
    voice_id               VARCHAR(100),
    changed_by             UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_config_history_tenant
    ON agent_config_history (tenant_id, changed_at DESC);

-- 6. CONTACTS -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number           VARCHAR(50),
    email                  VARCHAR(255),
    full_name              VARCHAR(255),
    instagram_handle       VARCHAR(100),
    preferred_channel      channel_type NOT NULL DEFAULT 'whatsapp',
    preferred_language     VARCHAR(10) NOT NULL DEFAULT 'da'
                           CHECK (preferred_language IN ('da', 'en')),
    lead_score             INTEGER NOT NULL DEFAULT 50
                           CHECK (lead_score >= 0 AND lead_score <= 100),
    estimated_value_dkk    NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    pipeline_stage         pipeline_stage NOT NULL DEFAULT 'new_lead',
    ai_auto_reply_enabled  BOOLEAN NOT NULL DEFAULT true,
    last_human_takeover_at TIMESTAMPTZ,
    shared_memory_summary  TEXT NOT NULL DEFAULT '',
    sentiment_score        NUMERIC(3, 2) NOT NULL DEFAULT 7.50,
    metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone   ON contacts (tenant_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_stage   ON contacts (tenant_id, pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_updated ON contacts (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_ai_reply       ON contacts (tenant_id, ai_auto_reply_enabled);

-- 7. MESSAGES (SINGLE TABLE) ----------------------------------------------------
-- Replaces BOTH omnichannel_messages and messages. The old schema wrote every
-- webhook message into two tables, producing duplicates.
-- external_id gives idempotency against Meta's repeated webhook deliveries.

CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel     channel_type NOT NULL,
    direction   VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
    sender      VARCHAR(20) NOT NULL CHECK (sender IN ('customer', 'ai', 'owner', 'system')),
    content     TEXT NOT NULL,
    media_url   TEXT,
    external_id VARCHAR(255),
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_contact_created ON messages (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created  ON messages (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id
    ON messages (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- 8. CALL LOGS ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_logs (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id               UUID REFERENCES contacts(id) ON DELETE SET NULL,
    room_name                VARCHAR(255) NOT NULL UNIQUE,
    channel                  VARCHAR(30) NOT NULL
                             CHECK (channel IN ('voice_inbound', 'voice_instant_webrtc')),
    status                   call_status NOT NULL DEFAULT 'ringing',
    dire_reason              dire_reason,
    recording_url            TEXT,
    duration_seconds         INTEGER NOT NULL DEFAULT 0,
    transcript_full          JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary                  TEXT,
    detected_intent          VARCHAR(100),
    owner_consult_transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
    owner_instructions       TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_status  ON call_logs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_call_logs_contact_created ON call_logs (contact_id, created_at DESC);

-- 9. UI COMMAND EVENTS ----------------------------------------------------------
-- Replaces Supabase Realtime. Consumers listen via LISTEN/NOTIFY (see app layer).
CREATE TABLE IF NOT EXISTS ui_command_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    command_type VARCHAR(50) NOT NULL,
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_events_tenant_created
    ON ui_command_events (tenant_id, created_at DESC);

-- 10. KNOWLEDGE ITEMS -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category    VARCHAR(50) NOT NULL,
    title       VARCHAR(255) NOT NULL,
    content     TEXT NOT NULL,
    updated_by  VARCHAR(50) DEFAULT 'system',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_tenant_active
    ON knowledge_items (tenant_id, is_active);

-- ==============================================================================
-- 11. AUTHORIZATION: role, helper functions, and Row Level Security
-- ==============================================================================
-- The application connects as `omni_app` (NOT the table owner), so RLS applies.
-- Migrations/seeds run as the owner and therefore bypass RLS, which is intended.
-- Webhooks use a separate owner-level connection deliberately.
--
-- Identity is injected per transaction:  SET LOCAL app.user_id = '<uuid>';
-- ------------------------------------------------------------------------------

DO $$ BEGIN
    CREATE ROLE omni_app LOGIN PASSWORD 'omni_dev_password';
EXCEPTION WHEN duplicate_object THEN null; END $$;

GRANT USAGE ON SCHEMA public TO omni_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omni_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO omni_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omni_app;

-- SECURITY DEFINER so they can read membership tables without recursive RLS.
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION is_agency() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM agency_members WHERE user_id = app_user_id());
$$;

CREATE OR REPLACE FUNCTION is_tenant_member(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM tenant_members
        WHERE user_id = app_user_id() AND tenant_id = p_tenant
    );
$$;

CREATE OR REPLACE FUNCTION is_tenant_owner(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM tenant_members
        WHERE user_id = app_user_id() AND tenant_id = p_tenant AND role = 'owner'
    );
$$;

ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_agent_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ui_command_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_items       ENABLE ROW LEVEL SECURITY;

-- --- Identity tables -----------------------------------------------------------
DROP POLICY IF EXISTS users_self_read ON users;
CREATE POLICY users_self_read ON users FOR SELECT
    USING (id = app_user_id() OR is_agency());

DROP POLICY IF EXISTS users_self_update ON users;
CREATE POLICY users_self_update ON users FOR UPDATE
    USING (id = app_user_id() OR is_agency());

DROP POLICY IF EXISTS users_agency_insert ON users;
CREATE POLICY users_agency_insert ON users FOR INSERT
    WITH CHECK (is_agency());

DROP POLICY IF EXISTS sessions_own ON sessions;
CREATE POLICY sessions_own ON sessions FOR ALL
    USING (user_id = app_user_id() OR is_agency())
    WITH CHECK (user_id = app_user_id() OR is_agency());

DROP POLICY IF EXISTS agency_members_read ON agency_members;
CREATE POLICY agency_members_read ON agency_members FOR SELECT
    USING (user_id = app_user_id() OR is_agency());

DROP POLICY IF EXISTS tenant_members_read ON tenant_members;
CREATE POLICY tenant_members_read ON tenant_members FOR SELECT
    USING (user_id = app_user_id() OR is_agency());

DROP POLICY IF EXISTS tenant_members_agency_write ON tenant_members;
CREATE POLICY tenant_members_agency_write ON tenant_members FOR INSERT
    WITH CHECK (is_agency());

-- --- TENANTS: facts. Client may update their own; only agency may create/delete
DROP POLICY IF EXISTS tenants_read ON tenants;
CREATE POLICY tenants_read ON tenants FOR SELECT
    USING (is_tenant_member(id) OR is_agency());

DROP POLICY IF EXISTS tenants_client_update ON tenants;
CREATE POLICY tenants_client_update ON tenants FOR UPDATE
    USING (is_tenant_owner(id) OR is_agency())
    WITH CHECK (is_tenant_owner(id) OR is_agency());

DROP POLICY IF EXISTS tenants_agency_insert ON tenants;
CREATE POLICY tenants_agency_insert ON tenants FOR INSERT
    WITH CHECK (is_agency());

DROP POLICY IF EXISTS tenants_agency_delete ON tenants;
CREATE POLICY tenants_agency_delete ON tenants FOR DELETE
    USING (is_agency());

-- --- AGENT CONFIG: behaviour. Client-readable, agency-writable ONLY.
-- THE CRITICAL RULE: there is intentionally NO permissive policy for the client
-- on INSERT/UPDATE. In Postgres, absence of a permissive policy = denied.
DROP POLICY IF EXISTS agent_config_client_read ON tenant_agent_config;
CREATE POLICY agent_config_client_read ON tenant_agent_config FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS agent_config_agency_write ON tenant_agent_config;
CREATE POLICY agent_config_agency_write ON tenant_agent_config FOR ALL
    USING (is_agency())
    WITH CHECK (is_agency());

DROP POLICY IF EXISTS agent_history_read ON agent_config_history;
CREATE POLICY agent_history_read ON agent_config_history FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS agent_history_agency_write ON agent_config_history;
CREATE POLICY agent_history_agency_write ON agent_config_history FOR INSERT
    WITH CHECK (is_agency());

-- --- Tenant-scoped operational data -------------------------------------------
DROP POLICY IF EXISTS contacts_read ON contacts;
CREATE POLICY contacts_read ON contacts FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS contacts_write ON contacts;
CREATE POLICY contacts_write ON contacts FOR INSERT
    WITH CHECK (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS contacts_update ON contacts;
CREATE POLICY contacts_update ON contacts FOR UPDATE
    USING (is_tenant_member(tenant_id) OR is_agency())
    WITH CHECK (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts FOR DELETE
    USING (is_agency());

DROP POLICY IF EXISTS messages_read ON messages;
CREATE POLICY messages_read ON messages FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS messages_write ON messages;
CREATE POLICY messages_write ON messages FOR INSERT
    WITH CHECK (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS call_logs_read ON call_logs;
CREATE POLICY call_logs_read ON call_logs FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS call_logs_write ON call_logs;
CREATE POLICY call_logs_write ON call_logs FOR INSERT
    WITH CHECK (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS call_logs_update ON call_logs;
CREATE POLICY call_logs_update ON call_logs FOR UPDATE
    USING (is_tenant_member(tenant_id) OR is_agency())
    WITH CHECK (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS ui_events_read ON ui_command_events;
CREATE POLICY ui_events_read ON ui_command_events FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS ui_events_write ON ui_command_events;
CREATE POLICY ui_events_write ON ui_command_events FOR INSERT
    WITH CHECK (is_tenant_member(tenant_id) OR is_agency());

-- --- KNOWLEDGE: behaviour, agency-writable only (client may read) -------------
DROP POLICY IF EXISTS knowledge_read ON knowledge_items;
CREATE POLICY knowledge_read ON knowledge_items FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());

DROP POLICY IF EXISTS knowledge_agency_write ON knowledge_items;
CREATE POLICY knowledge_agency_write ON knowledge_items FOR ALL
    USING (is_agency())
    WITH CHECK (is_agency());

-- ==============================================================================
-- 12. updated_at TRIGGER
-- ==============================================================================
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['users','tenants','tenant_agent_config','contacts','call_logs','knowledge_items']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$I
             FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
    END LOOP;
END $$;

-- ==============================================================================
-- 13. DEMO SEED DATA  (password for every demo user below: demo1234)
-- ==============================================================================

-- 13.1 Users (scrypt: N=16384 r=8 p=1, 64-byte key)
INSERT INTO users (id, email, password_hash, full_name) VALUES
('a0000000-0000-4000-8000-000000000001', 'agency@nordic-omni.local',
 'scrypt$809755629eb40aac847a4be08b5af82e$0440f643bb58d57f0e6c243a179215234101bcf07cd7e93a1f5d199f866424da2d20546e1fef7d974f49a4bf5274357ab5889403a2f7b55cfc55837527dfdf92',
 'Agency Operator'),
('b0000000-0000-4000-8000-000000000001', 'jens@kbhvvs.dk',
 'scrypt$809755629eb40aac847a4be08b5af82e$0440f643bb58d57f0e6c243a179215234101bcf07cd7e93a1f5d199f866424da2d20546e1fef7d974f49a4bf5274357ab5889403a2f7b55cfc55837527dfdf92',
 'Jens Hansen'),
('b0000000-0000-4000-8000-000000000002', 'mette@nordicdental.dk',
 'scrypt$809755629eb40aac847a4be08b5af82e$0440f643bb58d57f0e6c243a179215234101bcf07cd7e93a1f5d199f866424da2d20546e1fef7d974f49a4bf5274357ab5889403a2f7b55cfc55837527dfdf92',
 'Dr. Mette Lind')
ON CONFLICT DO NOTHING;

INSERT INTO agency_members (user_id, role) VALUES
('a0000000-0000-4000-8000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

-- 13.2 Tenants (FACTS)
INSERT INTO tenants (id, name, slug, flynumber_did, meta_phone_number_id,
    owner_name, owner_phone, owner_email, default_language, telephony_mode,
    business_hours, pricing_catalog, active_broadcast_message) VALUES
('11111111-1111-4111-8111-111111111111', 'København VVS Døgnvagt', 'kbh-vvs',
 '+4570201122', '102938475650001', 'Jens Hansen', '+4520123456', 'jens@kbhvvs.dk',
 'da-DK', 'zero_cost_webrtc',
 '{"mon":{"open":"07:30","close":"16:30","closed":false},
   "tue":{"open":"07:30","close":"16:30","closed":false},
   "wed":{"open":"07:30","close":"16:30","closed":false},
   "thu":{"open":"07:30","close":"16:30","closed":false},
   "fri":{"open":"07:30","close":"15:00","closed":false},
   "sat":{"open":"08:00","close":"14:00","closed":true},
   "sun":{"open":"00:00","close":"00:00","closed":true}}'::jsonb,
 '[{"id":"p1","service":"Autoriseret VVS Timetakst","price_dkk":895,"unit":"hour"},
   {"id":"p2","service":"Akut Døgnvagt Udrykning (Aften/Nat)","price_dkk":2200,"unit":"call-out"},
   {"id":"p3","service":"Radiatorservice & Termostatskift","price_dkk":1450,"unit":"fixed"},
   {"id":"p4","service":"Komplet Varmepumpe Installation","price_dkk":68000,"unit":"package"}]'::jsonb,
 'Husk: Døgnvagtstillæg gælder efter kl. 16:00 på hverdage.'),
('22222222-2222-4222-8222-222222222222', 'Nordic Dental Strøget', 'nordic-dental',
 '+4533123456', '102938475650002', 'Dr. Mette Lind', '+4540506070', 'mette@nordicdental.dk',
 'en-US', 'zero_cost_webrtc',
 '{"mon":{"open":"08:00","close":"17:00","closed":false},
   "tue":{"open":"08:00","close":"17:00","closed":false},
   "wed":{"open":"08:00","close":"17:00","closed":false},
   "thu":{"open":"08:00","close":"17:00","closed":false},
   "fri":{"open":"08:00","close":"15:00","closed":false},
   "sat":{"open":"09:00","close":"13:00","closed":false},
   "sun":{"open":"00:00","close":"00:00","closed":true}}'::jsonb,
 '[{"id":"d1","service":"Initial Check-up + Clean","price_dkk":650,"unit":"fixed"},
   {"id":"d2","service":"Emergency Toothache Relief","price_dkk":1250,"unit":"call-out"},
   {"id":"d3","service":"Invisalign Full Alignment Package","price_dkk":32000,"unit":"package"}]'::jsonb,
 'Special campaign: 20% discount on initial hygiene checkups this month.')
ON CONFLICT DO NOTHING;

INSERT INTO tenant_members (user_id, tenant_id, role) VALUES
('b0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner'),
('b0000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'owner')
ON CONFLICT DO NOTHING;

-- 13.3 Tenant agent config (BEHAVIOUR — agency-owned)
INSERT INTO tenant_agent_config (tenant_id, customer_system_prompt, copilot_system_prompt,
    greeting_script, voice_id) VALUES
('11111111-1111-4111-8111-111111111111',
 'Du er den autoriserede AI-receptionist for København VVS Døgnvagt. Svar altid på dansk, med mindre kunden taler engelsk. Vær rolig, autoritativ og handlingsorienteret. Oplys priser fra kataloget: timetakst 895 DKK, akut døgnudrykning 2200 DKK. Ved akutte skader (sprængt rør, vandskade, oversvømmelse) skal du straks kalde trigger_dire_escalation og bede kunden lukke for hovedhanen. Book aldrig en opgave uden at bekræfte adresse og telefonnummer.',
 'Du er den taktiske drifts-co-pilot for indehaver Jens Hansen. Giv korte, handlingsorienterede svar om pipeline, åbningstider og priser. Foretag ændringer når du bliver bedt om det.',
 'Hej, du er kommet til København VVS Døgnvagt. Hvordan kan jeg hjælpe dig?',
 'da-DK-ChristelNeural'),
('22222222-2222-4222-8222-222222222222',
 'You are the bilingual AI receptionist for Nordic Dental Strøget in Copenhagen. Reply in English unless the caller speaks Danish. Be warm, precise and clinical. Quote prices from the catalog: check-up 650 DKK, emergency relief 1250 DKK, Invisalign 32000 DKK. For severe pain or dental trauma, immediately call trigger_dire_escalation. Never give medical diagnoses.',
 'You are the practice-manager co-pilot for Dr. Mette Lind. Give concise operational answers about bookings, chair availability and pricing.',
 'Hi, you have reached Nordic Dental Strøget. How can I help you today?',
 'en-US-AvaMultilingualNeural')
ON CONFLICT DO NOTHING;

-- 13.4 Contacts
INSERT INTO contacts (id, tenant_id, phone_number, email, full_name, instagram_handle,
    preferred_channel, preferred_language, lead_score, estimated_value_dkk,
    pipeline_stage, ai_auto_reply_enabled, shared_memory_summary, sentiment_score) VALUES
('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
 '+4528776655', 'morten.bondo@kodbyens.dk', 'Morten Bondo', '@mortenbondo',
 'whatsapp', 'da', 95, 14500, 'dire_escalated', true,
 'Hovedvandrør sprængt i restaurantkøkken i Kødbyen. Vand fosser ud. Risikerer lukning af aftenservering. Kræver akut udrykning nu.', 3.2),
('dddddddd-dddd-4ddd-dddd-dddddddddddd', '11111111-1111-4111-8111-111111111111',
 '+4561223344', 'kasper.holm@amager.dk', 'Kasper Holm', '@k_holm84',
 'whatsapp', 'da', 60, 2800, 'contacted', true,
 'Lejlighedsejer på Amagerbro. Ønsker udskiftning af ældre toilet til væghængt Geberit. Fået prisoversigt.', 6.8),
('eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111',
 '+4531445566', 'camilla.v@outlook.dk', 'Camilla Vestergaard', '@camilla_vestergaard',
 'lead_form', 'da', 40, 1850, 'new_lead', true,
 'Indsendte formular vedrørende stoppede afløb i bryggers. Auto-besked sendt.', 7.0),
('ffffffff-ffff-4fff-ffff-ffffffffffff', '22222222-2222-4222-8222-222222222222',
 '+4591887766', 'elizabeth.warren@cph-fintech.io', 'Elizabeth Warren', '@elizabeth_cph',
 'whatsapp', 'en', 92, 32000, 'closed_won', true,
 'UK expat at Copenhagen Fintech Hub. Full Invisalign treatment approved. First 3D scan completed.', 9.4)
ON CONFLICT DO NOTHING;

-- 13.5 Messages (single table)
INSERT INTO messages (tenant_id, contact_id, channel, direction, sender, content, external_id, metadata) VALUES
('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
 'whatsapp', 'inbound', 'customer',
 'Hej, vores hovedrør under køkkenvasken er sprunget! Der fosser vand ud i hele køkkenet. Kan I komme nu?',
 'wamid.demo.001', '{"seed": true}'::jsonb),
('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
 'whatsapp', 'outbound', 'ai',
 'Vi har modtaget din besked og sender en akut tekniker med det samme. Luk for hovedhanen hvis du kan. En medarbejder ringer dig op nu.',
 NULL, '{"sent_by_ai": true, "seed": true}'::jsonb),
('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
 'whatsapp', 'system', 'system',
 'Morten er sat i akut-kø. Vagt kalder op inden for 2 minutter.',
 NULL, '{"seed": true}'::jsonb),
('11111111-1111-4111-8111-111111111111', 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee',
 'lead_form', 'inbound', 'customer',
 'Hej, vores afløb i bryggerset er stoppet. Hvad koster det at få det ordnet?',
 NULL, '{"form_slug": "kbh-vvs", "seed": true}'::jsonb)
ON CONFLICT DO NOTHING;

-- 13.6 Call logs. room_name MUST match `${tenant.slug}_call_${contact.id}`
-- because that is exactly what the browser call client and the worker use.
INSERT INTO call_logs (id, tenant_id, contact_id, room_name, channel, status,
    dire_reason, duration_seconds, transcript_full, summary, detected_intent) VALUES
('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
 'kbh-vvs_call_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
 'voice_instant_webrtc', 'dire_hold_for_owner', 'high_value_emergency', 142,
 '[{"speaker":"agent","text":"Goddag! Du er kommet til Kobenhavn VVS Dogndvagt. Hvordan kan jeg hjalpe?","timestamp_ms":0},
   {"speaker":"caller","text":"Hovedroret er sprunget under kokkenvasken! Vand fosser ud!","timestamp_ms":4000},
   {"speaker":"agent","text":"Luk straks for hovedhanen. Jeg kobler vagten pa nu.","timestamp_ms":9000}]'::jsonb,
 'Akut robrud i Kodbyen. Kraever ojeblikkelig udrykning.', 'Akut vandskade')
ON CONFLICT DO NOTHING;

-- 13.7 Knowledge base (BEHAVIOUR - agency-owned)
INSERT INTO knowledge_items (tenant_id, category, title, content, updated_by) VALUES
('11111111-1111-4111-8111-111111111111', 'policy', 'Betalingsbetingelser',
 'Al betaling foregar uden om systemet via bankoverforsel eller direkte faktura fra montoren. Vi Opkraever ikke betaling i appen.',
 'seed'),
('11111111-1111-4111-8111-111111111111', 'faq', 'Dognvagt',
 'Dognvagt daekker akutte vandskader, spraengte ror og oversvommelser hele dogent. Udrykning efter kl. 16:00 og i weekenden koster 2200 DKK.',
 'seed'),
('22222222-2222-4222-8222-222222222222', 'policy', 'Payment Policy',
 'All payments are handled outside the software via bank transfer or direct invoice. No card payments are taken in the app.',
 'seed'),
('22222222-2222-4222-8222-222222222222', 'faq', 'Emergency Appointments',
 'Emergency toothache relief is available same-day for 1250 DKK. Severe trauma is escalated to the on-call dentist immediately.',
 'seed')
ON CONFLICT DO NOTHING;

-- 13.8 A harmless seed event (deliberately NOT a dire alert, so the dashboard
-- does not open a modal on first load).
INSERT INTO ui_command_events (tenant_id, command_type, payload) VALUES
('11111111-1111-4111-8111-111111111111', 'PULSE_METRIC',
 '{"metricId": "inbound-leads", "note": "seed"}'::jsonb);

-- ==============================================================================
-- END OF BASELINE
-- ==============================================================================






