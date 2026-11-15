-- 0020 — Universal Agency Inbound & Action Gateway credentials.
--
-- Apply after 0019 as the schema owner. `omni_app` must not own these tables.
--
-- Two new tables:
--
--   webhook_api_keys      agency-minted credentials for the inbound gateway.
--                         Only a SHA-256 of the key is stored; the plaintext is
--                         shown to the operator exactly once at creation.
--
--   webhook_inbound_receipts
--                         one row per processed delivery id, used to reject a
--                         replay inside the signed timestamp window.
--
-- Note on the hash: the key is 256 bits of CSPRNG output, not a password, so a
-- fast SHA-256 is the correct primitive. bcrypt/argon2 over a random 256-bit
-- value buys nothing and costs every request a few hundred milliseconds.

BEGIN;

CREATE TABLE IF NOT EXISTS webhook_api_keys (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- NULL = agency-global key. Pinning a tenant narrows what the key may touch.
    tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name           VARCHAR(120) NOT NULL CHECK (length(btrim(name)) > 0),
    key_prefix     VARCHAR(16) NOT NULL,
    key_hash       CHAR(64) NOT NULL,
    -- Used only for the HMAC path. Nullable: a key may be bearer-only.
    hmac_secret    TEXT,
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    last_used_at   TIMESTAMPTZ,
    revoked_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A prefix identifies a key without revealing it, and must be unique so a
-- lookup cannot return two candidate rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_api_keys_prefix
    ON webhook_api_keys (key_prefix);
CREATE INDEX IF NOT EXISTS idx_webhook_api_keys_agency
    ON webhook_api_keys (agency_user_id, revoked_at);

CREATE TABLE IF NOT EXISTS webhook_inbound_receipts (
    delivery_id VARCHAR(128) PRIMARY KEY,
    key_prefix  VARCHAR(16) NOT NULL,
    action      VARCHAR(40) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Receipts are only meaningful inside the replay window; prune opportunistically.
CREATE INDEX IF NOT EXISTS idx_webhook_inbound_receipts_created
    ON webhook_inbound_receipts (created_at DESC);

ALTER TABLE webhook_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_inbound_receipts ENABLE ROW LEVEL SECURITY;

-- Only the agency manages its own credentials. A minted key never widens scope:
-- the key row carries the acting user, and RLS on every data table still applies.
DROP POLICY IF EXISTS webhook_api_keys_agency ON webhook_api_keys;
CREATE POLICY webhook_api_keys_agency ON webhook_api_keys FOR ALL
    USING (is_agency()) WITH CHECK (is_agency());

-- Receipts are written by the gateway (owner connection) and read by nobody in
-- the browser. Agency may audit them; no client-facing policy exists.
DROP POLICY IF EXISTS webhook_inbound_receipts_agency ON webhook_inbound_receipts;
CREATE POLICY webhook_inbound_receipts_agency ON webhook_inbound_receipts FOR SELECT
    USING (is_agency());

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_api_keys TO omni_app;
GRANT SELECT ON webhook_inbound_receipts TO omni_app;

-- The gateway writes receipts over the owner connection, which needs the
-- privilege explicitly because it runs as the table owner's role.
GRANT INSERT ON webhook_inbound_receipts TO omni_app;

COMMIT;

-- Verification (run manually after applying):
--   select count(*) from webhook_api_keys;          -- expect 0 on a fresh install
--   select count(*) from webhook_inbound_receipts;  -- expect 0
