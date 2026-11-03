-- 0002 — contact identity and case-insensitive contact lookup.
--
-- Why this exists: the baseline shipped without any uniqueness on a caller's
-- phone number, so creating a caller twice produced two rows and webhook
-- upserts could not be idempotent. VAL-CREATE-103 (duplicate phone must be a
-- field error, not a 500) and webhook idempotency both require this index.
--
-- Partial index: callers may legitimately have no phone number (email-only or
-- Instagram-only), and NULLs must not collide with each other.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_uniq
    ON contacts (tenant_id, phone_number)
    WHERE phone_number IS NOT NULL;

-- Same treatment for email, which the meta/lead-form webhooks upsert on.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_email_uniq
    ON contacts (tenant_id, lower(email))
    WHERE email IS NOT NULL;

-- tenants.slug is used in LiveKit room names and public URLs. It was declared
-- UNIQUE in the baseline; this makes the intent explicit and idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_uniq
    ON tenants (lower(slug));

COMMIT;
