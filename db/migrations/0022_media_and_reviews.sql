-- 0022 — Contact Media Ingestion & Google Review Gatekeeper
BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS google_review_url TEXT;

CREATE TABLE IF NOT EXISTS public.contact_media (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    contact_id          UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    file_path           TEXT NOT NULL,
    file_name           TEXT NOT NULL,
    mime_type           TEXT NOT NULL,
    file_size_bytes     BIGINT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_media_tenant ON public.contact_media(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_media_contact ON public.contact_media(contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.google_reviews (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    contact_id          UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    rating              NUMERIC(2,1) NOT NULL,
    feedback_text       TEXT NOT NULL DEFAULT '',
    status              VARCHAR(32) NOT NULL CHECK (status IN ('internal_feedback', 'redirected_to_google')),
    platform            VARCHAR(32) NOT NULL DEFAULT 'web',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_reviews_tenant ON public.google_reviews(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_google_reviews_contact ON public.google_reviews(contact_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.contact_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_reviews ENABLE ROW LEVEL SECURITY;

-- RLS for contact_media
DROP POLICY IF EXISTS contact_media_tenant_isolation ON public.contact_media;
CREATE POLICY contact_media_tenant_isolation ON public.contact_media
  FOR ALL
  TO omni_app
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  );

-- RLS for google_reviews
DROP POLICY IF EXISTS google_reviews_tenant_isolation ON public.google_reviews;
CREATE POLICY google_reviews_tenant_isolation ON public.google_reviews
  FOR ALL
  TO omni_app
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  );

-- Tenant immutability triggers
DROP TRIGGER IF EXISTS contact_media_tenant_immutable ON public.contact_media;
CREATE TRIGGER contact_media_tenant_immutable
  BEFORE UPDATE ON public.contact_media
  FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment();

DROP TRIGGER IF EXISTS google_reviews_tenant_immutable ON public.google_reviews;
CREATE TRIGGER google_reviews_tenant_immutable
  BEFORE UPDATE ON public.google_reviews
  FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment();

-- Grants to omni_app
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_media TO omni_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_reviews TO omni_app;
GRANT SELECT, UPDATE (google_review_url) ON public.tenants TO omni_app;

-- Seed default Google Review URL for Dansk Byg
UPDATE public.tenants
   SET google_review_url = 'https://search.google.com/local/writereview?placeid=ChIJDanskBygLyngby'
 WHERE slug = 'dansk-byg' AND google_review_url IS NULL;

COMMIT;
