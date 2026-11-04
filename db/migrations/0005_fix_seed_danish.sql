-- Keep the already-applied demo data in step with the corrected baseline seed.
-- The original seed used ASCII stand-ins ("Kobenhavn", "hjalpe"), which made the
-- Danish look broken in the portal and in any screenshot taken for a client.
--
-- Idempotent: safe to run repeatedly.

BEGIN;

UPDATE call_logs
   SET transcript_full = '[{"speaker":"agent","text":"Goddag! Du er kommet til København VVS Døgnvagt. Hvordan kan jeg hjælpe?","timestamp_ms":0},
                           {"speaker":"caller","text":"Hovedrøret er sprunget under køkkenvasken! Vand fosser ud!","timestamp_ms":4000},
                           {"speaker":"agent","text":"Luk straks for hovedhanen. Jeg kobler vagten på nu.","timestamp_ms":9000}]'::jsonb,
       summary = 'Akut rørbrud i Kødbyen. Kræver øjeblikkelig udrykning.',
       updated_at = now()
 WHERE room_name = 'kbh-vvs_call_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

COMMIT;
