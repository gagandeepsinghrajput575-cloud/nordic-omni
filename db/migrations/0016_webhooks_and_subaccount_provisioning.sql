-- 0016 — Scoped outbound webhooks and narrowly privileged client-user operations.
-- Apply after 0015 as the schema owner. `omni_app` must not own these tables
-- or the SECURITY DEFINER functions.

BEGIN;

CREATE TABLE IF NOT EXISTS public.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2048),
  signing_secret TEXT NOT NULL CHECK (length(signing_secret) >= 32),
  events TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhooks_tenant_idx
  ON public.webhooks (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status_code INT,
  success BOOLEAN NOT NULL,
  error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_idx
  ON public.webhook_deliveries (webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_idx
  ON public.webhook_deliveries (tenant_id, created_at DESC);

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhooks_manage ON public.webhooks;
CREATE POLICY webhooks_manage ON public.webhooks
  FOR ALL
  TO omni_app
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR (tenant_id IS NOT NULL AND public.is_tenant_owner(tenant_id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR (tenant_id IS NOT NULL AND public.is_tenant_owner(tenant_id)))
  );

DROP POLICY IF EXISTS webhook_deliveries_read ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_read ON public.webhook_deliveries
  FOR SELECT
  TO omni_app
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR (tenant_id IS NOT NULL AND public.is_tenant_owner(tenant_id)))
    AND EXISTS (
      SELECT 1 FROM public.webhooks w
      WHERE w.id = webhook_deliveries.webhook_id
        AND w.tenant_id IS NOT DISTINCT FROM webhook_deliveries.tenant_id
    )
  );

DROP POLICY IF EXISTS webhook_deliveries_append ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_append ON public.webhook_deliveries
  FOR INSERT
  TO omni_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR (tenant_id IS NOT NULL AND public.is_tenant_owner(tenant_id)))
    AND EXISTS (
      SELECT 1 FROM public.webhooks w
      WHERE w.id = webhook_deliveries.webhook_id
        AND w.tenant_id IS NOT DISTINCT FROM webhook_deliveries.tenant_id
    )
  );

CREATE OR REPLACE FUNCTION public.guard_webhook_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Webhook identity and scope are immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_webhook_identity ON public.webhooks;
CREATE TRIGGER guard_webhook_identity
  BEFORE UPDATE ON public.webhooks
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_webhook_identity();

DROP TRIGGER IF EXISTS touch_webhooks ON public.webhooks;
CREATE TRIGGER touch_webhooks
  BEFORE UPDATE ON public.webhooks
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.guard_webhook_delivery_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.webhooks w
    WHERE w.id = NEW.webhook_id
      AND w.tenant_id IS NOT DISTINCT FROM NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Delivery scope does not match webhook'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_webhook_delivery_scope ON public.webhook_deliveries;
CREATE TRIGGER guard_webhook_delivery_scope
  BEFORE INSERT OR UPDATE ON public.webhook_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_webhook_delivery_scope();

REVOKE ALL ON public.webhooks, public.webhook_deliveries FROM PUBLIC, omni_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhooks TO omni_app;
GRANT SELECT ON public.webhook_deliveries TO omni_app;
GRANT INSERT (webhook_id, tenant_id, event_type, status_code, success, error, payload)
  ON public.webhook_deliveries TO omni_app;

REVOKE ALL ON FUNCTION public.guard_webhook_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_webhook_delivery_scope() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.subaccount_require_manager(p_tenant UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  agency BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = public.app_user_id() AND u.is_active
  ) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;

  agency := public.is_agency();
  IF NOT agency AND NOT public.is_tenant_owner(p_tenant) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;

  RETURN agency;
END;
$$;

CREATE OR REPLACE FUNCTION public.subaccount_target_role(
  p_tenant UUID,
  p_user UUID,
  p_agency BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  target_role TEXT;
BEGIN
  SELECT tm.role INTO target_role
  FROM public.tenant_members tm
  JOIN public.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_tenant AND tm.user_id = p_user
  FOR UPDATE OF u;

  IF target_role IS NULL
     OR EXISTS (SELECT 1 FROM public.agency_members am WHERE am.user_id = p_user)
     OR (SELECT count(*) FROM public.tenant_members tm WHERE tm.user_id = p_user) <> 1
     OR (NOT p_agency AND target_role <> 'staff') THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;

  RETURN target_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.subaccount_list_users(p_tenant UUID)
RETURNS TABLE (
  id UUID,
  email VARCHAR,
  full_name VARCHAR,
  is_active BOOLEAN,
  role VARCHAR,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM public.subaccount_require_manager(p_tenant);
  RETURN QUERY
  SELECT u.id, u.email, u.full_name, u.is_active, tm.role, u.created_at
  FROM public.tenant_members tm
  JOIN public.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_tenant
    AND NOT EXISTS (SELECT 1 FROM public.agency_members am WHERE am.user_id = u.id)
  ORDER BY (tm.role = 'owner') DESC, u.created_at ASC, u.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.subaccount_create_user(
  p_tenant UUID,
  p_email TEXT,
  p_name TEXT,
  p_hash TEXT,
  p_role TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  agency BOOLEAN;
  new_id UUID;
BEGIN
  agency := public.subaccount_require_manager(p_tenant);

  IF p_role IS NULL OR p_role NOT IN ('owner', 'staff') OR (NOT agency AND p_role <> 'staff') THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;

  IF p_email IS NULL OR length(btrim(p_email)) NOT BETWEEN 3 AND 255 OR position('@' IN p_email) < 2
     OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 255
     OR p_hash IS NULL OR p_hash !~ '^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$' THEN
    RAISE EXCEPTION 'Invalid user details' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.users (email, full_name, password_hash)
  VALUES (lower(btrim(p_email)), btrim(p_name), p_hash)
  RETURNING id INTO new_id;

  INSERT INTO public.tenant_members (user_id, tenant_id, role)
  VALUES (new_id, p_tenant, p_role);

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.subaccount_set_user_active(
  p_tenant UUID,
  p_user UUID,
  p_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  agency BOOLEAN;
  target_role TEXT;
BEGIN
  agency := public.subaccount_require_manager(p_tenant);

  IF p_active IS NULL THEN
    RAISE EXCEPTION 'Invalid active state' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.tenants WHERE id = p_tenant FOR UPDATE;

  target_role := public.subaccount_target_role(p_tenant, p_user, agency);

  IF NOT p_active AND target_role = 'owner'
     AND (
       SELECT count(*)
       FROM public.tenant_members tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE tm.tenant_id = p_tenant AND tm.role = 'owner' AND u.is_active
     ) <= 1 THEN
    RAISE EXCEPTION 'Cannot disable the last active owner'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.users SET is_active = p_active WHERE id = p_user;

  IF NOT p_active THEN
    DELETE FROM public.sessions WHERE user_id = p_user;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.subaccount_reset_password(
  p_tenant UUID,
  p_user UUID,
  p_hash TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  agency BOOLEAN;
BEGIN
  agency := public.subaccount_require_manager(p_tenant);

  IF p_hash IS NULL OR p_hash !~ '^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$' THEN
    RAISE EXCEPTION 'Invalid password hash' USING ERRCODE = '22023';
  END IF;

  PERFORM public.subaccount_target_role(p_tenant, p_user, agency);

  UPDATE public.users SET password_hash = p_hash WHERE id = p_user;

  DELETE FROM public.sessions WHERE user_id = p_user;
END;
$$;

REVOKE ALL ON FUNCTION public.subaccount_require_manager(UUID) FROM PUBLIC, omni_app;
REVOKE ALL ON FUNCTION public.subaccount_target_role(UUID, UUID, BOOLEAN) FROM PUBLIC, omni_app;
REVOKE ALL ON FUNCTION public.subaccount_list_users(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subaccount_create_user(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subaccount_set_user_active(UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subaccount_reset_password(UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.subaccount_list_users(UUID) TO omni_app;
GRANT EXECUTE ON FUNCTION public.subaccount_create_user(UUID, TEXT, TEXT, TEXT, TEXT) TO omni_app;
GRANT EXECUTE ON FUNCTION public.subaccount_set_user_active(UUID, UUID, BOOLEAN) TO omni_app;
GRANT EXECUTE ON FUNCTION public.subaccount_reset_password(UUID, UUID, TEXT) TO omni_app;

COMMIT;
