-- One caller identity per tenant phone number.
BEGIN;

DROP INDEX IF EXISTS idx_contacts_tenant_phone_normalized;

CREATE UNIQUE INDEX idx_contacts_tenant_phone_normalized
    ON contacts (tenant_id, (regexp_replace(phone_number, '[^0-9+]', '', 'g')))
    WHERE phone_number IS NOT NULL;

COMMIT;
