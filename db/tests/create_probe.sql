-- Proof that the create-caller path works under RLS, using exactly the identity
-- mechanism the server action uses: set_config('app.user_id', ..., is_local).
--
-- Run as omni_app (NOT the owner). Expected:
--   1. inserting into the caller's OWN tenant  -> INSERT 0 1  (succeeds)
--   2. inserting into ANOTHER tenant           -> RLS violation (denied)
--   3. duplicate phone in the same tenant      -> unique violation (23505)

\set ON_ERROR_STOP off
\echo ''
\echo '--- 1. jens creates a caller in kbh-vvs (own tenant) ---'
BEGIN;
SELECT set_config('app.user_id', 'b0000000-0000-4000-8000-000000000001', true);
INSERT INTO contacts (tenant_id, full_name, phone_number, preferred_language, pipeline_stage)
VALUES ('11111111-1111-4111-8111-111111111111', 'RLS Probe Caller', '+45 99 88 77 66', 'da', 'new_lead');
COMMIT;

\echo ''
\echo '--- 2. jens tries to create a caller in nordic-dental (someone else) ---'
BEGIN;
SELECT set_config('app.user_id', 'b0000000-0000-4000-8000-000000000001', true);
INSERT INTO contacts (tenant_id, full_name, phone_number, preferred_language, pipeline_stage)
VALUES ('22222222-2222-4222-8222-222222222222', 'Cross Tenant Intruder', '+45 11 11 11 11', 'da', 'new_lead');
COMMIT;

\echo ''
\echo '--- 3. jens creates the same phone twice ---'
BEGIN;
SELECT set_config('app.user_id', 'b0000000-0000-4000-8000-000000000001', true);
INSERT INTO contacts (tenant_id, full_name, phone_number, preferred_language, pipeline_stage)
VALUES ('11111111-1111-4111-8111-111111111111', 'Duplicate Phone', '+45 99 88 77 66', 'da', 'new_lead');
COMMIT;

\echo ''
\echo '--- cleanup: remove the probe caller ---'
BEGIN;
SELECT set_config('app.user_id', 'b0000000-0000-4000-8000-000000000001', true);
DELETE FROM contacts WHERE full_name = 'RLS Probe Caller';
COMMIT;

\echo ''
\echo '--- final: kbh-vvs caller count and that no intruder exists ---'
BEGIN;
SELECT set_config('app.user_id', 'b0000000-0000-4000-8000-000000000001', true);
SELECT count(*) AS kbh_contacts FROM contacts WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
SELECT count(*) AS intruders FROM contacts WHERE full_name = 'Cross Tenant Intruder';
COMMIT;
