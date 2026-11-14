-- 0018 — Universal calendar booking: optimistic slot holds and confirmed bookings.
-- Apply after 0017 as the schema owner. `omni_app` must not own these tables, and
-- no owner-pool (adminSql) code path may read or write them.
--
-- Why a hold table instead of a unique constraint:
--   A partial exclusion constraint would need btree_gist, which the wheel-packaged
--   preview PostgreSQL does not ship. The gateway therefore takes a ten-minute
--   optimistic hold under a per-tenant advisory transaction lock and re-checks
--   overlap inside that transaction (see src/lib/db/calendar.ts). The WHERE
--   clauses below are what make a lapsed hold stop blocking immediately.

BEGIN;

CREATE TABLE IF NOT EXISTS public.calendar_slot_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  call_log_id UUID REFERENCES public.call_logs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'ics_universal'
    CHECK (provider IN ('google', 'apple_icloud', 'outlook', 'calcom', 'ics_universal')),
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'confirmed', 'expired', 'released')),
  -- Instants are stored with offset so a DST transition cannot shift a booking.
  start_iso TIMESTAMPTZ NOT NULL,
  end_iso TIMESTAMPTZ NOT NULL,
  topic TEXT NOT NULL DEFAULT 'Møde' CHECK (length(topic) BETWEEN 2 AND 180),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  label TEXT NOT NULL DEFAULT '',
  -- The optimistic lock window. Never extended retroactively: a confirmation
  -- that arrives late must fail rather than steal the slot back.
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calendar_slot_holds_window CHECK (end_iso > start_iso),
  CONSTRAINT calendar_slot_holds_expiry CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_calendar_slot_holds_tenant_window
  ON public.calendar_slot_holds (tenant_id, start_iso, end_iso);
-- The hot path filters on (tenant, status='held', expires_at > now()).
CREATE INDEX IF NOT EXISTS idx_calendar_slot_holds_live
  ON public.calendar_slot_holds (tenant_id, expires_at)
  WHERE status = 'held';

CREATE TABLE IF NOT EXISTS public.calendar_bookings (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  call_log_id UUID REFERENCES public.call_logs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'ics_universal'
    CHECK (provider IN ('google', 'apple_icloud', 'outlook', 'calcom', 'ics_universal')),
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled')),
  start_iso TIMESTAMPTZ NOT NULL,
  end_iso TIMESTAMPTZ NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT 'Møde',
  attendee_name TEXT NOT NULL,
  attendee_email TEXT,
  attendee_phone TEXT,
  -- RFC 5545 UID; stable identity across Google/Apple/Outlook invitations.
  ics_uid TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calendar_bookings_window CHECK (end_iso > start_iso)
);

CREATE INDEX IF NOT EXISTS idx_calendar_bookings_tenant_window
  ON public.calendar_bookings (tenant_id, start_iso, end_iso);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_bookings_ics_uid
  ON public.calendar_bookings (tenant_id, ics_uid);

ALTER TABLE public.calendar_slot_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_bookings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Tenant isolation. Agency members see every workspace; a client user sees only
-- the tenant they own. Writes additionally require an authenticated identity, so
-- an empty app.user_id can never insert.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS calendar_slot_holds_read ON public.calendar_slot_holds;
CREATE POLICY calendar_slot_holds_read ON public.calendar_slot_holds
  FOR SELECT TO omni_app
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  );

DROP POLICY IF EXISTS calendar_slot_holds_write ON public.calendar_slot_holds;
CREATE POLICY calendar_slot_holds_write ON public.calendar_slot_holds
  FOR INSERT TO omni_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  );

DROP POLICY IF EXISTS calendar_slot_holds_update ON public.calendar_slot_holds;
CREATE POLICY calendar_slot_holds_update ON public.calendar_slot_holds
  FOR UPDATE TO omni_app
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  );

DROP POLICY IF EXISTS calendar_bookings_read ON public.calendar_bookings;
CREATE POLICY calendar_bookings_read ON public.calendar_bookings
  FOR SELECT TO omni_app
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  );

DROP POLICY IF EXISTS calendar_bookings_write ON public.calendar_bookings;
CREATE POLICY calendar_bookings_write ON public.calendar_bookings
  FOR INSERT TO omni_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  );

DROP POLICY IF EXISTS calendar_bookings_update ON public.calendar_bookings;
CREATE POLICY calendar_bookings_update ON public.calendar_bookings
  FOR UPDATE TO omni_app
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.app_user_id() AND u.is_active)
    AND (public.is_agency() OR public.is_tenant_owner(tenant_id))
  );

-- A booking belongs to exactly one workspace for its whole life. Reusing the
-- 0013 trigger keeps that true for every table that carries a tenant_id.
DROP TRIGGER IF EXISTS calendar_slot_holds_tenant_immutable ON public.calendar_slot_holds;
CREATE TRIGGER calendar_slot_holds_tenant_immutable
  BEFORE UPDATE ON public.calendar_slot_holds
  FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment();

DROP TRIGGER IF EXISTS calendar_bookings_tenant_immutable ON public.calendar_bookings;
CREATE TRIGGER calendar_bookings_tenant_immutable
  BEFORE UPDATE ON public.calendar_bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment();

-- A confirmed hold is immutable evidence: only held/live rows may transition.
CREATE OR REPLACE FUNCTION guard_calendar_hold_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status <> 'confirmed' THEN
    RAISE EXCEPTION 'a confirmed slot hold cannot be reopened';
  END IF;
  IF OLD.status IN ('expired', 'released') THEN
    RAISE EXCEPTION 'a lapsed slot hold is terminal';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_slot_holds_transition ON public.calendar_slot_holds;
CREATE TRIGGER calendar_slot_holds_transition
  BEFORE UPDATE ON public.calendar_slot_holds
  FOR EACH ROW EXECUTE FUNCTION guard_calendar_hold_transition();

-- The service account needs table privileges; RLS still decides which rows.
GRANT SELECT, INSERT, UPDATE ON public.calendar_slot_holds TO omni_app;
GRANT SELECT, INSERT, UPDATE ON public.calendar_bookings TO omni_app;

COMMIT;
