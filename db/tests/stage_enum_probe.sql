-- Proof that every pipeline stage the UI offers is actually accepted by the
-- enum. This exists because an earlier UI invented three values
-- (contact_made, quote_sent, completed) that are NOT in the enum, so picking
-- one raised "invalid input value for enum pipeline_stage" on write.
--
-- Expected: UPDATE 1 for each of the seven real values, and an error for the
-- invented one. Run as omni_app with a real user identity.

\set ON_ERROR_STOP off
\set QUIET on

BEGIN;
SELECT set_config('app.user_id', 'b0000000-0000-4000-8000-000000000001', true);
\set QUIET off

\echo ''
\echo '--- each real stage value must be writable ---'
UPDATE contacts SET pipeline_stage = 'new_lead'       WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
UPDATE contacts SET pipeline_stage = 'contacted'      WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
UPDATE contacts SET pipeline_stage = 'qualified'      WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
UPDATE contacts SET pipeline_stage = 'booked'         WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
UPDATE contacts SET pipeline_stage = 'dire_escalated' WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
UPDATE contacts SET pipeline_stage = 'closed_won'     WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
UPDATE contacts SET pipeline_stage = 'closed_lost'    WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

\echo ''
\echo '--- an invented value must be rejected ---'
UPDATE contacts SET pipeline_stage = 'contact_made'   WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

\echo ''
\echo '--- restore the demo stage ---'
UPDATE contacts SET pipeline_stage = 'dire_escalated' WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
COMMIT;
