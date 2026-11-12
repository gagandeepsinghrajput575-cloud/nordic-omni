-- Inbound FlyNumber/SIP routing integrity.
BEGIN;

-- The assigned DID is the only allowed tenant selector for PSTN calls.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_flynumber_did_normalized
    ON tenants (((CASE WHEN regexp_replace(flynumber_did, '[^0-9]', '', 'g') LIKE '00%'
        THEN '+' || substr(regexp_replace(flynumber_did, '[^0-9]', '', 'g'), 3)
        ELSE '+' || regexp_replace(flynumber_did, '[^0-9]', '', 'g') END)))
    WHERE flynumber_did IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone_normalized
    ON contacts (tenant_id, ((CASE WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') LIKE '00%'
        THEN '+' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 3)
        ELSE '+' || regexp_replace(phone_number, '[^0-9]', '', 'g') END)))
    WHERE phone_number IS NOT NULL;

-- Client #1 was re-seeded from a VVS pilot. Its old demo DID is not a live
-- Dansk Byg number and must not route calls until a FlyNumber is provisioned.
UPDATE tenants
   SET flynumber_did = NULL, updated_at = now()
 WHERE id = '11111111-1111-4111-8111-111111111111'
   AND flynumber_did = '+4570201122';

COMMIT;
