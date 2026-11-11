-- Structured estimate history and honest, unconfirmed inspection requests.
BEGIN;

CREATE TABLE IF NOT EXISTS project_estimates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    call_log_id         UUID REFERENCES call_logs(id) ON DELETE SET NULL,
    project_type        TEXT NOT NULL,
    scope_details       TEXT NOT NULL,
    square_meters       NUMERIC(10,2) CHECK (square_meters IS NULL OR square_meters > 0),
    estimated_min_dkk   NUMERIC(14,2) NOT NULL CHECK (estimated_min_dkk >= 0),
    estimated_max_dkk   NUMERIC(14,2) NOT NULL CHECK (estimated_max_dkk >= estimated_min_dkk),
    estimated_value_dkk NUMERIC(14,2) NOT NULL CHECK (estimated_value_dkk >= 0),
    followup_notes      TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_estimates_contact
    ON project_estimates (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_estimates_tenant
    ON project_estimates (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inspection_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    call_log_id         UUID REFERENCES call_logs(id) ON DELETE SET NULL,
    requested_time_text TEXT NOT NULL,
    address             TEXT NOT NULL DEFAULT '',
    notes               TEXT NOT NULL DEFAULT '',
    status              VARCHAR(20) NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspection_requests_contact
    ON inspection_requests (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspection_requests_tenant_status
    ON inspection_requests (tenant_id, status, created_at DESC);

-- Persist explicit calculation semantics for the pilot catalog. The existing
-- display strings remain for human-facing prompts.
UPDATE tenants t
SET pricing_catalog = (
  SELECT jsonb_agg(
    CASE item->>'id'
      WHEN 'proj-bath' THEN item || '{"estimate_model":"fixed","estimate_min_dkk":95000,"estimate_max_dkk":165000}'::jsonb
      WHEN 'proj-kitchen' THEN item || '{"estimate_model":"fixed","estimate_min_dkk":35000,"estimate_max_dkk":75000}'::jsonb
      WHEN 'proj-extension' THEN item || '{"estimate_model":"per_square_meter","estimate_min_dkk":18000,"estimate_max_dkk":26000}'::jsonb
      WHEN 'proj-roof' THEN item || '{"estimate_model":"per_square_meter","estimate_min_dkk":1400,"estimate_max_dkk":2400}'::jsonb
      ELSE item
    END ORDER BY ordinality
  )
  FROM jsonb_array_elements(t.pricing_catalog) WITH ORDINALITY AS entries(item, ordinality)
)
WHERE t.id = '11111111-1111-4111-8111-111111111111'
  AND jsonb_typeof(t.pricing_catalog) = 'array';

ALTER TABLE project_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_estimates_read ON project_estimates;
CREATE POLICY project_estimates_read ON project_estimates FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());
DROP POLICY IF EXISTS inspection_requests_read ON inspection_requests;
CREATE POLICY inspection_requests_read ON inspection_requests FOR SELECT
    USING (is_tenant_member(tenant_id) OR is_agency());

-- No client INSERT policy: only the trusted worker writes voice-derived records.
COMMIT;
