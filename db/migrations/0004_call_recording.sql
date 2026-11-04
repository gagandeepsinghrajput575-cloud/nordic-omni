-- 0004 — call recording and the consent switch.
--
-- `call_logs.recording_url` has existed since the baseline and has never been
-- written to, because the previous recorder (egress_recorder.py) used a Supabase
-- service-role JWT as both the S3 access key and the secret, so every attempt
-- threw. It was deleted rather than left lying.
--
-- Recording now happens locally: AgentSession(record=...) writes audio.ogg into
-- the job's session directory, and the worker copies it to permanent storage.
-- No S3, no egress, no third-party credentials.
--
-- These columns exist so that failure is VISIBLE. The old bug was not that
--> recording broke, it was that nothing ever said so.

BEGIN;

ALTER TABLE call_logs
    ADD COLUMN IF NOT EXISTS recording_bytes  BIGINT,
    ADD COLUMN IF NOT EXISTS recording_path   TEXT,
    ADD COLUMN IF NOT EXISTS recording_error  TEXT,
    ADD COLUMN IF NOT EXISTS recording_status VARCHAR(16);

-- Deliberately no DEFAULT: NULL means "not attempted", which is different from
-- 'failed'. A strict CHECK keeps typos out.
ALTER TABLE call_logs
    DROP CONSTRAINT IF EXISTS call_logs_recording_status_check;
ALTER TABLE call_logs
    ADD CONSTRAINT call_logs_recording_status_check
    CHECK (recording_status IS NULL
           OR recording_status IN ('ok', 'failed', 'skipped'));

-- Consent. Danish recording rules require the caller to be informed, so this
-- drives a line in the greeting rather than being an invisible server setting.
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS record_calls BOOLEAN NOT NULL DEFAULT TRUE;

-- Cheap way to find failed recordings without scanning the table.
CREATE INDEX IF NOT EXISTS call_logs_recording_failed_idx
    ON call_logs (tenant_id, created_at DESC)
    WHERE recording_status = 'failed';

COMMIT;
