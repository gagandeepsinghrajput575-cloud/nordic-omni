-- ==============================================================================
-- RLS PROBE — must be run as the application role `omni_app` (NOT the owner).
--   psql -U omni_app -d nordic_omni -f db/tests/rls_probe.sql
--
-- Expected results are printed as comments. Any deviation is a security bug.
-- ==============================================================================
\set ON_ERROR_STOP on
\pset pager off

\echo ''
\echo '=== 1. NO IDENTITY: everything must be invisible ==='
BEGIN;
SET LOCAL app.user_id = '';
SELECT
  (SELECT count(*) FROM tenants)             AS tenants,       -- expect 0
  (SELECT count(*) FROM contacts)            AS contacts,      -- expect 0
  (SELECT count(*) FROM tenant_agent_config) AS agent_config;  -- expect 0
ROLLBACK;

\echo ''
\echo '=== 2. CLIENT OWNER of kbh-vvs: sees ONLY their own tenant ==='
BEGIN;
SET LOCAL app.user_id = 'b0000000-0000-4000-8000-000000000001';
SELECT
  (SELECT count(*) FROM tenants)             AS tenants,       -- expect 1
  (SELECT count(*) FROM contacts)            AS contacts,      -- expect 3
  (SELECT count(*) FROM tenant_agent_config) AS agent_config;  -- expect 1
SELECT slug FROM tenants;                                      -- expect kbh-vvs
ROLLBACK;

\echo ''
\echo '=== 3. CROSS-TENANT: dental client must NOT see kbh-vvs contacts ==='
BEGIN;
SET LOCAL app.user_id = 'b0000000-0000-4000-8000-000000000002';
SELECT count(*) AS kbhvs_contacts_visible                   -- expect 0
  FROM contacts WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
SELECT slug FROM tenants;                                   -- expect nordic-dental
ROLLBACK;

\echo ''
\echo '=== 4. CLIENT ATTEMPTS TO EDIT A PROMPT: must affect 0 rows ==='
BEGIN;
SET LOCAL app.user_id = 'b0000000-0000-4000-8000-000000000001';
UPDATE tenant_agent_config
   SET customer_system_prompt = 'HACKED BY A CLIENT'
 WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
ROLLBACK;

\echo ''
\echo '=== 5. CLIENT ATTEMPTS TO EDIT KNOWLEDGE: must affect 0 rows ==='
BEGIN;
SET LOCAL app.user_id = 'b0000000-0000-4000-8000-000000000001';
UPDATE knowledge_items SET content = 'HACKED'
 WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
ROLLBACK;

\echo ''
\echo '=== 6. CLIENT EDITS THEIR OWN FACTS: must succeed (1 row) ==='
BEGIN;
SET LOCAL app.user_id = 'b0000000-0000-4000-8000-000000000001';
UPDATE tenants SET active_broadcast_message = 'Client may change this'
 WHERE id = '11111111-1111-4111-8111-111111111111';
ROLLBACK;

\echo ''
\echo '=== 7. AGENCY OPERATOR: sees everything and may edit behaviour ==='
BEGIN;
SET LOCAL app.user_id = 'a0000000-0000-4000-8000-000000000001';
SELECT count(*) AS all_tenants FROM tenants;                -- expect 2
UPDATE tenant_agent_config
   SET customer_system_prompt = customer_system_prompt
 WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
ROLLBACK;

\echo ''
\echo '=== 8. CLIENT ATTEMPTS TO CREATE A TENANT: must affect 0 rows ==='
BEGIN;
SET LOCAL app.user_id = 'b0000000-0000-4000-8000-000000000001';
INSERT INTO tenants (name, slug, owner_name, owner_phone, owner_email)
VALUES ('Rogue Tenant', 'rogue-tenant', 'X', '+4500000000', 'x@x.dk');
ROLLBACK;

\echo ''
\echo '=== PROBE COMPLETE ==='
