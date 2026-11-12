-- One caller identity per tenant phone number.
BEGIN;

DROP INDEX IF EXISTS idx_contacts_tenant_phone_normalized;

CREATE UNIQUE INDEX idx_contacts_tenant_phone_normalized
    ON contacts (tenant_id, ((CASE WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') LIKE '00%'
        THEN '+' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 3)
        ELSE '+' || regexp_replace(phone_number, '[^0-9]', '', 'g') END)))
    WHERE phone_number IS NOT NULL;

COMMIT;
