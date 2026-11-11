# Deployment runbook — NORDIC-OMNI

Deploy target: one native Linux VM (no Docker), PostgreSQL on port `54330`, the
Next.js web app, and the LiveKit voice worker. All three must be healthy before a
client is given a call link.

## 0. Release gate

Run from the repository root:

```bash
cd web && npm ci && npm run build && npx tsc --noEmit && npm audit
cd ../agent-worker && RUN_DB_TESTS=1 .venv/bin/python -B \
  -m unittest discover -s tests -p 'test_*.py'
cd .. && ./node_modules/.bin/tsx --test test/*.test.ts
```

Expected: 0 build errors, 24 routes, 0 audit vulnerabilities, 33 Python tests
(including the opt-in PostgreSQL tests), and 18 TypeScript contract tests.

## 1. Database

1. Back up first:
   `pg_dump -p 54330 -d nordic_omni -Fc -f /var/backups/nordic-omni-$(date +%F).dump`
2. Apply migrations **in filename order** with `psql -v ON_ERROR_STOP=1`:
   `0001_baseline.sql` … `0011_escalation_resolution.sql`.
3. Confirm RLS and the new indexes:

```sql
select relname, relrowsecurity from pg_class where relname in ('contacts','call_logs','tenants');
select indexname from pg_indexes where indexname like 'idx_%did%' or indexname like 'idx_contacts_tenant_phone%';
```

4. Apply Client #1 facts idempotently:

```bash
cd agent-worker
.venv/bin/python scripts/apply_client_config.py \
  ../clients/client-01-dansk-byg/client.config.json
```

## 2. Web app

Environment file: `/opt/nordic-omni/web/.env.local`. Required keys are listed in
`web/.env.example`. Production values that are easy to get wrong:

```dotenv
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://app.example.dk
NEXT_PUBLIC_LIVEKIT_URL=wss://eu-project-xxxx.livekit.cloud
LIVEKIT_AGENT_NAME=nordic-omni
# Optional: N8N webhook for automated owner notifications (HMAC-SHA256 signed)
# When omitted, escalations are safely persisted with n8n_status='not_configured'
N8N_ESCALATION_WEBHOOK_URL=https://n8n.example.com/webhook/escalation
N8N_WEBHOOK_SECRET=your-secure-shared-secret
```

`DATABASE_URL` must connect as `omni_app` (RLS applies). Only
`DATABASE_ADMIN_URL` may connect as the owner.

```bash
cd /opt/nordic-omni/web
npm ci
npm run build
npm start
```

Health check:

```bash
curl -fsS https://app.example.dk/api/health
```

Expected: `{"status":"ok","checks":{"database":true,"livekit":true,"agent":true},...}`.
The endpoint returns `503` if PostgreSQL is unavailable.

## 3. Voice worker

Environment file: `/opt/nordic-omni/agent-worker/.env`, based on
`agent-worker/.env.example`. For Client #1:

```dotenv
LIVEKIT_AGENT_NAME=nordic-omni
MAX_CONCURRENT_CALLS=1
TTS_VOICE=azure:da-DK-ChristelNeural
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=swedencentral
```

The Azure key stays in this file only (`chmod 600`). Never put it in the web
environment or the browser bundle.

Production command (not `dev`):

```bash
cd /opt/nordic-omni/agent-worker
.venv/bin/python main.py start
```

At startup the log must show all three plugins registered (`openai`, `azure`,
`silero`) and then:

```text
registered worker {"agent_name":"nordic-omni",...}
```

A live call must log:

```text
Using Microsoft Azure TTS voice: da-DK-ChristelNeural
Call finalized as completed ...
Recording saved: ...
```

No `TTS` error, no fallback-provider line, and the `call_logs` row must have
`status='completed'`, a non-zero duration, a transcript, and `recording_status='ok'`.

## 4. Services

Example units are in `deploy/`. Adjust paths/user, then:

```bash
sudo cp deploy/nordic-omni-web.service deploy/nordic-omni-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nordic-omni-web nordic-omni-worker
sudo systemctl status nordic-omni-web nordic-omni-worker
```

Put Caddy/nginx in front of port `3000` with TLS. Do not expose PostgreSQL or the
worker's local HTTP port.

## 5. FlyNumber / SIP inbound (after the DID exists)

Current state: the code path and database routing are ready, but Client #1 has
`telephony.did = null`. It must not receive PSTN calls until a FlyNumber is
assigned.

1. In FlyNumber, create/port the Danish DID and configure SIP forwarding to the
   **LiveKit Cloud SIP URI shown in the LiveKit project** (use the EU project).
2. Put the exact E.164 DID in `clients/client-01-dansk-byg/client.config.json`:

```json
"telephony": { "provider": "flynumber", "did": "+45XXXXXXXX", "status": "active" }
```

3. Apply it and re-run migrations `0008` and `0009` if the database was restored.

```bash
.venv/bin/python scripts/apply_client_config.py ../clients/client-01-dansk-byg/client.config.json
```

4. Preview the LiveKit resources, then create them:

```bash
.venv/bin/python scripts/setup_livekit_sip.py \
  --config ../clients/client-01-dansk-byg/client.config.json \
  --did '+45XXXXXXXX' --dry-run

.venv/bin/python scripts/setup_livekit_sip.py \
  --config ../clients/client-01-dansk-byg/client.config.json \
  --did '+45XXXXXXXX'
```

This creates one inbound trunk and one individual dispatch rule pinned to the
`nordic-omni` agent. It is idempotent: an existing number is reused.

5. Call the DID. The worker must log `Resolved inbound DID ... to tenant dansk-byg`,
   route to `voice_inbound`, and create/reuse exactly one contact for the caller.
   If the DID is unknown or the tenant is paused, the worker refuses the call. It
   never falls back to “first tenant”.

## 6. Staging smoke test

1. Open `/portal`, sign in, verify overview metrics load.
2. Open a caller, click **Start opkald**, allow the microphone.
3. Confirm the UI only says connected after agent audio is subscribed, the timer
   advances, waveform reacts to Christel, and hanging up marks the call completed.
4. Verify the recording plays back in the caller timeline, a range request returns
   `206`, and anonymous access returns `401`.
5. Open the public call link in a private window: no CRM data appears; the call
   still routes to the correct tenant.
6. Test at 390 px and 1440 px. The call button must be visible in the first phone
   viewport.

## 7. Known external blockers

- LiveKit project is currently in **India South**. Create an EU project and swap
  both web and worker credentials before Danish production traffic.
- No owner-phone transfer, SMS, or calendar provider. The UI must not promise
  SMS confirmation or a booked appointment.
- No independent Danish accent review yet. Automation proves the pipeline and the
  provider voice, not a human’s judgement of accent quality.
- FlyNumber DID and SIP credentials are not yet supplied.
- Real N8N webhook is unconfigured by default. Escalations are safely persisted in `conversation_escalations` and shown on the portal as "Kun registreret" ("Recorded only") until an external N8N webhook URL is provided.

## 8. Rollback

```bash
sudo systemctl stop nordic-omni-worker nordic-omni-web
sudo cp -a /opt/nordic-omni/web /opt/nordic-omni/web.previous
# restore the previous build or git checkout the release tag, then npm ci && npm run build
pg_restore -p 54330 -d nordic_omni --clean --if-exists /var/backups/<file>.dump
sudo systemctl start nordic-omni-web nordic-omni-worker
curl -fsS http://127.0.0.1:3000/api/health
```

