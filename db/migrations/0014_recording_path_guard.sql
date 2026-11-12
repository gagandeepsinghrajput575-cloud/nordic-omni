-- 0014 — Defense-in-depth guard on call_logs.recording_path
--
-- The Python worker writes recording_path using the privileged worker role.
-- User/public web sessions execute under `omni_app` (with RLS); even if a
-- contact-scoped policy or client mutation grants UPDATE on call_logs, `omni_app`
-- must never modify `recording_path` to point `/api/recordings/[callId]` at an
-- arbitrary filesystem target. Next.js additionally enforces realpath
-- containment within RECORDINGS_DIR.

BEGIN;

CREATE OR REPLACE FUNCTION guard_call_recording_path()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_user = 'omni_app'
       AND NEW.recording_path IS DISTINCT FROM OLD.recording_path THEN
        RAISE EXCEPTION 'call_logs.recording_path is worker-managed and cannot be modified by omni_app'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_call_recording_path ON call_logs;
CREATE TRIGGER trg_guard_call_recording_path
    BEFORE UPDATE ON call_logs
    FOR EACH ROW
    EXECUTE FUNCTION guard_call_recording_path();

COMMIT;
