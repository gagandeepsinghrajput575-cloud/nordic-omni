-- AI Brain ingestion, public web chat, and durable owner escalations.
-- `ALTER TYPE ... ADD VALUE` is intentionally outside an explicit transaction.

ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'web_chat';

CREATE TABLE IF NOT EXISTS knowledge_sources (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind          VARCHAR(20) NOT NULL CHECK (kind IN ('website', 'notes', 'file')),
    title         VARCHAR(255) NOT NULL,
    location      TEXT,
    raw_text      TEXT NOT NULL,
    content_hash  VARCHAR(64) NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'ready'
                  CHECK (status IN ('ready', 'failed')),
    error         TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_tenant
    ON knowledge_sources (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_bundles (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    status           VARCHAR(20) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'approved', 'rejected')),
    compiler_model   VARCHAR(120) NOT NULL DEFAULT 'livekit-inference',
    source_ids       UUID[] NOT NULL DEFAULT '{}',
    summary          TEXT NOT NULL DEFAULT '',
    payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
    warnings         JSONB NOT NULL DEFAULT '[]'::jsonb,
    error            TEXT,
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_bundles_tenant
    ON knowledge_bundles (tenant_id, created_at DESC);

ALTER TABLE knowledge_items
    ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES knowledge_sources(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS bundle_id UUID REFERENCES knowledge_bundles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_label TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_bundle
    ON knowledge_items (bundle_id) WHERE bundle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_escalations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
    channel       VARCHAR(30) NOT NULL,
    reason        VARCHAR(40) NOT NULL
                  CHECK (reason IN ('angry_customer', 'high_value_emergency',
                                    'ai_unanswered_question', 'human_requested')),
    urgency       SMALLINT NOT NULL DEFAULT 3 CHECK (urgency BETWEEN 1 AND 5),
    briefing      TEXT NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'notified', 'resolved')),
    n8n_status    VARCHAR(30) NOT NULL DEFAULT 'not_configured'
                  CHECK (n8n_status IN ('not_configured', 'delivered', 'failed')),
    n8n_error     TEXT,
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at   TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_escalations_tenant_open
    ON conversation_escalations (tenant_id, created_at DESC)
    WHERE status <> 'resolved';

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_escalations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_sources_agency ON knowledge_sources;
CREATE POLICY knowledge_sources_agency ON knowledge_sources FOR ALL
    USING (is_agency())
    WITH CHECK (is_agency());

DROP POLICY IF EXISTS knowledge_bundles_agency ON knowledge_bundles;
CREATE POLICY knowledge_bundles_agency ON knowledge_bundles FOR ALL
    USING (is_agency())
    WITH CHECK (is_agency());

DROP POLICY IF EXISTS escalations_read ON conversation_escalations;
CREATE POLICY escalations_read ON conversation_escalations FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['knowledge_sources', 'knowledge_bundles', 'conversation_escalations']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$I
             FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON knowledge_sources, knowledge_bundles, conversation_escalations
    TO omni_app;
