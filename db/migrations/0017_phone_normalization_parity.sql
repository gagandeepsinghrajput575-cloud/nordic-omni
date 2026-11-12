-- Match services.phone.normalize_phone exactly for legacy and newly entered rows.
-- Earlier indexes retained '+' characters and did not convert international 00.
BEGIN;

DROP INDEX IF EXISTS idx_tenants_flynumber_did_normalized;
CREATE UNIQUE INDEX idx_tenants_flynumber_did_normalized
    ON tenants (((CASE WHEN regexp_replace(flynumber_did, '[^0-9]', '', 'g') LIKE '00%'
        THEN '+' || substr(regexp_replace(flynumber_did, '[^0-9]', '', 'g'), 3)
        ELSE '+' || regexp_replace(flynumber_did, '[^0-9]', '', 'g') END)))
    WHERE flynumber_did IS NOT NULL;

DROP INDEX IF EXISTS idx_contacts_tenant_phone_normalized;
CREATE UNIQUE INDEX idx_contacts_tenant_phone_normalized
    ON contacts (tenant_id, ((CASE WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') LIKE '00%'
        THEN '+' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 3)
        ELSE '+' || regexp_replace(phone_number, '[^0-9]', '', 'g') END)))
    WHERE phone_number IS NOT NULL;

-- Existing aliases now fail migration loudly instead of creating ambiguous
-- tenant routes or duplicate caller identities. Resolve any reported duplicates
-- explicitly before rerunning; do not silently merge customer records.
COMMIT;
