-- ==============================================================================
-- MIGRATION: 0001_initial_multi_tenant_schema.sql
-- PROJECT: Multi-Tenant Omnichannel Voice & Meta AI Platform (NORDIC-OMNI)
-- DESCRIPTION: Core multi-tenant relational schema, indexes, pgvector extension,
--              Supabase Realtime WAL publication, and realistic Danish/English seed data.
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 2. ENUMS & DOMAINS
DO $$ BEGIN
    CREATE TYPE language_code AS ENUM ('da-DK', 'en-US');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE telephony_mode AS ENUM ('zero_cost_webrtc', 'paid_sip_trunk');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE pipeline_stage AS ENUM (
        'new_lead',
        'contacted',
        'qualified',
        'booked',
        'dire_escalated',
        'closed_won',
        'closed_lost'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE channel_type AS ENUM (
        'lead_form',
        'whatsapp',
        'instagram',
        'voice_inbound',
        'voice_instant_webrtc',
        'owner_whisper'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE call_status AS ENUM (
        'ringing',
        'in_progress',
        'dire_hold_for_owner',
        'owner_consulting_ai',
        'merged_live_with_owner',
        'ai_relaying_owner_instruction',
        'completed',
        'missed'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE dire_reason AS ENUM (
        'angry_customer',
        'high_value_emergency',
        'ai_unanswered_question'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. TENANTS (AGENCY CLIENTS)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    flynumber_did VARCHAR(50) UNIQUE,
    owner_name VARCHAR(255) NOT NULL,
    owner_phone VARCHAR(50) NOT NULL,
    owner_email VARCHAR(255) NOT NULL,
    owner_pin VARCHAR(10) NOT NULL DEFAULT '1234',
    default_language language_code NOT NULL DEFAULT 'da-DK',
    telephony_mode telephony_mode NOT NULL DEFAULT 'zero_cost_webrtc',
    system_prompt_overrides TEXT,
    active_broadcast_message TEXT,
    business_hours JSONB NOT NULL DEFAULT '{
        "mon": {"open": "08:00", "close": "16:30", "closed": false},
        "tue": {"open": "08:00", "close": "16:30", "closed": false},
        "wed": {"open": "08:00", "close": "16:30", "closed": false},
        "thu": {"open": "08:00", "close": "16:30", "closed": false},
        "fri": {"open": "08:00", "close": "15:30", "closed": false},
        "sat": {"open": "09:00", "close": "13:00", "closed": true},
        "sun": {"open": "00:00", "close": "00:00", "closed": true}
    }'::jsonb,
    pricing_catalog JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. CONTACTS (SHARED OMNICHANNEL IDENTITY LEDGER)
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number VARCHAR(50),
    email VARCHAR(255),
    full_name VARCHAR(255),
    instagram_handle VARCHAR(100),
    preferred_channel channel_type NOT NULL DEFAULT 'whatsapp',
    preferred_language VARCHAR(10) NOT NULL DEFAULT 'da' CHECK (preferred_language IN ('da', 'en')),
    lead_score INTEGER NOT NULL DEFAULT 50 CHECK (lead_score >= 0 AND lead_score <= 100),
    estimated_value_dkk NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    pipeline_stage pipeline_stage NOT NULL DEFAULT 'new_lead',
    shared_memory_summary TEXT NOT NULL DEFAULT '',
    sentiment_score NUMERIC(3, 2) NOT NULL DEFAULT 7.50,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for contacts: sub-15ms Caller ID and pipeline lookup
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone ON contacts (tenant_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_stage ON contacts (tenant_id, pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_updated ON contacts (tenant_id, updated_at DESC);

-- 5. OMNICHANNEL MESSAGES (META / WHATSAPP / IG / SMS / VOICE TRANSCRIPTS)
CREATE TABLE IF NOT EXISTS omnichannel_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel channel_type NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
    content TEXT NOT NULL,
    media_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_contact_created ON omnichannel_messages (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON omnichannel_messages (tenant_id, created_at DESC);

-- 6. CALL LOGS (LIVEKIT SESSIONS, DUAL-MODE WARM TRANSFER & WORD-LEVEL TRANSCRIPTS)
CREATE TABLE IF NOT EXISTS call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    room_name VARCHAR(255) NOT NULL UNIQUE,
    channel VARCHAR(30) NOT NULL CHECK (channel IN ('voice_inbound', 'voice_instant_webrtc')),
    status call_status NOT NULL DEFAULT 'ringing',
    dire_reason dire_reason,
    recording_url TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    transcript_full JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary TEXT,
    detected_intent VARCHAR(100),
    owner_consult_transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
    owner_instructions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_status ON call_logs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_call_logs_contact_created ON call_logs (contact_id, created_at DESC);

-- 7. UI COMMAND EVENTS (BI-DIRECTIONAL ZUSTAND UI-SYNC BUS)
CREATE TABLE IF NOT EXISTS ui_command_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    command_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ui_events_tenant_created ON ui_command_events (tenant_id, created_at DESC);

-- 8. KNOWLEDGE ITEMS & MESSAGES COMPATIBILITY LAYER
CREATE TABLE IF NOT EXISTS knowledge_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    updated_by VARCHAR(50) DEFAULT 'system',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_tenant_active ON knowledge_items (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel VARCHAR(30) NOT NULL,
    sender VARCHAR(30) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_alias_contact ON messages (contact_id, created_at DESC);

-- 8. REALTIME REPLICATION PUBLICATION
-- Enable Supabase Realtime WAL broadcast for reactive UI state synchronization
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE tenants;
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE omnichannel_messages;
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE call_logs;
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE ui_command_events;
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;

-- ==============================================================================
-- REALISTIC DANISH & ENGLISH SEED DATA
-- ==============================================================================

-- 9. SEED TENANTS
INSERT INTO tenants (
    id, name, slug, flynumber_did, owner_name, owner_phone, owner_email, owner_pin,
    default_language, telephony_mode, system_prompt_overrides, active_broadcast_message,
    business_hours, pricing_catalog
) VALUES
(
    '11111111-1111-4111-8111-111111111111',
    'København VVS & Akut Døgnvagt',
    'kbh-vvs',
    '+4570201122',
    'Jens Møller',
    '+4522334455',
    'jens@kbh-vvs.dk',
    '8899',
    'da-DK',
    'zero_cost_webrtc',
    'Du er AI-receptionisten for København VVS. Vær autoritativ, rolig og handlingsorienteret på flydende dansk.',
    'OBS: På grund af kraftigt skybrud prioriteres akutte kælderoversvømmelser i Storkøbenhavn.',
    '{
        "mon": {"open": "07:30", "close": "16:30", "closed": false},
        "tue": {"open": "07:30", "close": "16:30", "closed": false},
        "wed": {"open": "07:30", "close": "16:30", "closed": false},
        "thu": {"open": "07:30", "close": "16:30", "closed": false},
        "fri": {"open": "07:30", "close": "15:00", "closed": false},
        "sat": {"open": "08:00", "close": "14:00", "closed": true},
        "sun": {"open": "00:00", "close": "00:00", "closed": true}
    }'::jsonb,
    '[
        {"id": "p1", "service": "Autoriseret VVS Timetakst", "price_dkk": 895, "unit": "hour"},
        {"id": "p2", "service": "Akut Døgnvagt Udrykning (Aften/Nat)", "price_dkk": 2200, "unit": "call-out"},
        {"id": "p3", "service": "Radiatorservice & Termostatskift", "price_dkk": 1450, "unit": "fixed"},
        {"id": "p4", "service": "Komplet Varmepumpe Installation", "price_dkk": 68000, "unit": "package"}
    ]'::jsonb
),
(
    '22222222-2222-4222-8222-222222222222',
    'Nordic Dental Strøget',
    'nordic-dental',
    '+4533123456',
    'Dr. Mette Lind',
    '+4540506070',
    'mette@nordicdental.dk',
    '1234',
    'en-US',
    'paid_sip_trunk',
    'You are the bilingual receptionist for Nordic Dental Strøget. Assist international expats and local Danes with dental care.',
    'Special promotion: 20% discount on initial dental hygiene examination and digital 3D scans this month.',
    '{
        "mon": {"open": "08:00", "close": "17:00", "closed": false},
        "tue": {"open": "08:00", "close": "17:00", "closed": false},
        "wed": {"open": "08:00", "close": "17:00", "closed": false},
        "thu": {"open": "08:00", "close": "17:00", "closed": false},
        "fri": {"open": "08:00", "close": "15:00", "closed": false},
        "sat": {"open": "09:00", "close": "13:00", "closed": false},
        "sun": {"open": "00:00", "close": "00:00", "closed": true}
    }'::jsonb,
    '[
        {"id": "d1", "service": "Initial Check-up + Clean (DKK)", "price_dkk": 650, "unit": "fixed"},
        {"id": "d2", "service": "Emergency Toothache Relief", "price_dkk": 1250, "unit": "call-out"},
        {"id": "d3", "service": "Invisalign Full Alignment Package", "price_dkk": 32000, "unit": "package"}
    ]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    pricing_catalog = EXCLUDED.pricing_catalog,
    active_broadcast_message = EXCLUDED.active_broadcast_message;

-- 10. SEED CONTACTS (6 ACROSS ALL PIPELINE STAGES)
INSERT INTO contacts (
    id, tenant_id, phone_number, email, full_name, instagram_handle,
    preferred_channel, preferred_language, lead_score, estimated_value_dkk,
    pipeline_stage, shared_memory_summary, sentiment_score
) VALUES
(
    'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    '+4528776655',
    'morten.bondo@restaurantkodbyen.dk',
    'Morten Bondo',
    '@mortenbondo_cph',
    'whatsapp',
    'da',
    98,
    14500.00,
    'dire_escalated',
    'Restauratør i Kødbyen. Hovedvandrør flækket i opvasken under travl frokost. Vand fosser ud. Har truet med erstatningskrav, hvis vagtbil ikke ankommer inden for 45 min. Afventer ejer Jens.',
    2.10
),
(
    'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    '11111111-1111-4111-8111-111111111111',
    '+4520998877',
    'rasmus.kristensen@gmail.com',
    'Rasmus Kristensen',
    '@rasmus_valby',
    'whatsapp',
    'da',
    88,
    3600.00,
    'booked',
    'Villaejer i Valby. Dryppende radiator og faldende anlægstryk. Aftale bekræftet til i morgen tirsdag kl. 10:00 med montør Peter. SMS-bekræftelse og kalender-invite modtaget.',
    8.60
),
(
    'cccccccc-cccc-4ccc-cccc-cccccccccccc',
    '11111111-1111-4111-8111-111111111111',
    '+4550112233',
    'sofie.nielsen@nordiclux.com',
    'Sofie Nielsen',
    '@sofienielsen_dk',
    'instagram',
    'da',
    75,
    68000.00,
    'qualified',
    'Sommerhusejer i Tisvildeleje. Søger komplet Panasonic luft-til-vand varmepumpe. Har sendt billeder af teknikrummet via Instagram DM. Ønsker fast overslag før fredag.',
    8.10
),
(
    'dddddddd-dddd-4ddd-dddd-dddddddddddd',
    '11111111-1111-4111-8111-111111111111',
    '+4561223344',
    'kasper.holm@amager.dk',
    'Kasper Holm',
    '@k_holm84',
    'whatsapp',
    'da',
    60,
    2800.00,
    'contacted',
    'Lejlighedsejer på Amagerbro. Ønsker udskiftning af ældre toilet til væghængt Geberit. Har fået tilsendt link til prisoversigt.',
    6.90
),
(
    'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    '+4531445566',
    'camilla.v@outlook.dk',
    'Camilla Vestergaard',
    '@camilla_vestergaard',
    'lead_form',
    'da',
    40,
    1850.00,
    'new_lead',
    'Indsendte leadformular for 8 minutter siden vedrørende stoppede afløb i bryggers. Auto-WhatsApp besked sendt med 1-tap opkaldslink.',
    7.00
),
(
    'ffffffff-ffff-4fff-ffff-ffffffffffff',
    '22222222-2222-4222-8222-222222222222',
    '+4591887766',
    'elizabeth.warren@cph-fintech.io',
    'Elizabeth Warren',
    '@elizabeth_cph',
    'whatsapp',
    'en',
    92,
    32000.00,
    'closed_won',
    'UK expat working at Copenhagen Fintech Hub. Full Invisalign treatment approved. Deposit paid via Stripe. First 3D scan appointment completed.',
    9.40
)
ON CONFLICT (id) DO UPDATE SET
    lead_score = EXCLUDED.lead_score,
    pipeline_stage = EXCLUDED.pipeline_stage,
    shared_memory_summary = EXCLUDED.shared_memory_summary;

-- 11. SEED OMNICHANNEL MESSAGES
INSERT INTO omnichannel_messages (
    id, tenant_id, contact_id, channel, direction, content, metadata, created_at
) VALUES
(
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'whatsapp',
    'inbound',
    'HJÆLP! Vores hovedvandrør i restauranten er lige flækket! Der står 5 cm vand i køkkenet!',
    '{"platform": "meta_whatsapp", "wa_id": "4528776655"}'::jsonb,
    NOW() - INTERVAL '12 minutes'
),
(
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'whatsapp',
    'outbound',
    'Hej Morten, luk straks for hovedventilen ved vandmåleren! Jeg alarmerer vores vagthavende montør med det samme. Hvis det haster endnu mere, kan du trykke på dette direkte opkaldslink: https://nordic-omni.io/call/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa eller ringe +4570201122.',
    '{"sent_by_ai": true}'::jsonb,
    NOW() - INTERVAL '11 minutes'
),
(
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    'lead_form',
    'inbound',
    'Vores radiator på 1. sal drypper ned på trægulvet. Kan en montør kigge forbi i morgen formiddag?',
    '{"form_id": "valby_lead_form"}'::jsonb,
    NOW() - INTERVAL '3 hours'
),
(
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    'whatsapp',
    'outbound',
    'Hej Rasmus! Tak for din henvendelse. Vi har en ledig montørtid i morgen kl. 10:00. Skal vi booke den til dig?',
    '{"sent_by_ai": true}'::jsonb,
    NOW() - INTERVAL '2 hours 55 minutes'
),
(
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    'whatsapp',
    'inbound',
    'Ja tak, kl. 10:00 er perfekt! Adressen er Møllebakken 14, 2500 Valby.',
    '{}'::jsonb,
    NOW() - INTERVAL '2 hours 50 minutes'
);

-- 12. SEED CALL LOGS WITH WORD-LEVEL TIMESTAMPED TRANSCRIPTS
INSERT INTO call_logs (
    id, tenant_id, contact_id, room_name, channel, status, dire_reason,
    recording_url, duration_seconds, transcript_full, summary, detected_intent,
    owner_consult_transcript, owner_instructions, created_at
) VALUES
(
    '99999999-9999-4999-8999-999999999999',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'kbh-vvs_call_morten_akut',
    'voice_inbound',
    'dire_hold_for_owner',
    'high_value_emergency',
    'https://storage.nordic-omni.cloud/recordings/morten_kbh_vvs_dire.mp3',
    64,
    '[
        {"speaker": "agent", "text": "Goddag, du har ringet til København VVS Døgnvagt. Mit navn er Christel. Hvad kan jeg hjælpe med?", "timestamp_ms": 0, "start": 0.0, "end": 4.2},
        {"speaker": "caller", "text": "Det er Morten Bondo fra Restaurant Kødbyen! Vores hovedvandrør er lige sprængt!", "timestamp_ms": 4800, "start": 4.8, "end": 9.4},
        {"speaker": "agent", "text": "Morten, jeg sætter dig straks over til vores ejer Jens Møller. Bliv på linjen et øjeblik.", "timestamp_ms": 10100, "start": 10.1, "end": 14.5}
    ]'::jsonb,
    'Hovedvandrør sprængt i restaurantkøkken. Kunden sat på hold; afventer ejer Jens Møller for live consult eller merge.',
    'Akut Rørskade Udrykning',
    '[
        {"speaker": "ai", "text": "Jens, Morten fra Restaurant Kødbyen er på linjen. Hovedvandrøret er flækket og vandet fosser ud. Han har truet med erstatning hvis vi ikke rykker ud nu.", "timestamp_ms": 15000}
    ]'::jsonb,
    'Ejer har endnu ikke bekræftet instruks.',
    NOW() - INTERVAL '4 minutes'
),
(
    '88888888-8888-4888-8888-888888888888',
    '11111111-1111-4111-8111-111111111111',
    'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    'kbh-vvs_call_rasmus_valby',
    'voice_instant_webrtc',
    'completed',
    null,
    'https://storage.nordic-omni.cloud/recordings/rasmus_valby_completed.mp3',
    42,
    '[
        {"speaker": "agent", "text": "Hej Rasmus! Jeg kan se på din WhatsApp-besked, at din radiator drypper.", "timestamp_ms": 0, "start": 0.0, "end": 3.8},
        {"speaker": "caller", "text": "Ja præcis, super service at I allerede vidste hvad det drejede sig om!", "timestamp_ms": 4200, "start": 4.2, "end": 8.1},
        {"speaker": "agent", "text": "Selvfølgelig! Montør Peter kommer forbi i morgen tirsdag klokken 10:00. Du modtager bekræftelse på SMS.", "timestamp_ms": 8600, "start": 8.6, "end": 14.2},
        {"speaker": "caller", "text": "Mange tak, vi ses i morgen!", "timestamp_ms": 15000, "start": 15.0, "end": 17.5}
    ]'::jsonb,
    'Radiatorbekræftelse fuldført via instant WebRTC opkald med fuld historik fra WhatsApp.',
    'Aftale Bekræftelse',
    '[]'::jsonb,
    null,
    NOW() - INTERVAL '2 hours'
);

-- 13. SEED INITIAL UI COMMAND EVENT
INSERT INTO ui_command_events (
    id, tenant_id, command_type, payload
) VALUES
(
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    'TRIGGER_DIRE_MODAL',
    '{
        "callLogId": "99999999-9999-4999-8999-999999999999",
        "contactId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        "contactName": "Morten Bondo",
        "contactPhone": "+4528776655",
        "direReason": "high_value_emergency",
        "estimatedValueDkk": 14500.00,
        "callerBrief": "Hovedvandrør sprængt i restaurantkøkken. Vand fosser ud. Risikerer lukning af aftenservering."
    }'::jsonb
);
