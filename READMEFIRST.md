# READMEFIRST — NORDIC-OMNI

**Read this before you open a single file.**

This document is the ground truth for the NORDIC-OMNI codebase. It records what
was found, what was concluded, what was changed, and what is still fiction. It
supersedes `README.md`, which describes a product that never existed.

Last updated **11 November 2026** after the release-hardening pass. Later commits may
have changed code but not this document; when that happens, trust the code and
correct this file.

> ## 11 November repair status
>
> The call/CRM path was audited and repaired in the working tree. Current truth:
>
> - Tokens are server-owned: anonymous callers are customer-only, owner roles
>   require authenticated owner/agency authorization, contacts must belong to the
>   tenant, and every attempt gets a unique room and call-log row.
> - LiveKit dispatch is pinned to the named agent `nordic-omni` in both the web
>   token and the worker. This removes the stale/unnamed-worker failure where an
>   agent joined but never answered.
> - Browser “live” requires a subscribed agent audio track. Failed attempts show
>   an error and are marked missed; no fabricated greeting or SMS is shown.
> - Caller disconnect closes the job and finalises status, transcript, duration,
>   and recording metadata. The recording SQL ambiguity found in the live test is
>   fixed and covered by a real PostgreSQL integration test.
> - **Azure Christel is live and verified**: the worker logged
>   `Using Microsoft Azure TTS voice: da-DK-ChristelNeural`, produced a 132 KB Ogg,
>   and finalized a completed call with the exact Danish greeting. The Azure plugin
>   is imported on the worker main thread, and SSML text is escaped so a company
>   name containing `&` cannot produce HTTP 400.
> - Estimates are calculated from structured catalog brackets and stored in
>   `project_estimates`. `request_inspection` stores an **unconfirmed request**;
>   it never claims a booking.
> - `client.config.json` is validated and can be applied idempotently with
>   `scripts/apply_client_config.py`. Client #1 has no DID until FlyNumber is
>   assigned; the old VVS demo number was removed.
> - Inbound SIP is implemented and database-tested: an exact DID maps to exactly
>   one active tenant, duplicate calls reuse one contact, and unknown/paused
>   tenants are refused. `scripts/setup_livekit_sip.py` configures the LiveKit
>   inbound trunk and named dispatch rule once FlyNumber supplies the DID.
> - The public call page was rebuilt as a split-screen call surface; on mobile the
>   call console now precedes the detail ledger so the call button is in the first
>   viewport. The portal uses flat surfaces and an audit-log history that collapses
>   older calls.
> - **AI Brain, Shared Memory & Chat**: Agency AI Brain compiles client websites/notes
>   into reviewed knowledge drafts; approval synchronizes 24 approved items to voice
>   and web chat. Customer chat (`/chat/[contactId]`) shares cross-channel memory with
>   voice calls and enforces catalog-grounded non-binding estimates.
> - **Escalations & N8N Integration**: High-value/angry/human-requested interactions
>   log to `conversation_escalations` and forward via HMAC-signed N8N webhooks. The
>   portal overview features an active escalation queue ("Kræver opfølgning") with
>   honest "Kun registreret" status and one-click resolution.
> - Dependency audit is clean (`0 vulnerabilities`), the production build passes
>   all 24 routes, test suite passes 33 Python tests and 18 TypeScript contract tests,
>   and `/api/health` checks the database, LiveKit configuration, and named agent.
>
> Still externally blocked or intentionally absent:
>
> - Real N8N webhook endpoint is not yet configured; escalations are securely
>   persisted and marked "Kun registreret" ("Recorded only").
> - There is no outbound owner phone transfer or SMS/calendar provider. Urgent
>   calls and inspection requests are recorded truthfully but do not claim
>   delivery or confirmation.
> - The LiveKit project registers in “India South”; choose an EU region for
>   Danish production traffic. STT/LLM currently use remote LiveKit Inference.
> - A human Danish listening test is still required; automated checks prove the
>   pipeline and text, not accent quality.
> - FlyNumber DID and SIP credentials have not been supplied. Until they are,
>   Client #1 is browser-only.
>
> Operational pipeline guide: `AI_PIPELINE.md`.
> Full evidence and rulings: `docs/REPAIR_LEDGER.md`.
> Deploy commands: `DEPLOYMENT.md`.

---

## 0. What this project actually is

Two applications sharing one database, serving one agency and its clients:

| | **App A — Client Workspace** | **App B — Agency Console** |
|---|---|---|
| User | The plumber, the dentist, their staff | The agency operator (you) |
| Job | Answer leads, take calls, manage facts | Onboard, configure, monitor, support |
| URL | `/portal/*` | `/agency/*` |
| Auth | session with a `tenant_members` row | session with an `agency_members` row |
| Scope | exactly one tenant, enforced by RLS | every tenant |

Plus a third surface that is **public and unauthenticated**: `/call/[contactId]`,
which is what a customer opens when they tap a call link.

And one backend process: the **Python voice worker** (`agent-worker/`), which
joins LiveKit rooms and speaks to callers.

---

## 1. The eleven invariants

Break any of these and you have broken the product. They are not style
preferences; each one exists because its opposite caused a real defect in this
repository.

1. **Tenant identity comes from the session. Never from a URL parameter.**
   The previous build trusted `?key=` and `?tenant=`. Both are gone.

2. **No browser-side database access.** Every mutation is a server action or a
   route handler. There is no `supabase.from(...)` equivalent in a component.

3. **`DATABASE_URL` connects as `omni_app`, which is NOT the table owner.**
   That is what makes Row Level Security apply. Only webhooks and the login
   lookup may use `DATABASE_ADMIN_URL`.

4. **Facts are client-editable. Behaviour is agency-only.**
   Enforced by a table split plus RLS, not by hiding buttons.

5. **Absence of an RLS policy means denied.** Never add a client INSERT/UPDATE
   policy to `tenant_agent_config` or `knowledge_items`.

6. **`lib/env.ts` hard-fails.** There is no mock-data fallback. The old
   `isPlaceholderDb` flag made the app run on fabricated data in production
   while claiming to be "connected".

7. **The worker refuses to guess a tenant.** If `tenant_id` is missing from
   participant metadata it raises. The old code selected the oldest tenant in
   the database and wrote that caller into a stranger's CRM.

8. **One `Agent` class, tools as `@function_tool` methods.** No
   `FunctionContext` inheritance. Multiple inheritance over it produced a
   `TypeError` that made the worker impossible to construct.

9. **No Docker. No Homebrew. No Supabase. No payment gateways.**
   Postgres runs natively; the target host is a plain Linux VM.

10. **Never claim something works without running it.** The old `README.md`
    said "100% Passed" while the worker could not be imported. Every claim in
    this file has a command behind it (see §9).

11. **Payments are out of scope, permanently.** No Stripe, MobilePay, QuickPay
    or PayPal. Invoicing happens outside the software. This is a product
    boundary, not an unfinished feature.

---

## 2. Verified status

Anything in the left column was proven by executing it.

| Area | State | Evidence |
|---|---|---|
| PostgreSQL 17 native, port 54330 | ✅ | `db/migrations/0001_baseline.sql` applied |
| 12 tables, RLS enabled | ✅ | `\dt`, `pg_class.relrowsecurity` |
| Facts / Behaviour split | ✅ | `tenants` vs `tenant_agent_config` |
| Tenant isolation | ✅ | `db/tests/rls_probe.sql` 8/8 |
| Clients cannot write prompts | ✅ | probe #4 returns `UPDATE 0` |
| Real auth (scrypt + sessions) | ✅ | login 200 / wrong 401 / unknown 401 |
| Route protection | ✅ | `/agency`, `/portal` → 307 `/login` |
| Agency gate | ✅ | client → `/agency` → 307 `/portal` |
| Two-app split | ✅ | `(client)/portal`, `(agency)/agency` |
| Agency prompt editor + history + rollback | ✅ | `/agency/clients/[id]` |
| Token endpoint authorization | ✅ | cross-tenant 403, own 200, anon+contact 200 |
| Voice worker constructs | ✅ | `agent-worker/tests/test_agent_smoke.py` + 30 discovery tests |
| Voice worker registers with cloud | ✅ | `registered worker {"agent_name":"nordic-omni",...}` |
| Browser → agent call | ✅ | agent audio subscribed; two sequential live calls; analyser `running`, closed on hang-up |
| **Azure Christel live** | ✅ | `da-DK-ChristelNeural`, 117 KB Ogg, completed call, Danish transcript |
| **SIP inbound routing** | ✅ (DB) | exact DID → active tenant; duplicate contact reuse; opt-in PostgreSQL test |
| **All three inference APIs answer** | ✅ | `tests/test_inference.py` — TTS 52 KB of Danish, LLM replied, STT transcribed the escalation phrase (§18) |
| **Created callers and workspaces** | ✅ | `/portal/leads/new`, `/agency/clients/new` → 200; RLS probe proves the write path |
| **Recording pipeline** | ✅ | live Ogg saved, `recording_status=ok`, authenticated `200 audio/ogg`, byte-identical, Range `206` |
| **Recording served through RLS** | ✅ | cross-tenant 404, own 200, anonymous 401 |
| **Recording consent is spoken** | ✅ | `test_prompt.py` asserts present when on, absent when off |
| **Prompt honours hours, prices, escalation** | ✅ | `test_prompt.py` 43/43 |
| **pipeline_stage matches the DB enum** | ✅ | `db/tests/stage_enum_probe.sql` — 7 real values write, 1 invented rejected |
| Typecheck / build / audit | ✅ | `tsc` 0, 19 routes, `npm audit` 0 vulnerabilities |

**Still needing a human or an external account:**

1. **Danish accent quality.** The pipeline is live and the real Azure voice is
   proven, but no native Danish listener has judged the accent and pacing.
2. **A real FlyNumber call.** DID routing is database-tested and the setup script
   is ready, but no PSTN number has been supplied or dialled.

---

## 3. How to run everything

Three processes. Nothing else. Total memory on an 8 GB machine: ~2 GB.

### 3.1 PostgreSQL (installed, not in Docker)

```bash
~/Applications/Postgres.app/Contents/Versions/17/bin/pg_ctl \
  -D ~/.nordic-omni-pgdata \
  -o "-p 54330 -k /tmp -c listen_addresses=127.0.0.1" \
  -l /tmp/omni-pg.log start
```

Stop it with the same command and `stop`. It is a normal PostgreSQL 17 cluster;
there is no Docker daemon, no Homebrew, and no Supabase anywhere.

To rebuild from scratch:

```bash
BIN=~/Applications/Postgres.app/Contents/Versions/17/bin
$BIN/psql -h 127.0.0.1 -p 54330 -U postgres -c 'CREATE DATABASE nordic_omni;'
for file in db/migrations/*.sql; do
  echo "Applying $file"
  $BIN/psql -h 127.0.0.1 -p 54330 -U postgres -d nordic_omni \
    -v ON_ERROR_STOP=1 -f "$file" || exit 1
done
```

Production migration order and rollback details are in `DEPLOYMENT.md`.

### 3.2 Web app

```bash
cd web && npm run dev      # http://localhost:3000
```

### 3.3 Voice worker

```bash
cd agent-worker
.venv/bin/python main.py dev     # development
# production: .venv/bin/python main.py start
```

Wait for `registered worker`. **If this process is not running, the browser call
will connect to an empty room and nobody will answer.** That is the single most
common reason "the agent is broken".

The environment is Python 3.12 managed by `uv` (the system Python is 3.9, which
is too old for `livekit-agents`). Recreate it with:

```bash
uv venv --python 3.12
uv pip install -r requirements.txt
```

### 3.4 Demo accounts

Password for all accounts: `demo1234`

| Email | Role | Lands on |
|---|---|---|
| `morten@danskbyg.dk` | client owner of `dansk-byg` | `/portal` |
| `agency@nordic-omni.local` | agency admin | `/agency` |
| `jens@kbhvvs.dk` | legacy pilot owner of `kbh-vvs` | `/portal` |
| `mette@nordicdental.dk` | legacy pilot owner of `nordic-dental` | `/portal` |

Public customer call link (no login):
`/call/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa`

### 3.5 Environment files

Two files, both gitignored. Templates: `web/.env.example`,
`agent-worker/.env.example`.

`web/.env.local`:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=postgres://omni_app:omni_dev_password@127.0.0.1:54330/nordic_omni
DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:54330/nordic_omni
SESSION_SECRET=<64 hex chars>
NEXT_PUBLIC_LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
DEEPSEEK_API_KEY=<optional>
META_VERIFY_TOKEN=nordic_omni_verify
META_APP_SECRET=<optional, needed for webhook signature checks>
```

`agent-worker/.env`:

```env
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
DATABASE_URL=postgres://postgres@127.0.0.1:54330/nordic_omni
STT_MODEL=            # optional override
LLM_MODEL=            # optional override
TTS_MODEL=            # optional override
TTS_VOICE=            # optional override
```

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**No Deepgram, Azure or OpenAI keys are required.** STT, LLM and TTS are served
by LiveKit Inference, which is included with a LiveKit Cloud project.

---

## 4. Architecture

### 4.1 System diagram

```
  Customer's phone / browser
  └── /call/[contactId]            public, no login
          │
          │  POST /api/livekit/token   (authorized by contactId -> tenant)
          ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Next.js 15 (App Router)                                 │
  │                                                          │
  │  (client)/portal      session -> tenant_members          │
  │  (agency)/agency      session -> agency_members          │
  │  /call/[contactId]    public                             │
  │  /login               public                             │
  │                                                          │
  │  Server actions only. No browser DB access.              │
  └───────┬───────────────────────────────┬──────────────────┘
          │ DATABASE_URL (omni_app)        │ DATABASE_ADMIN_URL (owner)
          │ RLS enforced                   │ bypasses RLS
          ▼                                ▼
  ┌──────────────────────────────────────────────────────────┐
  │  PostgreSQL 17  (native, port 54330, no Docker)          │
  │  tenants · tenant_agent_config · contacts · messages      │
  │  call_logs · knowledge_items · ui_command_events          │
  │  users · sessions · tenant_members · agency_members       │
  └───────────────────────────────▲──────────────────────────┘
                                  │ owner connection
          ┌───────────────────────┴──────────────────┐
          │  LiveKit Cloud (media + inference)       │
          └───────────────────────▲──────────────────┘
                                  │ outbound WebSocket
          ┌───────────────────────┴──────────────────┐
          │  agent-worker  (Python 3.12)             │
          │  AgentSession                            │
          │   STT  inference.STT(language=da|en)     │
          │   LLM  inference.LLM                     │
          │   TTS  inference.TTS                     │
          │  Tools: pipeline, pricing, dire escalation│
          └──────────────────────────────────────────┘
```

Key property: **the worker connects outbound to LiveKit Cloud.** No inbound
ports, no port forwarding, no public IP. That is why voice works from a laptop
on a home network, and why it does not require a server to develop against.

### 4.2 Request lifecycle, agency edits a prompt

1. `GET /agency/clients/[id]` → `agency/(layout)` calls `requireAgency()`.
2. `requireAgency()` reads the `omni_session` cookie, verifies the HMAC, looks
   the session row up with the owner connection, confirms an `agency_members`
   row exists. Any failure redirects.
3. Page calls `getAgentConfig(userId, tenantId)` → `withUser()` opens a
   transaction, runs `set_config('app.user_id', ...)`, then queries.
   RLS sees `is_agency() = true` and returns the row.
4. Operator edits the textarea, submits `updateAgentConfig` (a server action).
5. The action re-checks `requireAgency()`, validates with Zod, snapshots the
   previous version into `agent_config_history`, then updates
   `tenant_agent_config` — all inside one transaction with identity set.
6. `revalidatePath` refreshes the page. The next call reads the new prompt.

### 4.3 Request lifecycle, a client reads their dashboard

1. `GET /portal` → `requireUser()` → session must have a `tenant_members` row.
2. `resolveTenant()` returns `session.tenantIds[0]`. The client cannot pass a
   different tenant, even by editing the URL, because the URL carries no tenant.
3. `getTenantOverview(userId, tenantId)` → `withUser()` sets identity →
   `is_tenant_member()` is true for that tenant and false for every other.
4. If the client hand-crafts a request for another tenant's data, RLS returns
   **zero rows**. There is no error to leak existence.

### 4.4 Request lifecycle, an inbound WhatsApp message (NOT YET BUILT)

The route was deleted. When it is rebuilt it must do this, in order:

1. Verify `X-Hub-Signature-256` against `META_APP_SECRET` with a timing-safe
   compare. Reject 401.
2. Deduplicate on Meta's `message.id` using
   `messages (tenant_id, external_id)` unique index.
3. Resolve the tenant **by `tenants.meta_phone_number_id` only**. If it does not
   resolve, return 404 and log. Never fall back to "the first tenant".
4. Upsert the contact, insert exactly **one** row into `messages`.
5. If `contacts.ai_auto_reply_enabled` is false, stop: a human has taken over.
6. Otherwise call the real LLM. If no key is configured, respond with a
   deterministic reply **explicitly labelled as a fallback** in the payload.
7. Insert a `ui_command_events` row so the dashboard reacts.

---

## 5. Facts vs Behaviour — the central design decision

The operator asked for: *"mine would have the ability to edit them, the prompt,
and additional information that they want to pass on to their customers"* — and
chose: **agency is God mode, the client is operational only, the client cannot
touch prompts.**

The naive way to implement that is to hide the prompt field in the UI. That is
not a boundary, it is a suggestion: anyone with devtools or a crafted request
gets through. Supabase RLS cannot help either, because RLS governs rows, not
columns — and all of this data lived in one `tenants` row.

So the table was split along the same line the product is split along:

| | **Facts** → `tenants` | **Behaviour** → `tenant_agent_config` |
|---|---|---|
| What | hours, rates, broadcast, owner contact, DID | voice persona, tone, escalation rules, greeting |
| Owner | the client — it is their business reality | the agency — it is the product |
| Changes | weekly | rarely, deliberately |
| If wrong | a wrong price quoted, annoying | the AI misrepresents the brand, you lose the account |
| Write policy | `is_tenant_owner(id) OR is_agency()` | `is_agency()` **only** |
| Read policy | `is_tenant_member(id) OR is_agency()` | `is_tenant_member(tenant_id) OR is_agency()` |

There is deliberately **no** client INSERT/UPDATE policy on
`tenant_agent_config`. In PostgreSQL, absence of a permissive policy is denial.
That is the entire enforcement mechanism, and it is proven in §12.1 assertion 4.

The same treatment applies to `knowledge_items`: the client can read what the
agent knows, but only the agency writes it. Knowledge is behaviour, because it
governs what the agent is willing to promise.

---

## 6. Data model

Twelve tables. Every one exists for a reason; the reasons are the interesting
part.

### 6.1 Identity

**`users`** — email, `password_hash`, `full_name`, `is_active`. Passwords use
Node's built-in `scrypt` (N=16384, r=8, p=1, 64-byte key), stored as
`scrypt$<saltHex>$<hashHex>`. Chosen over bcrypt/argon2 specifically because it
needs **no native module to compile** — which matters on a low-memory machine
and keeps the dependency tree at zero.

**`sessions`** — server-side rows with `expires_at`. The cookie holds
`<sessionId>.<hmac-sha256>`, so it is tamper-evident and revocable. A stolen
cookie can be killed by deleting a row.

**`agency_members`** (`admin` | `support`) — the God-mode role.

**`tenant_members`** (`owner` | `staff`, plus `tenant_id`) — client-side roles,
scoped to exactly one tenant each.

> Why both `users` and membership tables: a person is a person; what they may do
> is a relationship. Collapsing the two is why the previous build ended up with
> an `owner_pin` column and a hardcoded `'8899'` backdoor.

### 6.2 Tenancy

**`tenants`** — facts only. Notable columns:

- `slug` — used in LiveKit room names and URLs.
- `flynumber_did` — the PSTN number.
- `meta_phone_number_id` — **the only safe way to route an inbound WhatsApp
  message to a tenant.** Added because the previous code guessed.
- `business_hours` JSONB — `{mon:{open,close,closed}, ...}`.
- `pricing_catalog` JSONB — `[{id,service,price_dkk,unit}]`.
- `active_broadcast_message` — the operational notice, injected into the agent
  prompt and shown in the portal.
- `status` — `active | paused | archived`.

Deliberately **absent**: `owner_pin`, `client_passkey`, `customer_system_prompt`,
`copilot_system_prompt`, `system_prompt_overrides`. All removed.

**`tenant_agent_config`** — behaviour. `customer_system_prompt`,
`copilot_system_prompt`, `greeting_script`, `escalation_policy` JSONB,
`voice_id`, `stt_language`, `updated_by`.

**`agent_config_history`** — one row per save, written *before* the update, so
rollback is possible and is itself reversible.

### 6.3 Operations

**`contacts`** — one row per human per tenant. `pipeline_stage`,
`lead_score` (0-100), `estimated_value_dkk`, `ai_auto_reply_enabled` (the human
takeover switch), `last_human_takeover_at`, `shared_memory_summary`,
`sentiment_score`.

**`messages`** — **one table.** The old schema had both `omnichannel_messages`
and `messages` and wrote to both on every webhook, producing duplicates.
`direction` (`inbound|outbound|system`) and `sender`
(`customer|ai|owner|system`) are separate because they answer different
questions. `external_id` plus
`UNIQUE (tenant_id, external_id) WHERE external_id IS NOT NULL` gives webhook
idempotency.

**`call_logs`** — `room_name` is `UNIQUE` and is the join key between the
browser, the worker and the database. `transcript_full` and
`owner_consult_transcript` are JSONB arrays of turns. `dire_reason` uses a
dedicated enum.

**`ui_command_events`** — the replacement for Supabase Realtime. Append-only
broadcast of `FOCUS_SCORECARD`, `FILTER_PIPELINE`, `OPEN_CONTACT_DRAWER`,
`HIGHLIGHT_AVAILABILITY`, `HIGHLIGHT_PRICING`, `TRIGGER_DIRE_MODAL`,
`PULSE_METRIC`.

**`knowledge_items`** — agency-owned rules the agent may cite.

### 6.4 Enums

`language_code` (`da-DK`, `en-US`), `telephony_mode` (`zero_cost_webrtc`,
`paid_sip_trunk`), `pipeline_stage` (7 values), `channel_type` (6 values),
`call_status` (8 values), `dire_reason` (3 values).

### 6.5 Deliberate non-decisions

- **No `tenants.owner_pin`.** Pins are not authentication.
- **No soft-delete columns.** `status` covers pause/archive; deletes cascade.
- **No `updated_by` everywhere.** Only behaviour changes are attributed,
  because only those need an audit trail.
- **No ORM.** Queries are plain tagged SQL via `postgres` (porsager). Drizzle
  would have meant a second schema definition to keep in sync with the SQL, and
  a codegen step on a machine that is already short on memory.

---

## 7. Authorization — two layers, both required

### 7.1 Layer 1, the application

`web/src/lib/auth/guard.ts`

| Guard | Effect |
|---|---|
| `requireUser()` | redirect `/login` if no valid session |
| `requireAgency()` | redirect `/portal` if not agency staff |
| `resolveTenant(requested?)` | a client is pinned to `tenantIds[0]`; a mismatched request redirects to `/no-access`. Agency may pass an explicit id — that is impersonation. |
| `apiSession()` / `apiRequireAgency()` / `apiRequireTenant()` | route-handler variants returning `null` so the caller can 401 |

`web/src/middleware.ts` is intentionally dumb: it only checks that a cookie
**exists** and redirects if not. It runs on the Edge runtime, so it must not
import the database client. Real validation happens in the guards. It also does
not redirect `/login` → `/portal` when a cookie exists, because a stale cookie
would bounce forever.

### 7.2 Layer 2, PostgreSQL RLS

The app connects as `omni_app`, which is **not** the table owner, so policies
apply. Migrations and seeds run as the owner and bypass RLS by design. Webhooks
use the owner connection deliberately.

Identity is injected per transaction:

```ts
await sql.begin(async (tx) => {
  await tx`select set_config('app.user_id', ${userId}, true)`;
  return fn(tx);
});
```

`set_config(name, value, is_local => true)` is the parameterised form of
`SET LOCAL`: scoped to the transaction, and injection-safe.

Policies read it through `SECURITY DEFINER` helpers: `app_user_id()`,
`is_agency()`, `is_tenant_member(uuid)`, `is_tenant_owner(uuid)`. They **must**
be `SECURITY DEFINER`, otherwise the helper that reads `tenant_members` would
recurse into `tenant_members`'s own policy.

### 7.3 The `tenant_agent_config` policy set

```sql
-- READ: the client may see how their AI behaves
CREATE POLICY agent_config_client_read ON tenant_agent_config FOR SELECT
  USING (is_tenant_member(tenant_id) OR is_agency());

-- WRITE: agency only
CREATE POLICY agent_config_agency_write ON tenant_agent_config FOR ALL
  USING (is_agency()) WITH CHECK (is_agency());
```

That is the entire "clients cannot touch prompts" feature. Nothing in the UI
enforces it; the database does.

### 7.4 Authentication

No OAuth, no Auth.js, no magic links — deliberately. The flow is:

1. `POST /api/auth/login` → Zod validate → `adminSql` looks the user up by
   `lower(email)`.
2. `verifyPassword()` runs `scryptSync` and compares with `timingSafeEqual`.
   **A dummy hash is compared even when the user does not exist**, so response
   timing cannot reveal which emails are registered.
3. `createSession()` inserts a `sessions` row and sets
   `omni_session = <id>.<hmac>` with `httpOnly`, `sameSite=lax`,
   `secure` in production, 14-day expiry.
4. `POST /api/auth/logout` deletes the row **and** clears the cookie.

The old system had none of this. It had a client-side modal that compared a
string in the browser and accepted `'MASTER-AGENCY-KEY'`, `'8899'` and
`owner_pin` (default `'1234'`).

### 7.5 The token endpoint

`POST /api/livekit/token` resolves authorization in strict precedence:

1. **Session exists** → must be agency, or a member of that tenant.
2. **No session** → `contactId` must belong to that tenant (the public call link).

Plus: the room name must start with the tenant's slug, so two tenants can never
join the same room.

> This precedence is a **bug fix found by testing, not by reading.** The first
> implementation fell back to `contactId` whenever the session check failed,
> which meant a signed-in client could pass another tenant's contact id and
> receive a valid token for that tenant's room. Verified: cross-tenant request
> returned **HTTP 200**. After the fix: **403**.

---

## 8. The voice pipeline

### 8.1 Why the old worker was dead twice

**Defect 1 — multiple inheritance.** The old code was:

```python
class CustomerAgentTools(CRMTools, KnowledgeTools, WarmTransferTools):
    def __init__(self, tenant_id, contact_id, room_name, db):
        CRMTools.__init__(self, tenant_id, contact_id, db)
        KnowledgeTools.__init__(self, tenant_id, db)
        WarmTransferTools.__init__(self, tenant_id, contact_id, room_name, db)
```

Every parent called a **bare** `super().__init__()`. `super()` resolves against
the *instance's* MRO, so `CRMTools.__init__`'s `super().__init__()` landed on
`KnowledgeTools.__init__(tenant_id, db)` with zero arguments:

```
TypeError: __init__() missing 2 required positional arguments: 'tenant_id' and 'db'
```

The agent could never be constructed. Reproduced with a standalone MRO probe
before touching any LiveKit code.

**Defect 2 — removed SDK API.** `requirements.txt` pinned `livekit-agents>=1.8.0`,
but every file imported:

```python
from livekit.agents.pipeline import VoicePipelineAgent
```

LiveKit's migration guide: *"the VoicePipelineAgent and MultimodalAgent classes
have been deprecated... will need to be updated to use AgentSession."*
The worker died at **import**, before defect 1 could even run.

### 8.2 The v1 shape

One class. Tools are methods. No inheritance.

```python
class CustomerAgent(Agent):
    def __init__(self, *, tenant, contact, db, room_name, knowledge):
        self.tenant, self.contact, self.db = tenant, contact, db
        self.room_name = room_name
        super().__init__(instructions=build_prompt(tenant, contact, knowledge))

    @function_tool()
    async def check_availability_and_pricing(self, ctx: RunContext, query: str) -> str: ...

    @function_tool()
    async def update_pipeline_stage(self, ctx: RunContext, stage: str,
                                    lead_score: int, memory_update: str) -> str: ...

    @function_tool()
    async def trigger_dire_escalation(self, ctx: RunContext, dire_reason: str,
                                      briefing_for_owner: str,
                                      estimated_value_dkk: float) -> str: ...
```

Session construction, from `main.py`:

```python
session = AgentSession(
    vad=silero_instance,
    stt=inference.STT(model="deepgram/nova-3", language="da"),
    llm=inference.LLM(model="google/gemini-2.5-flash"),
    tts=inference.TTS("cartesia/sonic-3", language="da"),
)
await session.start(agent, room=ctx.room)      # agent is POSITIONAL
await session.generate_reply(instructions=greeting)
```

Two API details that are easy to get wrong: `session.start(agent, room=...)`
takes the agent as the first positional argument, and `generate_reply()`
replaces the old `agent.say()`.

### 8.3 Tools are the product

1. **`check_availability_and_pricing`** reads `business_hours`,
   `pricing_catalog` and `knowledge_items` live. A price the client changes at
   10:00 is quoted by the agent at 10:01, with no deploy.
2. **`update_pipeline_stage`** writes `pipeline_stage`, `lead_score`,
   `shared_memory_summary` and emits `FILTER_PIPELINE` so the dashboard moves
   the card.
3. **`trigger_dire_escalation`** is the money shot: contact → `dire_escalated`,
   call → `dire_hold_for_owner`, call log looked up **by `room_name`**, then
   `TRIGGER_DIRE_MODAL` emitted carrying the *real* call log id.

### 8.4 Model routing

`AgentSession` accepts plugin instances or **LiveKit Inference** model strings.
Inference is included with a LiveKit Cloud project and requires no separate
provider keys:

```python
inference.STT(model, *, language=...)
inference.LLM(model, *, provider=..., base_url=..., api_key=...)
inference.TTS(model, *, voice=..., language=...)
```

Defaults: `deepgram/nova-3` (multilingual), `google/gemini-2.5-flash` (cheap,
strong multilingual), `cartesia/sonic-3`. All overridable via `STT_MODEL`,
`LLM_MODEL`, `TTS_MODEL`, `TTS_VOICE` with no code change.

For the best Danish voice, Azure `da-DK-ChristelNeural` remains superior, and
its F0 tier is free at roughly 500k characters/month. That is a one-line change
plus an Azure key — left as an option, not a requirement.

### 8.5 Tenant resolution, and why it used to be dangerous

```python
if not tenant_id:
    raise RuntimeError(
        "No tenant_id in participant metadata. Refusing to route the call, "
        "because guessing a tenant would write into another client's CRM."
    )
```

The old `main.py` did `select('*').from('tenants').limit(1)` here. One line, and
a stranger's burst-pipe emergency lands in the first client in the database.

---

## 9. The audit — every claim checked against the code

Each row was verified by reading the actual execution path or running it. The
`README.md` that shipped with this repo asserted most of the left column as
working features.

### 9.1 Claims that were false

| Claimed | Reality | Evidence |
|---|---|---|
| LiveKit voice agent works | **Dead — could not be constructed** | MRO probe → `TypeError` |
| Worker runs on pinned SDK | **Dead — import failed** | import check on `>=1.8.0` |
| "DeepSeek Meta AI auto-reply" | **No LLM is called.** Reply chosen from three template literals by `String.includes()` | `webhooks/meta/route.ts` |
| Multi-tenant isolation | **Cross-tenant leak**: unresolved tenant → `order('created_at').limit(1)` | `meta/route.ts` L57-60, `main.py` L47-53 |
| Client passkey security | **Theatre**: client-side compare, backdoors `'MASTER-AGENCY-KEY'`, `'8899'`, `owner_pin` default `'1234'`; full CRM shipped in RSC payload before the modal renders | `PasskeyAuthModal.tsx`, `portal/[slug]/page.tsx` |
| Row Level Security | **None existed.** `grep -i 'row level security\|create policy'` → nothing | migrations |
| `/super-admin` protected | **No auth at all.** No `middleware.ts` existed anywhere | tree |
| Meta webhook secure | **Unauthenticated.** No `X-Hub-Signature-256` verification | `meta/route.ts` |
| "100% Passed" test suite | **Self-referential.** Imports only Zod schemas, then defines its own `simulateMetaMessageProcessing()` and asserts its own return value. The "no payment gateways" checkpoint *prints a sentence* | `test/final_boss_verification.ts` |
| App runs on a database | **Ran entirely on `mockData.ts`.** `.env.local` had placeholder URLs, so `isPlaceholderDb` was always true | `.env.local` |
| Call recording works | **Always threw.** Used the Supabase service-role JWT as both S3 access key and secret | `egress_recorder.py` |
| 3 themes work everywhere | **500+ hardcoded hex colours bypass the tokens**; 102 in one file | hex grep |
| Human takeover | ✅ **Actually worked** | `ai_auto_reply_enabled` honoured |
| Owner broadcast | ✅ **Actually worked** (one typo: `DRUFTSMEDDELELSE`) | — |
| DeepSeek text co-pilot | ✅ **Actually worked** — real tool-calling | `copilot/command/route.ts` |

### 9.2 The three-passwords problem

The same tenant had three different passkeys depending on where you looked:

| Source | Passkey for `kbh-vvs` |
|---|---|
| `README.md` | `CPK-KBH-VVS-2026` |
| `supabase/migrations/0002` | `CPK-KBH-8899-DEMO` |
| `mockData.ts` | `CPK-KBH-VVS-2026` |
| `PasskeyAuthModal` also accepted | `8899` (hardcoded) |

All of it is gone. There are no passkeys.

### 9.3 Other defects found and fixed

| Defect | Where | Fix |
|---|---|---|
| `updated_at: "now()"` — a **string** into a `timestamptz` | `supabase_service.py` | real `datetime.now(timezone.utc)` |
| `call_log_id = room_name.replace("call_", "")` fabricated a non-UUID | `warm_transfer_tools.py` | `SELECT id FROM call_logs WHERE room_name = $1` |
| Warm-transfer emitted `TRIGGER_DIRE_MODAL` on **every** action, including `RESOLVE_AND_END` — so hanging up re-opened the ringing modal, forever | `warm-transfer/route.ts` | route deleted; will emit `CLOSE_DIRE_MODAL` on resolve |
| Dual-write to `omnichannel_messages` **and** `messages` | both webhooks | one `messages` table |
| Only ever processed `entry[0].changes[0].messages[0]` | `meta/route.ts` | rebuilt loop over all entries |
| Provisioning fallback returned canned fiction: owner always `Lars Henriksen`/`Alexander Wright`, hours always `08:00-16:30`, plus a fake `Mads Mikkelsen (Test Lead)` inserted into the client's CRM | `provision-wizard/route.ts` | wizard deleted; must fail loudly instead |
| No edit path for `customer_system_prompt`, `copilot_system_prompt`, `knowledge_items`, `client_passkey` after creation | — | agency prompt editor with history + rollback |
| `business_hours` editable **only** by talking to the AI; no form existed | — | still pending (§11) |
| Token endpoint minted a token for any tenant to any caller | `livekit/token/route.ts` | precedence + room-name check (§7.5) |
| Portal header said "LiveKit & Supabase Realtime Connected" as a **hardcoded string** | `portal/page.tsx` | removed |
| `AnimatedScorecards` showed a hardcoded `+24.5%` as a measured delta | `AnimatedScorecards.tsx` | file deleted |

### 9.4 Dead weight deleted

| Item | Size | Why |
|---|---|---|
| `PitchSimulatorDrawer.tsx` | 216 lines | a sales toy that fired fake leads at your own webhooks |
| `test/*.ts` | 3 files, 362 lines | self-referential; worse than no tests because it reported success |
| `/package.json` + `/node_modules` | 83 MB | Express + better-sqlite3 leftover from a different project |
| `server/`, `shared/`, `voice-agent/` | empty | — |
| `ui-command-store.ts` | 430 lines | god-object holding tenant + contacts + calls + modals + dire state machine |
| 8 API routes | — | all deleted rather than half-fixed; to be rebuilt correctly |
| `PasskeyAuthModal`, `Lead360Drawer`, `OwnerBroadcastBanner`, `OwnerCopilotDock`, `DireTransferModal`, `AvailabilityPricingMatrix`, `InteractiveKanban`, `AnimatedScorecards`, `ClientProvisioningModal`, `SuperAdminDeckClient` | ~2,500 lines | all coupled to the deleted model; to be rebuilt on server actions |

---

## 10. Decisions log — and the alternatives that were rejected

Recorded because "why not X" is the question that gets asked six months later.

### 10.1 Zero cloud for the database

**Chosen:** self-hosted PostgreSQL, run natively via Postgres.app binaries.

**Rejected: Supabase Cloud.** Free tier, zero RAM, RLS and Auth out of the box.
But it is a vendor dependency for the system of record, and the operator
explicitly preferred self-hosting.

**Rejected: self-hosted Supabase (Docker).** Supabase's own documentation states
a **4 GB minimum / 8 GB recommended** requirement for the full stack. The
development machine has 8 GB with ~10 GB of swap already in use. It would have
thrashed. Their docs also warn that on macOS, Docker bind mounts break Storage.
This option was genuinely dangerous, not merely inconvenient.

**Consequence accepted:** roughly 5-7 extra days of work, because Supabase Auth,
PostgREST, Realtime and Storage all had to be rebuilt (§7.4, §7.2, pending SSE,
pending uploads).

### 10.2 LiveKit Cloud for media, self-hosted LiveKit rejected

**Chosen:** LiveKit Cloud free tier (no credit card, 1,000 agent session minutes
per month, inference included).

**Rejected: LiveKit self-hosted on the Mac.** This was investigated properly and
failed on facts, not preference:

- LiveKit publishes **no macOS binary** in any recent release — v1.13.11 ships
  `linux_amd64`, `linux_arm64`, `linux_armv7`, `windows_amd64`, `windows_arm64`
  and nothing for Darwin. `brew install livekit` works only because Homebrew
  compiles it, and Homebrew is not installed.
- The official installer literally says *"LiveKit install script for Linux"*.
- Building from source needs Go, which is also not installed.
- And even locally hosted, a client in Copenhagen cannot reach a laptop behind a
  home router.

**Key property that made Cloud the right answer:** agents connect **outbound**,
so the worker runs on the laptop with no ports open. The operator's 8 GB machine
hosts the media control plane for free.

**Known issue:** the created project reports `region: "India South"` despite
being named `eu-project`. That is ~150-200 ms of avoidable latency for Danish
callers. Recreating the project in an EU region is a three-value change.

### 10.3 LiveKit Inference instead of separate provider keys

**Chosen:** `inference.STT/LLM/TTS` with model strings.

**Why:** it removes three separate signups (Deepgram, Azure, OpenAI/DeepSeek) and
three sets of keys from the critical path. It is included in the LiveKit Cloud
project already required for media.

**Cost:** less control over the Danish voice. `TTS_MODEL`/`TTS_VOICE` exist so
Azure `da-DK-ChristelNeural` can be swapped in later without touching code.

### 10.4 Plain SQL instead of an ORM

**Chosen:** `postgres` (porsager) with tagged template queries.

**Rejected: Drizzle.** Would duplicate the schema in TypeScript, require a
codegen step, and add install weight — on a machine already short of RAM, for
a schema of twelve tables.

**Rejected: Prisma.** Heavier still, and its own engine process.

### 10.5 scrypt instead of bcrypt/argon2

**Chosen:** Node's built-in `crypto.scryptSync`.

**Why:** zero dependencies, no native compilation, constant-time comparison
available via `timingSafeEqual`. Argon2id is arguably better cryptography, but
it requires a native module that must compile on the target machine.

### 10.6 Two route groups in one Next.js app, not two deployments

**Chosen:** `(client)/portal` and `(agency)/agency` in one codebase, one build.

**Rejected: two separate apps / a monorepo.** Doubles the deploy surface and
forces a shared package (`contracts/`, `ui/`) to be extracted on day one.

**Reversible:** because the split is a route-group boundary with its own
layouts, either group can be lifted into a separate deployment later without
rewriting a component.

### 10.7 Deferred: live audio merge in warm transfer

**Chosen:** AI escalates → owner takes over the conversation → owner ends the
call.

**Rejected for now: `merged_live_with_owner` / `ai_relaying_owner_instruction`.**
This is the most complex state machine in the original repo: a consult phase, a
relay phase, a merge phase, and a 2-second database polling loop inside
`_monitor_hold_state()`. It is a headline feature and it belongs in v2, not in
the same milestone as "the agent can speak at all".

### 10.8 Education over deletion: keep the real, cut the fiction

The DeepSeek text co-pilot genuinely worked — real tool-calling, real mutations.
It was deleted only because it was wired to the removed data layer, and must be
rebuilt on server actions. The owner-broadcast and human-takeover features also
genuinely worked and were kept conceptually.

---

## 11. What is built, and what is still missing

Updated after M2 (`80f3636`). The previous version of this table listed 14 gaps;
six of them are now closed. Nothing moved from "missing" to "done" without a test
or an HTTP check behind it.

### 11.1 Closed so far

| Was missing | Now | Evidence |
|---|---|---|
| **Create a caller** — no code path at all | `/portal/leads/new`, Zod-validated, duplicate-safe | `db/tests/create_probe.sql` + route 200 |
| **Create a workspace / chatbot** — the UI literally said "provisioning arrives in the next milestone" | `/agency/clients/new`, tenant + agent config in one transaction | route 200, no fabricated rows |
| **Client edits own facts** — `business_hours` had never had a form | `/portal/settings`: owner, broadcast, hours, price list | routes 200 |
| **Knowledge CRUD** — read-only | `/agency/clients/[id]` → add/edit/delete | route 200 |
| **Agent ignored `escalation_policy`** — fetched then discarded | Composed into the prompt; changes when the policy changes | `test_prompt.py` 43/43 |
| **Agent ignored hours and prices** | Open/closed computed; price table injected | `test_prompt.py` |
| **Plain frontend** — 102-line CSS, raw tables | Design system + shell + every page rebuilt | 40 files, +4,224 |
| **Recording was fake** — the S3 recorder threw on every call | Local Ogg/Opus, verified, served through RLS | `test_recordings.py` + live HTTP (§19) |
| **No transcript** — a finished call left no evidence | `transcript_full` written from `session.history` | fills the "Samtale" panel |
| **Recording consent** — a legal risk nobody handled | Spoken line in the greeting, driven by `tenants.record_calls` | `test_prompt.py` |

### 11.2 Still open

| # | Missing | Why it matters | Blocked on |
|---|---|---|---|
| 1 | **Audible call not confirmed by a human** | Plumbing proven to connection; the last leg needs ears | a human with a mic |
| 2 | **Meta + lead-form webhooks** | No channel can create a lead except the UI. This is the omnichannel half | rebuild per §4.4 |
| 3 | **Realtime (SSE) from `ui_command_events`** | The dire alert cannot fire on screen live without it | `GET /api/stream/[tenantId]` |
| 4 | **Dire-transfer modal** | Worker still emits `TRIGGER_DIRE_MODAL`; nothing listens | new component + SSE |
| 5 | **Kanban board** | Pipeline is bars and a table, not draggable cards | new component |
| 6 | **Owner text co-pilot** | Deleted route; was genuinely working | rebuild on server actions |
| 7 | **Agency edit path for client facts** | Agency can write them through RLS, but there is no agency-side form | reuse `/portal/settings` components |
| 8 | **Member management** | No way to invite a second staff login for a client | `/agency/.../members` |
| 9 | **Instagram channel** | Only WhatsApp is testable without Meta app review | Meta |
| 10 | **Recording retention** | Recordings grow forever; ~1 MB per 10 min, no delete-after-N-days policy | before real clients |
| 11 | **`README.md` rewrite** | It still describes six features that never existed | last |
| 12 | **Production build** | `next build` has not been run; needs a clean run on the 8 GB machine | memory |
| 13 | **EU region for LiveKit** | Current project is India South; latency penalty on every turn | recreate project |


---

## 12. Verification — the actual evidence

Reproduce any of this. Every claim in §2 traces to one of these.

### 12.1 Tenant isolation (`db/tests/rls_probe.sql`)

Run as `omni_app` (not the owner):

```bash
~/Applications/Postgres.app/Contents/Versions/17/bin/psql \
  -h 127.0.0.1 -p 54330 -U omni_app -d nordic_omni -f db/tests/rls_probe.sql
```

| # | Assertion | Expected | Observed |
|---|---|---|---|
| 1 | No identity | `0 / 0 / 0` | `0 / 0 / 0` ✅ |
| 2 | kbh-vvs client | 1 tenant, 3 contacts, 1 config | `1 / 3 / 1`, slug `kbh-vvs` ✅ |
| 3 | dental client reading kbh-vvs contacts | `0` | `0` ✅ |
| 4 | client UPDATE on a prompt | `UPDATE 0` | `UPDATE 0` ✅ |
| 5 | client UPDATE on knowledge | `UPDATE 0` | `UPDATE 0` ✅ |
| 6 | client UPDATE on own facts | `UPDATE 1` | `UPDATE 1` ✅ |
| 7 | agency operator | 2 tenants, can write behaviour | `2`, `UPDATE 1` ✅ |
| 8 | client INSERT a tenant | RLS violation | `new row violates row-level security policy` ✅ |

### 12.2 HTTP authorization

```
GET  /                                   -> 307 /login
GET  /agency          (anonymous)        -> 307 /login?next=/agency
GET  /portal          (anonymous)        -> 307 /login?next=/portal
GET  /login                              -> 200
POST /api/auth/login  (correct)          -> 200 {"success":true}
POST /api/auth/login  (wrong password)   -> 401
POST /api/auth/login  (unknown email)    -> 401
GET  /agency          (as client)        -> 307 /portal
GET  /portal          (as client)        -> 200, only its own 3 leads
POST /api/livekit/token own tenant       -> 200
POST /api/livekit/token cross tenant     -> 403
POST /api/livekit/token anonymous+contact-> 200
```

The portal HTML for `jens@kbhvvs.dk` contains `Morten Bondo`, `Kasper Holm`,
`Camilla Vestergaard` and **not** `Elizabeth Warren` (the dental tenant's
contact). Cross-tenant leakage is absent at the rendering layer, not just the
query layer.

### 12.3 Worker

```bash
cd agent-worker && .venv/bin/python tests/test_agent_smoke.py
```

21 checks, all pass, covering: imports, construction (the old `TypeError`),
tool registration on both agents, prompt/greeting composition, `main.py`
wiring, and six regression guards that fail the build if anyone reintroduces
`VoicePipelineAgent`, a first-tenant fallback, Supabase, or a second agent class.

Startup proof:

```
INFO livekit.agents - starting worker  {"version": "1.8.10", "rtc-version": "1.1.21"}
INFO livekit.agents - plugin registered {"plugin": "livekit.plugins.silero"}
INFO livekit.agents - HTTP server listening on :54592
INFO livekit.agents - registered worker
     {"id": "AW_JVmSSXr8wpMd", "url": "wss://<project>.livekit.cloud",
      "region": "India South", "protocol": 18}
```

### 12.4 Type safety

```bash
cd web && npx tsc --noEmit     # 0 errors
```

---

## 13. File map

```
READMEFIRST.md                     this file
docs/STATUS.md                     short operational status
README.md                          HISTORICAL — describes the old, fictional product

db/
  migrations/0001_baseline.sql     655 lines, the entire schema + RLS + seed
  tests/rls_probe.sql              8 assertions proving tenant isolation

web/src/
  middleware.ts                     37 lines, cookie-presence gate (Edge-safe)
  lib/
    env.ts                          65 lines, Zod-validated env, hard-fails
    db/
      client.ts                     77 lines, sql (omni_app) + adminSql + withUser()
      queries.ts                   244 lines, all reads, all RLS-scoped
    auth/
      password.ts                   42 lines, scrypt hash + timingSafeEqual
      session.ts                   133 lines, HMAC cookie + server-side sessions
      guard.ts                      69 lines, requireUser/requireAgency/resolveTenant
    theme/ThemeContext.tsx          theme tokens (3 palettes)
  app/
    page.tsx                        redirect by role
    login/{page,LoginForm}.tsx
    no-access/page.tsx
    (client)/portal/
      layout.tsx                    client shell: sidebar, tenant chip, sign out
      page.tsx                      Overview: real KPIs + CallPanel
      leads/page.tsx                leads table
    (agency)/agency/
      layout.tsx                    agency shell
      page.tsx                      Portfolio: all workspaces + totals
      clients/page.tsx              client table
      clients/[id]/
        page.tsx                    Facts / Behaviour / Knowledge / History
        PromptEditor.tsx            client component: dirty state, save, feedback
        actions.ts                  server actions: update + rollback (snapshot first)
    call/[contactId]/
      page.tsx                      public call page (minimal context only)
      CallClientView.tsx            legacy public call UI
    api/
      auth/login/route.ts           scrypt verify + session create
      auth/logout/route.ts
      livekit/token/route.ts        authorization precedence + room-name check
  components/
    call/CallPanel.tsx              mic, token, Room connect, mute, hang-up, timer
    shell/LogoutButton.tsx
    audio/{OrbVisualizer,WaveformPlayer}.tsx
    theme/ThemeSwitcher.tsx

agent-worker/
  main.py                          181 lines, entrypoint + prewarm + session build
  config.py                         56 lines, hard-failing env
  services/db.py                   160 lines, asyncpg (replaces supabase_service)
  agents/customer_agent.py         236 lines, ONE Agent class + 3 tools
  agents/owner_copilot_agent.py     86 lines, owner tools
  tests/test_agent_smoke.py         21 checks incl. regression guards
  requirements.txt                  76 pinned packages
  .venv/                            gitignored
```

**Line-count story:** the largest file used to be `ClientProvisioningModal.tsx`
at **542 lines**, followed by a **430-line** god store. Both are gone. The
largest file now is the SQL baseline at 655 lines — a schema, not a component.

---

## 14. Roadmap — demo first

The product is a demo. That reorders everything: what a prospect *sees* beats what
is architecturally complete.

### 14.1 Blocking the demo

| # | Task | Why |
|---|---|---|
| 1 | **Make one real call and listen** | Every claim below is downstream of this. All three APIs answer (§18); nobody has heard a live conversation |
| 2 | **`GET /api/stream/[tenantId]` — SSE over `LISTEN/NOTIFY`** | The worker emits `TRIGGER_DIRE_MODAL` and **nothing on screen listens**. This is the demo's climax |
| 3 | **Dire-transfer modal** | Listens to that stream: rings mid-call with the caller, the DKK value and what the AI already said |
| 4 | **Confirm a live call produces a recording** | `recording_status` should be `ok` after a real call (§19) |

### 14.2 Makes the agency viable

| # | Task | Why |
|---|---|---|
| 5 | **DeepSeek agent builder** — paste a knowledge base, draft the Danish prompt, prices, escalation policy | Onboarding one client by hand is fine; fifty is the whole job. Must **propose, never auto-write** |
| 6 | **Azure voice A/B** — `da-DK-ChristelNeural` vs Cartesia | Voice quality is existential and only a human can judge it (§20.4) |
| 7 | **Recording retention** — delete after N days | ~1 MB / 10 min, forever, with no policy |
| 8 | **Agency-side fact editing** | The agency can write facts through RLS but has no form for them |

### 14.3 Real product, not demo

| # | Task | Why |
|---|---|---|
| 9 | **Meta + lead-form webhooks** (per §4.4) | Without these, leads only arrive by hand |
| 10 | **Phone calls** — DID → tenant resolution, `flynumber_did` in the UI (§20.5) | The worker currently *raises* on a SIP call |
| 11 | **Kanban board** | The pipeline is bars and a table, not draggable cards |
| 12 | **Owner text co-pilot** | Deleted with the old data layer; was genuinely working |
| 13 | **EU LiveKit region** | The project reports India South from Denmark: latency tax on every turn |
| 14 | **`next build` clean run** | Before any deployment; needs the machine otherwise idle |
| 15 | **Rewrite `README.md` from the code** | Last, so it cannot drift again |

Items 1–4 are days. Item 5 is the one that changes what the business can do.

---

## 15. Environment traps — read before you debug

1. **The worker must be running.** The browser will connect to an empty room and
   report `live` with nobody speaking. If the agent is silent, check
   `pgrep -f 'main.py dev'` first.

2. **Port 3000 may already be occupied.** A stale `next dev` survives editor
   restarts. `lsof -ti tcp:3000 | xargs kill -9`.

3. **`.env` changes need a server restart.** Next.js reads env at boot;
   `npm run dev` will not pick up a new `SESSION_SECRET` or LiveKit key.

4. **`psql` is not on PATH.** Use the full path
   `~/Applications/Postgres.app/Contents/Versions/17/bin/psql`, and pass
   `-P pager=off`, otherwise `less` eats the output and the command appears to
   hang.

5. **The database is not a service.** It does not start on boot. After a reboot,
   run `pg_ctl ... start` again.

6. **8 GB machine.** Swap was measured at ~10 GB in use. Do not run
   `next build` while `next dev` is running; it peaks around 3 GB and will lock
   the machine. One node process at a time.

7. **No Homebrew, no Docker, no Go.** All three are absent by design. Do not
   install them — every path documented here avoids them deliberately.

8. **System Python is 3.9.** Always use `agent-worker/.venv/bin/python`.
   `livekit-agents` requires 3.10+.

9. **The LiveKit URL scheme is `wss://`, not `https://`.** A wrong scheme gives
   a confusing connection failure rather than a clear error.

10. **The microphone requires a secure context.** `https://` or `localhost`
    only. Testing from a phone over `http://192.168.x.x:3000` silently denies
    mic access.

11. **Browsers keep the old cookie.** After changing `SESSION_SECRET`, existing
    cookies fail HMAC verification and you are silently logged out. Correct
    behaviour, not a bug.

12. **Shell heredocs mangle multi-line `python -c`.** Write a script file
    instead — that is why `agent-worker/tests/` exists. Multi-line
    `git commit -m` breaks the same way; use `git commit -F <file>`.

13. **Long `node -e` one-liners hang silently.** The CDP screenshot script works
    as a file (`/tmp/shot-one.mjs`) and hung as a one-liner — the request-id and
    quoting rules are not worth fighting. Write the file.

14. **`ctx.session_directory` is a temp directory, not storage.** The agents CLI
    creates a per-job folder and it goes away. Always copy the recording out
    before writing the database row — that is the entire reason
    `services/recordings.py` exists.

15. **A recording can be a valid Ogg file and still be empty.** An empty container
    is a few hundred bytes and plays as silence. Hence the
    `MIN_VALID_BYTES = 2048` floor; never trust "the file exists".

16. **`psql` heredocs and `TemporaryDirectory` in tests disagree about cwd.**
    `RECORDINGS_DIR` is read at call time, not import time, so tests can set it
    inside a temp dir. If you move that read to module level, the recording test
    will start writing to your home directory.

17. **Read a screenshot before believing `tsc`.** The invented `pipeline_stage`
    values type-checked perfectly. Three of the last four bugs in this project
    were found by looking at a rendered page, not by reading code.


---

## 16. If you only remember five things

1. **Tenant identity comes from the session, never the URL.**
2. **Facts are client-editable; behaviour is agency-only — enforced by RLS.**
3. **The worker must be running, and it refuses to guess a tenant.**
4. **Never claim it works without running it.** The old `README.md` said
   "100% Passed" while the agent could not even be constructed.
5. **Nothing here is real until `db/tests/rls_probe.sql` and
   `agent-worker/tests/test_agent_smoke.py` both pass.**

---

## Appendix A — Git history of this rebuild

| Commit | What it did |
|---|---|
| `5fe7533` | snapshot of the inherited repo before any change |
| `7f1b276` | zero-cloud baseline schema, Facts/Behaviour split, RLS, probe |
| `8f965d2` | two-app split, real auth, agency prompt editor, bluffs deleted |
| `3257506` | `docs/STATUS.md` |
| `cddeaf2` | voice worker rewritten for LiveKit Agents v1 |
| `139c37f` | browser ↔ agent wiring + token endpoint security fix |
| `5a7e521` | `READMEFIRST.md` — full architecture and audit record |
| `80f3636` | **M2**: create flows, frontend rebuild, agent depth (§17) |
| `2a32ead` | proved the three inference APIs answer; dropped dead env keys (§18) |
| `5276660` | fixed the invented `pipeline_stage` values; finished Danish localisation (§21) |
| `0f7bdde` | **M3**: local call recording, transcript capture, recording consent (§19) |

---

## 17. M2 addendum — the write surface and the design system

This section exists because §13's file map predates M2. Read it alongside §11.

### 17.1 The five statements that used to be the whole product

Before M2, the only mutations reachable from the UI were:

```
insert into agent_config_history   (x2, snapshots)
update tenant_agent_config         (x2, prompt save + rollback)
insert into sessions               (login)
```

There was no `INSERT INTO contacts`. Not "the form was missing" — **the code path
did not exist**. That is why a user could not create a caller or a chatbot.

### 17.2 What was added

```
lib/db/mutations.ts            all writes, all inside withUser() so RLS decides
lib/actions/scope.ts           clientScope() / agencyScope() — tenant from session
lib/actions/types.ts           ActionState, so every form reports the same shape
lib/slug.ts                    Danish-aware slugify (æ→ae, ø→oe, å→aa)

(agency)/agency/clients/new/           create workspace + agent, one transaction
(agency)/agency/clients/[id]/knowledge-actions.ts
(agency)/agency/clients/[id]/KnowledgeEditor.tsx
(agency)/agency/clients/[id]/KnowledgeForm.tsx

(client)/portal/leads/new/             create caller
(client)/portal/leads/[id]/            Lead 360 + CallPanel + conversation
(client)/portal/settings/              owner, broadcast, hours, price list
```

### 17.3 Design system

```
lib:        globals.css — token layer only (radius, elevation, motion, derived
            surfaces, focus ring, skeletons, reduced-motion)
components/ui/core.tsx       cn, Card, CardHeader, Stat, Badge, StagePill
components/ui/feedback.tsx   PageHeader, EmptyState, Avatar, ScoreBar, Skeleton
components/ui/form.tsx       Label, Input, Textarea, Select, Field, FormAlert,
                             buttonClass
components/ui/SubmitButton   client component, disables itself while pending
components/shell/AppShell    sidebar shell, icon nav, mobile drawer
```

Two rules the primitives enforce:

1. **Nothing reads a raw hex.** Every colour is a `var(--token)`, so all three
   themes work without touching a component.
2. **No page hand-rolls a table.** If a table is needed it is a `Card` plus a
   shared header row, not a bespoke `<table className="w-full">`.

### 17.4 Three bugs this pass found in its own new code

Worth recording, because each one was caught by running the thing rather than
reading it.

| Bug | How it showed up | Fix |
|---|---|---|
| Icons passed as components from a server layout into `AppShell` | `Functions cannot be passed directly to Client Components` — every route 500 | icons travel as string keys; the map lives client-side |
| `listMessages` selected `body` | `column "body" does not exist` — Lead 360 500 | the column is `content` |
| A Delete button rendered for clients | `DELETE 0` in the RLS probe: `contacts_delete` is `USING (is_agency())` | replaced with "archive" (an UPDATE the client may do), and the UI says why |

---

## 18. API inventory — what you need, and what is proven

Written because the fair question is *"do you actually have every API you need?"*
The honest answer required testing each one, not asserting it.

Reproduce the whole thing with:

```bash
cd agent-worker && .venv/bin/python tests/test_inference.py
```

### 18.1 The design decision that removes most keys

The voice agent uses **LiveKit Inference** (`inference.STT / LLM / TTS`) rather
than Deepgram + Azure + OpenAI plugins. Inference is billed against the same
LiveKit Cloud project that already carries the media. Consequence: **there is no
second provider to sign up for, and no second key to leak.**

That is also why `DEEPSEEK_API_KEY` and `META_APP_SECRET` can sit empty without
anything breaking — see 18.3.

### 18.2 Proven working, on this machine, right now

| Capability | Provider | Proof |
|---|---|---|
| Media / rooms | LiveKit Cloud `eu-project-qknk1tvv` | worker registers as `AW_JVmSSX8wpMd` |
| **Speech → text** | `deepgram/nova-3` via inference | `"Mit hovedrør er sprunget"` → `"Mit hovedrør er sprunget."` (exact, on attempt 1) |
| **Text → text** | `google/gemini-2.5-flash` via inference | prompt `"Svar kun med ordet: klar"` → `"klar"` |
| **Text → speech** | `cartesia/sonic-3` via inference | 21 audio frames, 47,051 samples of Danish |
| Database | PostgreSQL 17, port 54330 | 12 tables, 8/8 RLS assertions |
| Session signing | `SESSION_SECRET`, 64 hex chars | login 200 / wrong 401 / unknown 401 |
| Token minting | `LIVEKIT_API_KEY` + `SECRET` | JWT signed locally — **no network call at all** |

The STT row is the important one. The probe synthesises Danish with TTS, feeds
that audio back through STT, and asserts the transcript matches. It caught the
exact escalation phrase, which means `trigger_dire_escalation` will actually
fire on *"mit hovedrør er sprunget"*.

**Be honest about the variance.** The probe retries up to three times, because
it has no VAD: the real agent runs Silero inside `AgentSession` and detects
end-of-speech properly, while the probe has to fake it with trailing silence.
Observed across runs:

```
attempt 1  'Mit hovedrør er sprunget.'   exact
attempt 3  'Mit hovedwire sprunget'      partial
attempt 3  'Mit hoved rørsprunget'       partial
```

So STT is **working**, and on clean input it is **exact** — but transcribing
synthetic TTS audio without a VAD is not deterministic. Two consequences:

- The escalation phrase contains `hovedrør`, which survives even the partial
  transcripts above, so escalation is robust to this.
- Human Danish on a real phone line is a different input distribution. It may
  be better (natural prosody) or worse (codec, background noise). **Only a real
  call settles it**, which is why §18.4 exists.


### 18.3 Present but deliberately empty

| Key | Needed by | Status |
|---|---|---|
| `DEEPSEEK_API_KEY` | **nothing today** — reserved for the webhook rebuild | empty, and nothing reads it |
| `META_VERIFY_TOKEN` | webhook GET verification | set, unused (route deleted) |
| `META_APP_SECRET` | `X-Hub-Signature-256` verification | empty — **required before webhooks ship** |
| `GROQ_API_KEY` | nothing | **removed** — it was in the Zod schema but never in `.env` and never used |

`hasLlm` was exported from `lib/env.ts` and referenced by zero files. Dead. Removed.

### 18.4 What this does NOT prove

- **The full RTC loop.** Three APIs answer in isolation. That is not the same as
  browser → room → agent → audio back into your ear. Only a human with a
  microphone settles that.
- **Free-tier limits.** LiveKit Cloud's free agent minutes are finite; a long
  demo can exhaust them. Nothing in the code guards against that.
- **Region.** The project reports `India South` from Denmark, which is a latency
  tax on every turn, not a correctness problem.

### 18.5 The one key you will need next

`META_APP_SECRET`, and only when the Meta webhook is rebuilt (§4.4). Without it
the webhook cannot verify `X-Hub-Signature-256`, and shipping an unverified
public webhook is exactly the defect this project exists to remove.

---

## 19. Call recording

### 19.1 What was there before, and why it never worked

`agent-worker/services/egress_recorder.py` used the Supabase **service-role JWT**
as both the S3 access key *and* the secret. Every attempt raised. Nothing
reported it, so the feature was believed to work for months. It was deleted
rather than left lying.

The lesson is not "configure S3 properly". It is **failure must be visible**.

### 19.2 The mechanism — already in the SDK

`livekit/agents/voice/agent_session.py:1095`:

```python
self.input.audio  = self._recorder_io.record_input(self.input.audio)    # caller
self.output.audio = self._recorder_io.record_output(self.output.audio)  # agent
task = asyncio.create_task(
    self._recorder_io.start(output_path=job_ctx.session_directory / "audio.ogg")
)
```

One flag turns it on:

```python
record={"audio": True, "traces": False, "logs": False, "transcript": False}
```

**`traces`, `logs` and `transcript` are deliberately OFF.** They upload to LiveKit
Cloud. A Danish business's customer calls should not leave the machine in order
to be read back. The transcript is read from `session.history` locally instead —
see 19.4.

### 19.3 The pipeline

```
call ends
   ↓
ctx.add_shutdown_callback(finalise_call)
   ↓
services/recordings.py:preserve()
   wait for audio.ogg (10 × 0.5 s — the recorder task flushes on close)
   stat → exists?  size ≥ 2048 bytes?
   copy → ~/nordic-omni-recordings/<tenant-slug>/<YYYY-MM-DD>/<room>.ogg
   verify → copied size == source size
   ↓
db.set_recording(...)
   recording_path     absolute path (never exposed to a URL)
   recording_bytes    52139
   recording_status   ok | failed | skipped
   recording_error    why, when it failed
   recording_url      '/api/recordings/' || id   ← derived in SQL, from the row id
```

`MIN_VALID_BYTES = 2048` exists because an empty Ogg container is a few hundred
bytes. A 300-byte "recording" is a bug wearing a filename.

### 19.4 Transcript capture

`call_logs.transcript_full` has existed since the baseline and was never written.

On shutdown, `history_to_turns(session.history)` flattens the conversation into
`[{role, content}]` and stores it. This is what fills the **Samtale** panel after
a voice call, and it is what you paste into a reviewer to check whether the
Danish was correct — far more reliable than listening along.

`_content_to_text` accepts a string, a list of parts with `.text`, or a list of
dicts with `"text"`. Serialised histories use the dict form; live objects use
`.text`. Both are handled.

### 19.5 Serving it without leaking

`GET /api/recordings/[callId]`

| Request | Result |
|---|---|
| anonymous | **401** |
| malformed uuid | **404** (not a 500 — a bad cast must not look like a crash) |
| `mette` (dental) asking for `jens`'s recording | **404** |
| `jens`, own recording | **200**, `audio/ogg`, bytes identical to source |

Authorization is **RLS, not a path check**: the `SELECT` runs inside
`withUser()`, so another tenant gets zero rows. Missing / not-yours / failed all
return the same 404, so the endpoint cannot be used to probe what exists.

`recording_url` is computed in SQL as `'/api/recordings/' || id`, so no
filesystem path ever reaches a URL.

### 19.6 Consent — the demo-day question

Recording calls in Denmark requires informing the caller (GDPR). `tenants.record_calls`
drives both the recorder *and* a spoken line in the greeting:

> *"… Hvordan kan jeg hjælpe? **Dette opkald bliver optaget.**"*
> *"… How can I help? **This call is being recorded.**"*

A business owner's first question is *"is that legal?"*. Now the AI answers it
unprompted, in the right language. Asserted in `test_prompt.py` both ways.

### 19.7 The status field, and why NULL is not `failed`

| Value | Meaning |
|---|---|
| `ok` | file verified and copied |
| `failed` | something broke; `recording_error` says what |
| `skipped` | recording switched off for this tenant |
| `NULL` | never attempted — e.g. a call from before this shipped |

An early version of the UI rendered `NULL` as *"Recording failed"*. That is a
different lie, so the view now says **"Ikke forsøgt"**.

### 19.8 Storage

```
~/nordic-omni-recordings/
  VOICE-SAMPLE-da-cartesia.ogg        a voice sample, clearly labelled, not a call
  <tenant-slug>/
    2026-11-05/
      call-abc123.ogg
```

Override the root with `RECORDINGS_DIR`. Names are sanitised so
`tenant_slug="../../etc"` cannot escape the root — asserted in the test.

**No retention policy yet.** ~1 MB per 10 minutes, forever. That is fine for a
demo and unacceptable for fifty clients; see §11.2 item 10.

### 19.9 Files this added

```
db/migrations/0004_call_recording.sql       recording columns + tenants.record_calls
db/migrations/0005_fix_seed_danish.sql      æøå in the applied demo data
db/tests/recording_probe.sql                seeds a servable recording for HTTP tests
db/tests/stage_enum_probe.sql               7 real stages write, 1 invented rejected

agent-worker/services/recordings.py         preserve() + history_to_turns()
agent-worker/tests/test_recordings.py       23 checks, no network
agent-worker/main.py                        finalise_call() on the shutdown hook

web/src/app/api/recordings/[callId]/route.ts   RLS-authorized streaming
web/src/components/call/CallRecording.tsx      player + transcript + visible failure
```

Deleted: `web/src/components/audio/WaveformPlayer.tsx` — dead code that still
claimed recordings were uploaded to Supabase Storage.

---

## 20. Telephony and voice providers — what was actually verified

Researched rather than assumed, because the answers decide whether a phone demo
is possible at all. Sources are noted so these claims can be re-checked.

### 20.1 FlyNumber → LiveKit works, and here is the recipe

Confirmed by FlyNumber staff on their own forum, with a working example
(`discuss.flynumber.com/t/livekit-support/5036`) and now in their docs.

**On the FlyNumber side** — Call Handling → SIP Address:

| Field | Value |
|---|---|
| Transport | UDP (default) |
| Host | `<project>.sip.livekit.cloud` |
| Port | blank (5060 assumed) |
| **Username** | **the FlyNumber itself in E.164**, e.g. `+4570201122` |

The username is the trap. LiveKit matches the SIP `To:` user against the trunk's
`numbers` list, so a name like `john` produces **SIP 404 "status fail, reason not
found"** and nothing appears in the LiveKit dashboard at all.

**On the LiveKit side** — two things, both required:

```json
{ "name": "FlyNumber inbound", "numbers": ["+4570201122"] }
```
```json
{ "name": "dispatch", "rule": { "dispatch_rule_individual": { "room_prefix": "call-" } } }
```

Trunk alone is not enough; without a dispatch rule the call is accepted and then
dropped because it has nowhere to go.

### 20.2 One FlyNumber has one inbound destination

Call Handling is a single card: SIP Address, **or** forward-to-phone, **or**
phone system. Pointing it at LiveKit stops it answering your own app.

What is *not* affected: **outbound cold calling.** Outbound is a separate leg, so
dialling out from that number keeps working even if inbound is repointed.

The real risk is callbacks. Cold-call a plumber, he rings back, and an AI answers
your business number instead of you. Mid-demo that is unpredictable.

**Recommendation, in order:** browser call (zero risk, already built) → a second
FlyNumber (~$3–5/mo) → temporary repoint only outside cold-calling hours.

### 20.3 LiveKit Cloud costs and limits (2026)

From `livekit.com/pricing`:

| | Value |
|---|---|
| Free "Build" plan | $0/mo, no card, **1,000 agent session minutes/month** |
| Agent session | $0.0100/min |
| Telephony | $0.0100/min |
| Bring-your-own SIP trunk | supported — no need to buy a LiveKit number |
| All-in per demo minute | ≈ **$0.03–0.05** |

Metered telephony may require a card on file even on the free plan — worth
checking before demo day rather than during it.

### 20.4 Azure voice: not available through Inference

`inference.TTSModels` contains **32 models, none of them Azure**:

```
cartesia, cartesia/sonic-3.5, cartesia/sonic-3, cartesia/sonic-2,
cartesia/sonic-turbo, cartesia/sonic, deepgram, deepgram/aura, rime, …
azure: []
```

So Azure requires the plugin and **your own** key:

```bash
uv pip install livekit-plugins-azure
```
```env
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=westeurope        # must match the Speech resource location
AZURE_TTS_VOICE=da-DK-ChristelNeural
```
```python
from livekit.plugins import azure
azure.TTS(voice="da-DK-ChristelNeural")
```

`da-DK` is confirmed supported for TTS in Microsoft's language table. The two
Danish neural voices are `da-DK-ChristelNeural` (female) and `da-DK-JeppeNeural`
(male) — the definitive list should be pulled from the Azure voices endpoint once
a key exists, rather than trusted from a truncated docs page.

### 20.5 The worker still cannot answer a phone call

```python
tenant_id = meta.get("tenant_id") or meta.get("tenantId")
if not tenant_id:
    raise RuntimeError("No tenant_id in participant metadata...")
```

That refusal is correct and must stay — it is what stopped callers being routed
into a stranger's CRM. But a **SIP caller's metadata comes from the dispatch
rule**, not from our token route, so there is no `tenant_id` and the call raises.

There is also **zero SIP handling** in the worker (`grep -rn 'sip' --include='*.py'`
returns nothing outside the venv).

The fix, when phone calls are wanted:

1. Read `sip.trunkPhoneNumber` (the dialled DID) from the participant attributes
2. `SELECT ... FROM tenants WHERE flynumber_did = $1` — the column exists
3. Resolve or create the contact from `sip.phoneNumber`
4. Surface `flynumber_did` in the agency UI (currently **read-only**; seeded with
   placeholders `+4570201122` / `+4533123456`)

`main.py` already merges `sip.phoneNumber` into contact resolution; the DID lookup
is the missing half.

---

## 21. The enum lesson — six months of drift in one screenshot

### 21.1 What happened

The database defines:

```sql
CREATE TYPE pipeline_stage AS ENUM (
  'new_lead', 'contacted', 'qualified', 'booked',
  'dire_escalated', 'closed_won', 'closed_lost'
);
```

The UI offered `contact_made`, `quote_sent` and `completed` — **three values that
do not exist.** Picking one in the Lead 360 stage selector would have produced:

```
ERROR: invalid input value for enum pipeline_stage: "contact_made"
```

It was found by **taking a screenshot and looking at it**: one contact rendered
with the raw string `contacted`, grey, no Danish label — because neither the
colour map nor the label map had a key for it.

### 21.2 Why TypeScript said nothing

`pipeline_stage` reaches the browser as `string`. `'contact_made'` is a perfectly
valid string. The type system had no idea the database disagreed, and `tsc` was
green the whole time.

This is the same class of defect as the rest of this repo: **a second, hand-kept
copy of a fact that already exists somewhere authoritative.** The old code
duplicated passkeys across four files; this duplicated an enum.

### 21.3 The proof, so it stays fixed

`db/tests/stage_enum_probe.sql`:

```
--- each real stage value must be writable ---
UPDATE 1   ×7
--- an invented value must be rejected ---
ERROR:  invalid input value for enum pipeline_stage: "contact_made"
```

All seven real values write. The invented one fails. If someone re-introduces a
fantasy stage, running this probe says so immediately.

**The rule:** the enum lives in Postgres. Every list in TypeScript is a *mirror*,
and mirrors need a test. Where possible the value should come from the database
(`select unnest(enum_range(null::pipeline_stage))`) rather than be typed out.

### 21.4 A second instance of the same drift

The transcript column held **two incompatible shapes**:

```json
// the original seed
{ "speaker": "agent", "text": "Goddag! …", "timestamp_ms": 0 }
// what the worker writes
{ "role": "assistant", "content": "Hej, …" }
```

Both are valid history, so the viewer normalises both rather than assuming one.
`normaliseTurns()` accepts `role|speaker` and `content|text`, and treats
`assistant`, `agent` and `ai` as the same speaker. The seeded call now renders
correctly, and so will anything the worker writes later.

If this were being designed again: pick one shape, document it beside the column,
and have the worker and the seed share a fixture.

### 21.5 Danish localisation — finishing the job

A Danish workspace was speaking half English. Now:

| Was | Now |
|---|---|
| Overview / Callers / Settings | Overblik / Kunder / Indstillinger |
| New, Contacted, Quote, Done | Nye, Kontaktet, Kvalificeret, Fuldført |
| `NEW LEAD`, `CONTACTED` pills | NY KUNDE, KONTAKTET, AKUT |
| Caller / Stage / Value / Open → | Kunde / Stadie / Værdi / Åbn → |
| Full name, Phone, Starting stage | Fulde navn, Telefon, Startstadie |
| "1 akutte sager kræver" | "1 akut sag kræver" |
| "1 sessioner" | "1 session" |

The seed data had ASCII stand-ins that made the product look broken in Danish:
`Kobenhavn`, `Dogndvagt`, `hjalpe`, `Hovedroret`, `kokkenvasken`, `Kodbyen`.
Corrected in the baseline **and** in the already-applied rows (`0005`), because
fixing only the baseline leaves the running demo looking wrong.

**Lesson:** `æøå` are not decoration. A Danish product that writes `hjalpe` looks
like a foreign product pretending to be Danish — which is exactly what it was.

---

## 22. Verification commands, all of them

```bash
# database
psql -U omni_app -f db/tests/rls_probe.sql              # 8/8 tenant isolation
psql -U omni_app -f db/tests/create_probe.sql           # insert / RLS deny / 23505
psql -U omni_app -f db/tests/stage_enum_probe.sql       # 7 real stages, 1 rejected
psql -U omni_app -f db/tests/recording_probe.sql        # seeds a servable recording

# worker (no network)
.venv/bin/python tests/test_agent_smoke.py              # 21 checks
.venv/bin/python tests/test_prompt.py                   # 43 checks
.venv/bin/python tests/test_recordings.py               # 23 checks

# worker (network — asks the real APIs)
.venv/bin/python tests/test_inference.py                # TTS + LLM + STT

# web
npx tsc --noEmit                                        # 0 errors
```

HTTP checks are in §12.2; the recording endpoint's matrix is in §19.5.






---

*Written after reading every source file in the repository and executing the
probes quoted above. Where this document and the code disagree, the code is
right and this document is stale — fix it, do not trust it.*
