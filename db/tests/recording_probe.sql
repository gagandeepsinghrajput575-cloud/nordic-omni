-- Proves the recording serving chain end to end, without needing a phone call.
--
-- Inserts a call_log pointing at a real file on disk, with recording_status='ok',
-- so the API route can be exercised for real: RLS authorization, file streaming,
-- headers and byte count. Run, curl, then delete.

\set ON_ERROR_STOP on
\set QUIET on

BEGIN;

WITH t AS (
    SELECT id AS tenant_id, slug FROM tenants WHERE slug = 'kbh-vvs'
), c AS (
    SELECT id AS contact_id FROM contacts
    WHERE tenant_id = (SELECT tenant_id FROM t) ORDER BY created_at LIMIT 1
)
INSERT INTO call_logs (
    tenant_id, contact_id, room_name, channel, status,
    recording_status, recording_path, recording_bytes, duration_seconds,
    transcript_full
)
SELECT t.tenant_id, c.contact_id, 'call-recording-probe', 'voice_instant_webrtc',
       'completed', 'ok', :'probe_path', :probe_bytes, 42,
       '[{"role":"assistant","content":"Hej, du er kommet til Københavns VVS Døgnvagt."},{"role":"user","content":"Mit hovedrør er sprunget"}]'::jsonb
FROM t, c;

UPDATE call_logs
   SET recording_url = '/api/recordings/' || id::text
 WHERE room_name = 'call-recording-probe';

SELECT id AS probe_call_id, recording_url, recording_status, recording_bytes
FROM call_logs WHERE room_name = 'call-recording-probe';

COMMIT;
