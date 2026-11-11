# STATUS — NORDIC-OMNI zero-cloud rebuild

> **Historical rebuild log.** Several “NOT done” items below were implemented
> later. Current call, security, recording, estimate, and onboarding status is in
> the repair section at the top of `READMEFIRST.md` and in `docs/REPAIR_LEDGER.md`.
> Pilot login after the Client #1 seed is `morten@danskbyg.dk` with the existing
> demo password; the old `jens@...` address is historical.

Last verified: working tree at commit `8f965d2`.

## How to run

```bash
# 1. Start PostgreSQL (installed via Postgres.app, no Docker, no Homebrew)
~/Applications/Postgres.app/Contents/Versions/17/bin/pg_ctl \
  -D ~/.nordic-omni-pgdata \
  -o "-p 54330 -k /tmp -c listen_addresses=127.0.0.1" \
  -l /tmp/omni-pg.log start

# 2. Start the web app
cd web && npm run dev        # http://localhost:3000

# 3. (later) LiveKit local media server
#    livekit-server --dev     # devkey / secret
```

Demo accounts — password `demo1234`:

| Email | Role | Lands on |
|---|---|---|
| agency@nordic-omni.local | agency admin | `/agency` |
| jens@kbhvvs.dk | client owner (kbh-vvs) | `/portal` |
| mette@nordicdental.dk | client owner (nordic-dental) | `/portal` |

## What is DONE and verified

| Area | State | Evidence |
|---|---|---|
| PostgreSQL 17 local, no Docker | ✅ | `db/migrations/0001_baseline.sql` applied; 12 tables |
| Facts vs Behaviour split | ✅ | `tenants` vs `tenant_agent_config` |
| RLS with `omni_app` role | ✅ | `db/tests/rls_probe.sql` — 8/8 assertions |
| No cross-tenant leak | ✅ | probe #3 = 0 rows; HTTP: client portal shows only its 3 leads |
| Clients cannot write prompts/knowledge | ✅ | probe #4/#5 = `UPDATE 0` |
| Single `messages` table | ✅ | `omnichannel_messages` removed |
| Real auth (scrypt + sessions) | ✅ | login 200 / wrong 401 / unknown 401 |
| Route protection | ✅ | `/agency` and `/portal` → 307 `/login` when anonymous |
| Agency gate | ✅ | client hitting `/agency` → 307 `/portal` |
| Two-app split | ✅ | `(client)/portal`, `(agency)/agency` |
| Agency prompt editor + history + rollback | ✅ | `/agency/clients/[id]` renders and saves |
| Typecheck | ✅ | `npx tsc --noEmit` — 0 errors |
| Bluffs deleted | ✅ | passkey modal, pitch simulator, fake tests, fake store, dead APIs |
| **Voice worker rewritten** | ✅ | `agent-worker/tests/test_agent_smoke.py` — **17/17 checks pass** |
| Worker starts | ✅ | logs `starting worker v1.8.10`, registers silero, opens HTTP server |

## What is NOT done yet

1. **LiveKit Cloud credentials missing.** The worker is correct and starts, but
   `.env` still holds the placeholder `wss://your-project.livekit.cloud`, so it
   fails with `401` when registering. Get a free project (no credit card) at
   <https://cloud.livekit.io>, paste URL + API key + secret into
   `agent-worker/.env`, then run `.venv/bin/python main.py dev`.
2. **End-to-end call not yet exercised.** Needs (1). Nothing else blocks it:
   STT/LLM/TTS come from LiveKit Inference, so no Deepgram/Azure keys.
3. **Web browser is not wired to the agent yet** — `/api/livekit/token` still
   exists but the portal has no call button, and the dire modal is gone.
4. **Meta/lead-form webhooks not rebuilt.** Deleted, not replaced. Need:
   signature verification, DID-only routing, real LLM call, idempotency.
5. **Copilot API deleted, not rebuilt.**
6. **Client settings pages missing** — hours/pricing/broadcast forms.
7. **No SSE realtime yet** — `ui_command_events` exists, nothing streams it.
8. **Production build not yet run** (8 GB machine, needs a clean run).
9. **README still describes the old, fictional product.**


## Architecture invariants — do not break these

- Tenant identity comes from the **session**, never from a URL parameter.
- No browser-side database access. All mutations are server actions.
- `DATABASE_URL` connects as `omni_app` (RLS applies). Only webhooks and login
  use `DATABASE_ADMIN_URL`.
- Absence of an RLS policy means **denied**. Client write policies on
  `tenant_agent_config` / `knowledge_items` must never exist.
- `env.ts` hard-fails on missing config. Never reintroduce a mock-data fallback.
- No Docker. No Homebrew. No Supabase. No payment gateways.
