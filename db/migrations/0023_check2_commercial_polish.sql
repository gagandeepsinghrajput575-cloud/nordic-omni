-- 0023 — Check 2: Commercial Polish, Follow-up Sequences & Chat Attachments
-- Strictly additive DDL: CREATE TABLE IF NOT EXISTS, nullable ADD COLUMN IF NOT EXISTS
BEGIN;

-- 1. followup_sequences table
CREATE TABLE IF NOT EXISTS public.followup_sequences (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    contact_id          UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    step                INTEGER NOT NULL,
    channel             VARCHAR(32) NOT NULL DEFAULT 'sms',
    scheduled_at        TIMESTAMPTZ NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followup_sequences_tenant ON public.followup_sequences(tenant_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_followup_sequences_contact ON public.followup_sequences(contact_id, status);
CREATE INDEX IF NOT EXISTS idx_followup_sequences_pending ON public.followup_sequences(status, scheduled_at) WHERE status = 'pending';

-- 2. Add attachments column to chat tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agency_client_messages') THEN
    ALTER TABLE public.agency_client_messages ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.client_chat_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    contact_id          UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    sender_role         VARCHAR(32) NOT NULL DEFAULT 'client',
    sender_ref          TEXT,
    channel             VARCHAR(32) NOT NULL DEFAULT 'web_chat',
    kind                VARCHAR(32) NOT NULL DEFAULT 'message',
    body                TEXT NOT NULL,
    attachments         JSONB DEFAULT '[]'::jsonb,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.client_chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- 3. Row Level Security
ALTER TABLE public.followup_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS followup_sequences_tenant_isolation ON public.followup_sequences;
CREATE POLICY followup_sequences_tenant_isolation ON public.followup_sequences
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

DROP POLICY IF EXISTS client_chat_messages_tenant_isolation ON public.client_chat_messages;
CREATE POLICY client_chat_messages_tenant_isolation ON public.client_chat_messages
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

-- 4. Tenant Immutability Triggers
DROP TRIGGER IF EXISTS followup_sequences_tenant_immutable ON public.followup_sequences;
CREATE TRIGGER followup_sequences_tenant_immutable
  BEFORE UPDATE ON public.followup_sequences
  FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment();

DROP TRIGGER IF EXISTS client_chat_messages_tenant_immutable ON public.client_chat_messages;
CREATE TRIGGER client_chat_messages_tenant_immutable
  BEFORE UPDATE ON public.client_chat_messages
  FOR EACH ROW EXECUTE FUNCTION prevent_tenant_reassignment();

-- 5. Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.followup_sequences TO omni_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_chat_messages TO omni_app;

COMMIT;
