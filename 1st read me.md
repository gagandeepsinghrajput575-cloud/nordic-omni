# 1st Read Me — NORDIC-OMNI ("The Final Form") Master Architecture & Operations Reference

This document is the authoritative architectural and operational reference for **NORDIC-OMNI** (`the-final-form` / `nordic-omni`) and its local **Cockpit Master Controller** & **Arena / Vision AI** telemetry ecosystem. Every file path, symbol name, HTTP endpoint, port, database migration, and test command below has been verified directly against the workspace at `/Users/gaganrajput11/the final form`.

---

## Table of Contents

1. [System Overview & Non-Negotiable Invariants](#1-system-overview--non-negotiable-invariants)
2. [System Topology & Multi-Tenant Voice Engine](#2-system-topology--multi-tenant-voice-engine)
3. [PostgreSQL Multi-Tenant Schema, Monotonic State Transitions & Estimation Engine](#3-postgresql-multi-tenant-schema-monotonic-state-transitions--estimation-engine)
4. [Next.js Agency/Client Portal, Web Chat & Public Call UI](#4-nextjs-agencyclient-portal-web-chat--public-call-ui)
5. [Cockpit Master Controller & Vision AI / Arena Telemetry Integration](#5-cockpit-master-controller--vision-ai--arena-telemetry-integration)
6. [Complete Local Setup, Deployment & Verification Commands](#6-complete-local-setup-deployment--verification-commands)

---

## 1. System Overview & Non-Negotiable Invariants

NORDIC-OMNI is a multi-tenant Danish/English AI receptionist, project estimation, and lead CRM platform composed of four runtime components sharing a native PostgreSQL 17 database:

| Component | Entrypoint / Root | Port | Responsibility |
|---|---|---|---|
| **PostgreSQL 17 (Native)** | `~/.nordic-omni-pgdata` / `db/migrations/` | `54330` | Multi-tenant system of record with Row Level Security (`omni_app` vs owner) |
| **Next.js Web App** | `web/` (`npm run dev` / `npm start`) | `3000` | Agency Console (`/agency/*`), Client Portal (`/portal/*`), Public Call (`/call/[contactId]`), Public Chat (`/chat/[contactId]`), API routes (`/api/*`) |
| **Python Voice Worker** | `agent-worker/main.py` (`dev` / `start`) | `8081` (worker HTTP) | LiveKit Agents worker (`nordic-omni`) handling WebRTC & SIP calls, VAD/STT/LLM/TTS, estimates, escalations, and local `.ogg` recordings |
| **Cockpit Master Controller** | `cockpit/server.js` (`node cockpit/server.js`) | `4000` | Zero-dependency local control daemon, service launcher/health monitor, tool registry, and LM Arena webhook receiver |

### Core Architectural Invariants (from `READMEFIRST.md` & codebase)
1. **Session-Derived Tenant Identity**: Tenant scope comes from the authenticated server session (`sessions` + `tenant_members` / `agency_members`), never from URL query parameters (`?key=` or `?tenant=`).
2. **No Browser-Side DB Access**: All database reads/writes execute in Server Components, Server Actions, or Route Handlers (`web/src/lib/db/`).
3. **Two-Role Database Boundary (`web/src/lib/db/client.ts`)**:
   - `sql` connects via `DATABASE_URL` as non-owner role `omni_app`, executing inside `withUser(userId, fn)` (`set_config('app.user_id', userId, true)`) so PostgreSQL RLS enforces isolation.
   - `adminSql` connects via `DATABASE_ADMIN_URL` as the table owner (bypassing RLS) strictly for pre-identity login, public unauthenticated call/chat routes, and webhooks.
4. **Facts vs. Behaviour Split**: Clients edit business facts in `tenants` (`business_hours`, `pricing_catalog`, `active_broadcast_message`, owner contact info). Only the agency edits AI behaviour in `tenant_agent_config`, `agent_config_history`, and `knowledge_items`. Enforced by PostgreSQL RLS, not UI hiding.
5. **Fail-Loud Environment Validation**: `web/src/lib/env.ts` (`loadEnv`) and `agent-worker/config.py` (`load`) hard-fail on missing required configuration; there is no mock-data fallback.
6. **Strict Tenant Resolution in Worker**: `agent-worker/main.py` (`entrypoint`) refuses calls missing a signed `tenant_id` or matching active `flynumber_did` (`get_tenant_by_did`) and never falls back to selecting the first tenant.
7. **Single `Agent` Class Pattern**: `CustomerAgent` (`agent-worker/agents/customer_agent.py`) and `OwnerCopilotAgent` (`agent-worker/agents/owner_copilot_agent.py`) are standalone subclasses of `livekit.agents.Agent` using `@function_tool()` methods (never `FunctionContext` multiple inheritance or `VoicePipelineAgent`).
8. **No Docker / No Supabase / No In-App Payments**: Native PostgreSQL on a Linux VM or macOS host; Stripe/MobilePay/QuickPay/PayPal are permanently out of scope.

---

## 2. System Topology & Multi-Tenant Voice Engine

```text
  PSTN Caller ──► FlyNumber DID ──► LiveKit Cloud SIP Trunk & Dispatch Rule
                                              │ (metadata: {"tenant_id": ...}, agent: "nordic-omni")
                                              ▼
  Browser Caller (/call/[contactId]) ──► POST /api/livekit/token ──► LiveKit Room
                                              │ (RoomAgentDispatch: "nordic-omni")
                                              ▼
                                 agent-worker/main.py (Agent: nordic-omni)
                                   ├── CallSlotRegistry (threading.Lock, MAX_CONCURRENT_CALLS)
                                   ├── Silero VAD (150ms min_duration barge-in)
                                   ├── STT: azure.STT(["da-DK","en-US"]) or deepgram/nova-3
                                   ├── LLM: inference.LLM (google/gemini-2.5-flash)
                                   ├── TTS: SafeAzureTTS (da-DK-ChristelNeural, 4-socket cap)
                                   │        or inference.TTS (cartesia/sonic-3)
                                   └── Ordered asyncio.Lock shutdown -> DB finalise -> audio.ogg
```

### 2.1 Named Agent Dispatch & Ingress Routing
- **Pinned Agent Name**: Both `web/src/lib/livekit/policy.ts` (`LIVEKIT_AGENT_NAME`) and `agent-worker/main.py` (`AGENT_NAME`) default to `"nordic-omni"` via `LIVEKIT_AGENT_NAME`, preventing stale or unnamed worker routing.
- **Browser WebRTC Path (`voice_instant_webrtc`)**:
  - `POST /api/livekit/token` (`web/src/app/api/livekit/token/route.ts`) validates the request via `BodySchema` and `resolveLiveKitAccess`, rate-limits with `FixedWindowRateLimiter(10, 60_000)`, generates a unique `attemptId`, creates a `call_logs` row with `status = 'ringing'`, and mints a 15-minute `AccessToken` carrying `RoomConfiguration` (`RoomAgentDispatch({ agentName: LIVEKIT_AGENT_NAME })`).
  - Room names and participant identities are attempt-scoped via `buildRoomName(slug, subjectId, attemptId)` and `buildParticipantIdentity(role, subjectId, attemptId)`.
  - Anonymous callers are strictly limited to `role = 'customer'`; `owner_consult` and `owner_merged` require an authenticated agency member or verified `tenant_members` owner.
- **PSTN / SIP Inbound Path (`voice_inbound`)**:
  - `agent-worker/scripts/setup_livekit_sip.py` idempotently provisions a LiveKit SIP inbound trunk (`<slug> inbound`) and individual dispatch rule (`<slug> dispatch`, `room_prefix = <slug>-sip-`, pinned to `agent_name = "nordic-omni"`).
  - In `agent-worker/main.py`, `read_metadata(ctx)` extracts participant metadata, `sip.phoneNumber`, `sip.callID`, `sip.trunkPhoneNumber` (`called_number`), and job/room metadata.
  - When `tenant_id` is absent on SIP calls, `entrypoint` calls `db.get_tenant_by_did(called_number)`, which normalizes digits via `normalize_phone` (`agent-worker/services/phone.py`) and matches `regexp_replace(t.flynumber_did, '[^0-9+]', '', 'g') = $1 AND t.status = 'active'`.
  - Caller contacts are resolved or atomically created via `db.get_or_create_inbound_contact` (`ON CONFLICT ... DO NOTHING` on the partial unique phone index from migration `0009`).
  - Note: Client #1 (`dansk-byg`) currently has `telephony.did: null` in `clients/client-01-dansk-byg/client.config.json` (the legacy VVS DID `+4570201122` was cleared by migration `0008_sip_inbound_routing.sql`) until FlyNumber assigns a Danish DID.

### 2.2 Voice Pipeline, 150ms VAD Barge-In & Provider Selection (`agent-worker/main.py`)
- **Prewarm**: `prewarm(proc: JobProcess)` preloads `silero.VAD.load()` into `proc.userdata["vad"]`.
- **Turn Handling & Barge-In (`build_session`)**:
  - `endpointing`: `{"min_delay": 0.35, "max_delay": 1.5}`
  - `preemptive_generation`: `{"preemptive_tts": True}`
  - `interruption`: `{"enabled": True, "mode": "vad", "min_duration": 0.15, "resume_false_interruption": False}` — 150ms Silero VAD barge-in immediately interrupts agent speech without resuming false interruptions.
- **TTS (`SafeAzureTTS` vs. LiveKit Inference)**:
  - Selected when `TTS_MODEL` starts with `azure`, `voice_id`/`TTS_VOICE` starts with `azure:`, or contains `Neural`, provided `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` (or `AZURE_SPEECH_ENDPOINT`) are present.
  - Defaults to `da-DK-ChristelNeural` for Danish (`da*`) and `en-US-JennyNeural` for English.
  - Falls back to `inference.TTS` (default `cartesia/sonic-3`) with a warning log if Azure credentials are missing.
- **STT & LLM**:
  - Uses `azure.STT` with multi-language hints (`["da-DK", "en-US"]` or `["en-US", "da-DK"]`) when Azure auth is configured, otherwise `inference.STT` (`deepgram/nova-3`).
  - Uses `inference.LLM` (default `google/gemini-2.5-flash` from `agent-worker/config.py`).
- **Greeting & Recording Consent**:
  - After `await session.start(agent, room=ctx.room, record=record_opts)` and a `0.6`s WebRTC audio subscription grace sleep, the worker speaks `greeting_for(tenant, contact)` via `session.say(..., allow_interruptions=True)`.
  - If `tenant.get("record_calls", True)` is enabled, `greeting_for` appends `"Dette opkald bliver optaget."` (Danish) or `"This call is being recorded."` (English) verbatim rather than relying on LLM paraphrasing.

### 2.3 Concurrency, Socket Governance & Ordered Teardown
1. **`CallSlotRegistry` (`agent-worker/services/call_slots.py`)**:
   - Uses `threading.Lock` and a `set[str]` of `job_id`s instead of an `asyncio` primitive or mutable counter, because LiveKit's `request_job` runs on the main worker event loop while `JobExecutorType.THREAD` job shutdowns run on per-job threads/loops.
   - `acquire(job_id)` is idempotent for the same `job_id` and returns `False` when `len(_job_ids) >= limit` (`MAX_CONCURRENT_CALLS`, default `10` in `main.py`, `1` recommended in `agent-worker/.env.example` for 8 GB hosts).
   - `release(job_id)` is idempotent; duplicate or unknown releases return `False` without corrupting capacity.
   - In `request_job`, an `except BaseException:` block (including `asyncio.CancelledError`) calls `release_call_slot(request.id)` so an interrupted `request.accept()` never strands a slot.
2. **`SafeAzureTTS` 4-Socket Cap & Stream Tracking (`agent-worker/agents/azure_tts.py`)**:
   - Subclasses `azure.TTS` and escapes `&`, `<`, `>` via `escape_ssml_text(text)` before synthesis so company names like `"Dansk Byg & Renovering"` cannot cause HTTP 400 SSML errors.
   - Tracks synthesized `tts.ChunkedStream` instances in `self._live_streams: weakref.WeakSet[tts.ChunkedStream]`.
   - Overrides `_ensure_session()` to create a per-call `aiohttp.ClientSession` backed by `aiohttp.TCPConnector(limit=4, limit_per_host=4, ttl_dns_cache=300, enable_cleanup_closed=True)` and `aiohttp.ClientTimeout(total=35, sock_connect=10, sock_read=30)`, preventing unbounded global connector growth across concurrent calls.
   - `aclose()` acquires `self._close_lock` (`asyncio.Lock`), sets `self._closed = True`, closes every tracked stream in `_live_streams`, awaits `super().aclose()`, and closes the owned `_session`.
3. **Thread-Local `asyncpg` Pool (`agent-worker/main.py`, `agent-worker/services/db.py`)**:
   - `_db_state = threading.local()` binds one `Database` pool (`min_size=0, max_size=2, command_timeout=10, statement_timeout="10000", lock_timeout="2000", idle_in_transaction_session_timeout="10000"`) per thread + running event loop, eliminating `"Future attached to a different loop"` crashes.
4. **Ordered `asyncio.Lock` Teardown (`on_shutdown` in `entrypoint`)**:
   - Registered immediately via `ctx.add_shutdown_callback(on_shutdown)` and triggered early when `@session.on("close")` calls `ctx.shutdown(...)`.
   - Guarded by `shutdown_lock = asyncio.Lock()` and `shutdown_complete` flag so duplicate callbacks are no-ops.
   - Executes in strict order:
     1. **`close_agent_session(session)`**: Awaits `session.aclose()` (`timeout=5.0`), then in `finally` awaits `session.tts.aclose()` (`timeout=3.0`) so barge-in handles finish and Azure sockets close even if activity teardown raises.
     2. **`finalise_call(...)`**: Flattens `session.history` via `history_to_turns` (`agent-worker/services/recordings.py`), computes `duration_seconds`, marks `call_logs` as `"completed"` (if turns exist) or `"missed"` (if 0 turns), persists turns idempotently to `messages` via `db.persist_transcript_messages`, and copies `audio.ogg` in a worker thread (`asyncio.to_thread(preserve, ...)`) to `~/nordic-omni-recordings/<tenant_slug>/<YYYY-MM-DD>/<room_name>.ogg` (or `RECORDINGS_DIR`), verifying size `>= MIN_VALID_BYTES` (`2048` bytes) before writing `db.set_recording`.
     3. **`close_db()`**: Closes the thread-local `asyncpg` pool inside `finally`.
     4. **`release_call_slot(job_id)`**: Releases the capacity slot last, only after streams, recordings, and DB connections are closed.

### 2.4 Agent Personas & `@function_tool` Methods
- **`CustomerAgent` (`agent-worker/agents/customer_agent.py`)**:
  - Prompt composed dynamically by `build_prompt(tenant, contact, knowledge, history)` using live Copenhagen time (`ZoneInfo("Europe/Copenhagen")`), deterministic `open_state(tenant)`, `_price_block(tenant)` (with `catalog_item_id` and brackets), `escalation_block(tenant)`, last 12 cross-channel messages, and Danish natural-speech guardrails.
  - Tools:
    1. `check_availability_and_pricing(query)` — re-fetches live `business_hours`, `pricing_catalog`, and `knowledge_items`.
    2. `update_pipeline_stage(stage, lead_score, memory_update)` — validates against `VALID_STAGES`, rejects `'booked'` (requires confirmed appointment), updates `contacts` and emits `FILTER_PIPELINE`.
    3. `record_project_estimate(catalog_item_id, project_type, scope_details, square_meters, followup_notes)` — delegates math to `calculate_estimate`, atomically updates `contacts` + inserts `project_estimates` + emits `PROJECT_ESTIMATE_RECORDED`.
    4. `request_inspection(requested_time_text, address, notes)` — inserts `inspection_requests` (`status="requested"`) + emits `INSPECTION_REQUESTED`, never claiming a confirmed booking.
    5. `trigger_dire_escalation(dire_reason, briefing_for_owner, estimated_value_dkk)` — updates contact to `dire_escalated` (score `95`), updates call status to `dire_hold_for_owner`, emits `TRIGGER_DIRE_MODAL`, persists `conversation_escalations`, and fires optional HMAC-signed N8N webhook (`notify_owner_escalation`).
- **`OwnerCopilotAgent` (`agent-worker/agents/owner_copilot_agent.py`)**:
  - Activated for `role in ("owner", "owner_consult", "owner_merged")` on non-SIP calls.
  - Tools: `brief_owner` (summarizes `contacts` count, DKK pipeline, booked, dire) and `set_broadcast(message)` (updates `tenants.active_broadcast_message` and emits `PULSE_METRIC`).

---

## 3. PostgreSQL Multi-Tenant Schema, Monotonic State Transitions & Estimation Engine

### 3.1 Migration Inventory (`db/migrations/`)
Apply sequentially with `psql -v ON_ERROR_STOP=1`:
1. `0001_baseline.sql` — Extensions (`uuid-ossp`, optional `vector`), enums (`language_code`, `telephony_mode`, `pipeline_stage`, `channel_type`, `call_status`, `dire_reason`), 12 core tables (`users`, `sessions`, `agency_members`, `tenant_members`, `tenants`, `tenant_agent_config`, `agent_config_history`, `contacts`, `messages`, `call_logs`, `ui_command_events`, `knowledge_items`), `omni_app` role, `SECURITY DEFINER` RLS helpers (`app_user_id()`, `is_agency()`, `is_tenant_member(p_tenant)`, `is_tenant_owner(p_tenant)`), `touch_updated_at()` triggers, and initial pilot seeds.
2. `0002_contact_identity.sql` — Partial unique indexes `contacts_tenant_phone_uniq`, `contacts_tenant_email_uniq`, and `tenants_slug_uniq`.
3. `0003_knowledge_priority.sql` — Adds `knowledge_items.priority` (`0..100`, default `50`) and `knowledge_items_tenant_priority_idx`.
4. `0004_call_recording.sql` — Adds `recording_bytes`, `recording_path`, `recording_error`, `recording_status` (`CHECK` in `'ok'`, `'failed'`, `'skipped'`) on `call_logs`, `tenants.record_calls` (`DEFAULT TRUE`), and `call_logs_recording_failed_idx`.
5. `0005_fix_seed_danish.sql` — Fixes UTF-8 Danish characters (`æøå`) in demo `call_logs` transcript and summary.
6. `0006_seed_client_one_dansk_byg.sql` — Seeds Client #1 (`11111111-1111-4111-8111-111111111111`) as **Dansk Byg & Renovering ApS** (`dansk-byg`, owner Morten Bondo, `azure:da-DK-ChristelNeural`, BR18/SBI-252 knowledge items, and realistic contacts).
7. `0007_estimates_and_inspections.sql` — Creates `project_estimates` and `inspection_requests` tables with RLS (`SELECT` only for `is_tenant_member(tenant_id) OR is_agency()`), and backfills `estimate_model`, `estimate_min_dkk`, `estimate_max_dkk` into Client #1's `pricing_catalog`.
8. `0008_sip_inbound_routing.sql` — Creates unique normalized DID index `idx_tenants_flynumber_did_normalized`, normalized contact phone index, and clears the legacy VVS DID `+4570201122` from Client #1.
9. `0009_unique_contact_phone.sql` — Upgrades `idx_contacts_tenant_phone_normalized` to `UNIQUE` on `(tenant_id, regexp_replace(phone_number, '[^0-9+]', '', 'g')) WHERE phone_number IS NOT NULL`.
10. `0010_ai_brain_chat_escalation.sql` — Adds `'web_chat'` to `channel_type` enum (outside transaction); creates `knowledge_sources`, `knowledge_bundles`, `conversation_escalations`, provenance columns (`source_id`, `bundle_id`, `source_label`) on `knowledge_items`, RLS policies, triggers, and `GRANT`s to `omni_app`.
11. `0011_escalation_resolution.sql` — Adds `escalations_member_update` RLS `UPDATE` policy on `conversation_escalations` so tenant members can mark escalations `'resolved'`.

### 3.2 Row Level Security (RLS) & Facts/Behaviour Boundary
- **Facts (`tenants`)**: `tenants_read` allows `is_tenant_member(id) OR is_agency()`; `tenants_client_update` allows `is_tenant_owner(id) OR is_agency()`; only `is_agency()` can `INSERT` or `DELETE`.
- **Behaviour (`tenant_agent_config`, `knowledge_items`, `knowledge_sources`, `knowledge_bundles`)**: Client members have `SELECT` only on `tenant_agent_config` and `knowledge_items` (and no access to `knowledge_sources`/`knowledge_bundles`). Because PostgreSQL RLS denies any command without a permissive policy, clients cannot mutate prompts, voice IDs, or AI knowledge.
- **Voice-Derived Tables (`project_estimates`, `inspection_requests`)**: Clients have `SELECT` only; only the trusted backend (`agent-worker` or `adminSql` in web chat) inserts estimates and inspection requests.

### 3.3 Monotonic Call State Transitions
`call_logs.status` uses enum `call_status` (`ringing`, `in_progress`, `dire_hold_for_owner`, `owner_consulting_ai`, `merged_live_with_owner`, `ai_relaying_owner_instruction`, `completed`, `missed`), where `'completed'` and `'missed'` are **strictly terminal**:
- **`Database.ensure_call_log`** (`agent-worker/services/db.py`): Uses `INSERT ... ON CONFLICT (room_name) DO UPDATE` with `WHERE call_logs.tenant_id = $1 AND call_logs.contact_id = $2` and `CASE WHEN call_logs.status IN ('completed', 'missed') THEN call_logs.status ELSE 'in_progress'::call_status END`. A conflict with another tenant/contact returns zero rows and raises `RuntimeError`.
- **`Database.update_call_status`**: Appends `AND status NOT IN ('completed', 'missed')` so late tool calls (`dire_hold_for_owner`) cannot reopen a finished call.
- **`Database.finalise_call`**: Sets terminal status only if not already terminal, preserves non-empty `transcript_full`, and keeps `GREATEST(duration_seconds, $5)`.
- **`POST /api/livekit/abandon`** (`web/src/app/api/livekit/abandon/route.ts`): Marks abandoned browser attempts `'missed'` only `where id = ${attemptId} and status in ('ringing', 'in_progress')`.

### 3.4 Catalog-Grounded Estimation Engine & Cross-Channel Contracts
- **Shared Zod Contracts (`web/src/contracts/schemas.ts`)**: `PricingItemSchema`, `ProjectEstimateSchema`, `InspectionRequestSchema`, `RecordProjectEstimateInputSchema`, `TranscriptTurnSchema`, `CallLogSchema`, `UICommandEventSchema`, `ProvisionWizardRequestSchema`, `ProvisionTenantPayloadSchema`.
- **Deterministic Calculation (`agent-worker/agents/estimation.py` & `web/src/lib/estimation.ts`)**:
  - `calculate_estimate(catalog, catalog_item_id, square_meters)` / `calculateEstimate(catalog, catalogItemId, squareMeters)` looks up the exact `catalog_item_id`.
  - Reads explicit `estimate_min_dkk` / `estimate_max_dkk` (or parses legacy Danish `"typisk X - Y"` strings via `_legacy_bracket` / `legacyBracket`).
  - Supports `estimate_model` = `'fixed'` or `'per_square_meter'` (requiring `0 < square_meters <= 100_000`); rejects anything else with `EstimateError`.
  - Computes `midpoint = round((low + high) / 2)` outside the LLM; the model can select a `catalog_item_id`, never invent or override the DKK amount.
- **Client #1 Catalog Brackets (Migrations `0006` + `0007`, `clients/client-01-dansk-byg/client.config.json`)**:
  - `proj-bath`: `fixed`, `95,000 – 165,000 DKK`
  - `proj-kitchen`: `fixed`, `35,000 – 75,000 DKK`
  - `proj-extension`: `per_square_meter`, `18,000 – 26,000 DKK/m²`
  - `proj-roof`: `per_square_meter`, `1,400 – 2,400 DKK/m²`
- **Cross-Channel Memory & Escalations**:
  - Voice calls write turns to `messages` (`channel = 'voice_inbound'` or `'voice_instant_webrtc'`, idempotent `external_id = call:<call_id>:<index>`); web chat writes to `messages` (`channel = 'web_chat'`). Both read the last 12 messages and update `contacts.shared_memory_summary`.
  - Escalations insert into `conversation_escalations` (`angry_customer`, `high_value_emergency`, `ai_unanswered_question`, `human_requested`) before attempting `N8N_ESCALATION_WEBHOOK_URL` with `X-OMNI-Signature: sha256=<hmac-sha256>`. When unconfigured, `n8n_status` remains `'not_configured'`.

---

## 4. Next.js Agency/Client Portal, Web Chat & Public Call UI

> **Verified Package Versions (`web/package.json`)**: While originally designed for the Next.js App Router (14+ paradigm), the workspace runs `next@^15.5.29`, `react@19.0.0`, `typescript@^5.7.3`, `tailwindcss@^3.4.17`, `livekit-client@^2.7.4`, `livekit-server-sdk@^2.19.1`, `wavesurfer.js@^7.8.15`, `zustand@^5.0.3`, `postgres@^4.0.0`, and `zod@^4.6.7`.

### 4.1 Authentication & Middleware Boundary
- **`web/src/middleware.ts`**: Edge-runtime gate matching `/agency/:path*` and `/portal/:path*`; redirects to `/login?next=...` if cookie `omni_session` is absent.
- **`web/src/lib/auth/session.ts` & `guard.ts`**:
  - `createSession` writes a row to `sessions` (14-day TTL) and sets `HttpOnly`, `SameSite=Lax` cookie `omni_session` formatted as `<sessionId>.<hmac-sha256>`.
  - `POST /api/auth/login` (`web/src/app/api/auth/login/route.ts`) enforces per-IP (`30/15m`) and per-email (`10/15m`) `FixedWindowRateLimiter` and constant-time `scrypt` verification (`verifyPassword`).
  - `requireUser()`, `requireAgency()`, `resolveTenant()`, `apiSession()`, `apiRequireAgency()`, and `apiRequireTenant()` enforce server-side authorization before any RLS-scoped `withUser` query runs.

### 4.2 Application Surfaces & Routes
1. **Agency Console (`web/src/app/(agency)/agency/`)**:
   - `/agency` (`page.tsx`): Portfolio-wide pipeline DKK, workspace count, caller count, call count, and open emergencies.
   - `/agency/clients`, `/agency/clients/new`, `/agency/clients/[id]`: Workspace provisioning, `PromptEditor` + `agent_config_history` rollback (`restoreAgentConfigForm`), `KnowledgeEditor`, and `AiBrainPanel`.
   - **AI Brain Compiler (`web/src/lib/ai/website.ts`, `web/src/lib/ai/brain.ts`, `web/src/lib/ai/inference.ts`)**: `assertPublicUrl` blocks private/loopback/link-local/metadata IPs, caps at `4` pages and `450_000` bytes per page, validates redirects, and compiles via LiveKit Inference (`https://agent-gateway.livekit.cloud/v1/chat/completions`, default `google/gemini-2.5-flash`) into `knowledge_bundles` drafts requiring explicit agency approval.
2. **Client Portal (`web/src/app/(client)/portal/`)**:
   - `/portal` (`page.tsx`): Live workspace KPIs, `AiCopilotBar` (natural-language commands via `executeClientAiCommand`), emergency alert banner, open `Kræver opfølgning` escalation queue with `resolveEscalationAction`, pipeline stage bars, and recent leads.
   - `/portal/leads`, `/portal/leads/new`, `/portal/leads/[id]`: Full caller CRM detail with `LeadDetailForm`, `CallPanel` (in-browser WebRTC call widget with `useAudioBands` 24-band FFT visualizer), `CallRecording` (renders `<audio controls src="/api/recordings/[callId]">`, visible `ok`/`failed`/`skipped`/`null` status badges, and transcript turns), `project_estimates`, and `inspection_requests`.
   - `/portal/settings`: Fact-only editing (`BusinessDetailsForm`, `HoursForm`, `PricingForm`) paired with a read-only view of `tenant_agent_config`.
3. **Public Unauthenticated Surfaces**:
   - **Public Call UI (`/call/[contactId]`, `web/src/app/call/[contactId]/CallClientView.tsx`)**:
     - Exposes zero internal CRM notes (`shared_memory_summary` is omitted).
     - Stage state machine: `'idle' | 'connecting' | 'waiting_for_agent' | 'active' | 'ended' | 'error'`.
     - Single-flight guard (`startInFlightRef`), `30_000` ms `AGENT_TIMEOUT_MS`, `Room` with `{ adaptiveStream: true, dynacast: true }`, unlocks audio via `room.startAudio()`, enables mic with echo cancellation/noise suppression/AGC, and transitions to `'active'` only after `RoomEvent.TrackSubscribed` receives a remote audio track and `audioElement.play()` succeeds.
     - Renders `OrbVisualizer` (`web/src/components/audio/OrbVisualizer.tsx`), which attaches a Web Audio `AnalyserNode` (`fftSize = 64`, `smoothingTimeConstant = 0.78`) to the live `MediaStream` and cleans up `AudioContext` on unmount.
     - Handles abrupt tab closes via `pagehide` listener calling `abandonCallAttempt(attemptIdRef.current)` (`navigator`/`fetch(..., { keepalive: true })` to `/api/livekit/abandon`) and `disposeAudioElement`.
   - **Public Chat UI (`/chat/[contactId]`, `web/src/app/chat/[contactId]/ChatClient.tsx`, `POST /api/chat/[contactId]`)**:
     - Rate-limited (`20` reqs / `5m` per `contactId:ip`), capped at `700` chars, loads cross-channel history, runs `deterministicEscalation` (`web/src/app/api/chat/[contactId]/route.ts`) + `generateChatTurn` (`web/src/lib/ai/customer-chat.ts`), recalculates any model-requested estimate server-side via `calculateEstimate`, and persists `web_chat` messages.
4. **API Route Summary (`web/src/app/api/`)**:
   - `GET /api/health` — Checks PostgreSQL (`adminSql` `select 1`), LiveKit env, and `LIVEKIT_AGENT_NAME`; returns `200` (`status: 'ok'`) or `503` (`status: 'degraded'`).
   - `POST /api/auth/login` & `POST /api/auth/logout` — Session lifecycle.
   - `POST /api/livekit/token` — Server-owned LiveKit JWT minting + `call_logs` creation.
   - `POST /api/livekit/abandon` — Marks abandoned `'ringing'`/`'in_progress'` attempts as `'missed'`.
   - `GET /api/recordings/[callId]` — RLS-enforced (`withUser`) `.ogg` streaming (`audio/ogg`) with `206 Partial Content` byte-range scrubbing, `401` anonymous, `404` cross-tenant/missing, `410` missing disk file.
   - `POST /api/chat/[contactId]` — Public omnichannel web chat endpoint.

---

## 5. Cockpit Master Controller & Vision AI / Arena Telemetry Integration

The **Cockpit Master Controller** (`cockpit/server.js`) is a zero-dependency Node.js `http` daemon listening on `http://127.0.0.1:4000` (`http://localhost:4000`) that provides unified local orchestration, tool discovery, and an evaluation webhook for LM Arena / external agentic runs.

### 5.1 Cockpit Endpoints (`cockpit/server.js`)
| Method & Path | Purpose | Implementation Details |
|---|---|---|
| `GET /` (static `cockpit/public/`) | Control Dashboard UI | Serves `cockpit/public/index.html`, polling `/api/status` every `2000` ms and rendering service status pills, master switch, and registered tools |
| `GET /api/status` | Live Service Probe | Concurrently probes TCP ports `3000` (Web), `8081` (Worker + `pgrep -f "agent-worker/.venv/bin/python main.py start"`), `54330` (PostgreSQL), `11434` (Local Ollama AI), `5678` (n8n Automation Engine); sets `master: webRunning && workerRunning` |
| `POST /api/toggle` | Process Power Control | Accepts `{ "service": "master" \| "web" \| "worker", "action": "start" \| "stop" \| "toggle" }`; spawns detached `npm run start` (`web/`) or `.venv/bin/python main.py start` (`agent-worker/`), or stops via `lsof -ti :<port> \| xargs kill -9` and `pkill -9 -f` |
| `GET /api/tools` | Local Tool Registry | Returns `cockpit/tools_registry.json` |
| `POST /api/tools` | Register Local Tool | Appends `{ ...body, id: body.id \|\| "tool-<timestamp>" }` to `cockpit/tools_registry.json` |
| `POST /api/webhook/arena` | Arena / Sales Coaching Telemetry | Persists LM Arena / external agent evaluation & sales-coaching insights to `cockpit/arena_evals.json` (retaining the latest `50` entries) |
| `GET /api/webhook/arena` | Read Evaluation Log | Returns `cockpit/arena_evals.json` (`[]` if absent) |

### 5.2 Tools Registry & Vision Ecosystem (`cockpit/tools_registry.json`)
`cockpit/tools_registry.json` connects `nordic-omni` alongside the operator's local AI and personal productivity stack:
- `nordic-omni` (`category: "business"`, ports `[3000, 8081]`): Multi-tenant Danish AI telephony receptionist, estimation engine, and CRM portal (`/Users/gaganrajput11/the final form`).
- `vision-process` (`category: "personal_vision"`): Personal life vision, daily operating protocols, focus warden blocklist, and accountability (`/Users/gaganrajput11/.vision`, containing `/Users/gaganrajput11/.vision/warden-blocklist.json`).
- `n8n-automations` (`category: "automation"`, port `[5678]`): Local workflow automation pipelines, webhook handlers, and background tasks (`/Users/gaganrajput11/.n8n`).
- `obsidian-notes` (`category: "knowledge"`): Markdown notes, personal life journals, knowledge base, and project roadmaps (`/Users/gaganrajput11/Documents`).
- `ollama-local-ai` (`category: "privacy_ai"`, port `[11434]`): Air-gapped offline local neural models on Apple Silicon (`/Users/gaganrajput11/.ollama`).

### 5.3 Vision AI Sales Coach & LM Arena Webhook Contract (`/api/webhook/arena`)
In `cockpit/server.js`, `POST /api/webhook/arena` serves as the telemetry bridge for receiving AI evaluations and sales-coaching insights from LM Arena Agentic Mode or external agents.

**Accepted Request JSON (`POST http://localhost:4000/api/webhook/arena`):**
```json
{
  "model": "frontier-agent",
  "category": "sales-coding",
  "score": 9.5,
  "verdict": "PASS: Concise verdict summary",
  "experience": "Observed architectural or sales-coaching experience notes",
  "snippet": "Relevant diff or code snippet"
}
```
**Stored Record Schema (`cockpit/arena_evals.json`):**
```json
{
  "id": "eval-<epoch_ms>",
  "timestamp": "<ISO-8601>",
  "model": "frontier-agent",
  "category": "sales-coding",
  "benchmarkScore": 9.5,
  "verdict": "...",
  "codeExperience": "...",
  "diffOrSnippet": "...",
  "source": "LM Arena Agentic Mode"
}
```
Recorded entries in `cockpit/arena_evals.json` currently include `sales-engine` (`gemini-4-argon-high`, score `9.8`) and `nordic-omni-concurrency-and-voice-audit` (`Arena.ai Agent Mode`, score `8.9`, documenting `CallSlotRegistry`, `SafeAzureTTS` 4-socket cap, `asyncio.Lock` teardown, and monotonic state transitions).

*(Note: `cockpit/server.js` contains the `/api/webhook/arena` `POST` and `GET` handlers at lines 206–253 and a duplicate block at lines 305–352; the first block handles and terminates matching requests.)*

---

## 6. Complete Local Setup, Deployment & Verification Commands

### 6.1 Database Setup & Client #1 Provisioning
Start native PostgreSQL 17 on port `54330` (macOS Postgres.app example from `READMEFIRST.md`):
```bash
~/Applications/Postgres.app/Contents/Versions/17/bin/pg_ctl \
  -D ~/.nordic-omni-pgdata \
  -o "-p 54330 -k /tmp -c listen_addresses=127.0.0.1" \
  -l /tmp/omni-pg.log start
```
Create the database and apply all 11 migrations in order:
```bash
BIN=~/Applications/Postgres.app/Contents/Versions/17/bin
$BIN/psql -h 127.0.0.1 -p 54330 -U postgres -c 'CREATE DATABASE nordic_omni;'
for file in db/migrations/*.sql; do
  echo "Applying $file"
  $BIN/psql -h 127.0.0.1 -p 54330 -U postgres -d nordic_omni -v ON_ERROR_STOP=1 -f "$file" || exit 1
done
```
Validate and idempotently apply Client #1 (`Dansk Byg & Renovering ApS`) config:
```bash
cd agent-worker
.venv/bin/python scripts/apply_client_config.py ../clients/client-01-dansk-byg/client.config.json --validate-only
.venv/bin/python scripts/apply_client_config.py ../clients/client-01-dansk-byg/client.config.json
```
When a FlyNumber Danish DID is assigned, preview and provision the LiveKit SIP inbound trunk + dispatch rule:
```bash
cd agent-worker
.venv/bin/python scripts/setup_livekit_sip.py --config ../clients/client-01-dansk-byg/client.config.json --did '+45XXXXXXXX' --dry-run
.venv/bin/python scripts/setup_livekit_sip.py --config ../clients/client-01-dansk-byg/client.config.json --did '+45XXXXXXXX'
```

### 6.2 Environment Files & Demo Credentials
- **Web (`web/.env.local` from `web/.env.example`)**: Requires `DATABASE_URL` (`omni_app` role), `DATABASE_ADMIN_URL` (owner role), `SESSION_SECRET` (64 hex chars via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_AGENT_NAME=nordic-omni`. Optional: `N8N_ESCALATION_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `DEEPSEEK_API_KEY`, `META_VERIFY_TOKEN`, `META_APP_SECRET`.
- **Worker (`agent-worker/.env` from `agent-worker/.env.example`, `chmod 600`)**: Requires `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_AGENT_NAME=nordic-omni`, `DATABASE_URL`. For Client #1 Azure Christel: `TTS_VOICE=azure:da-DK-ChristelNeural`, `AZURE_SPEECH_KEY=...`, `AZURE_SPEECH_REGION=swedencentral`, `MAX_CONCURRENT_CALLS=1` (on 8 GB hosts).
- **Demo Accounts (password `demo1234`)**:
  - Agency Admin (`/agency`): `agency@nordic-omni.local`
  - Client #1 Owner (`/portal`): `morten@danskbyg.dk` (`dansk-byg`, updated from `jens@kbhvvs.dk` in migration `0006`)
  - Legacy Pilot Owner (`/portal`): `mette@nordicdental.dk` (`nordic-dental`)
  - Public Call Link: `http://localhost:3000/call/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa`
  - Public Chat Link: `http://localhost:3000/chat/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa`

### 6.3 Running Local & Production Services
- **Python Worker Environment (Python 3.12 via `uv`)**:
  ```bash
  cd agent-worker
  uv venv --python 3.12
  uv pip install -r requirements.txt
  .venv/bin/python main.py dev     # development
  .venv/bin/python main.py start   # production (required by Cockpit pgrep check)
  ```
- **Next.js Web App**:
  ```bash
  cd web && npm ci && npm run dev    # development (http://localhost:3000)
  cd web && npm run build && npm start # production
  ```
- **Cockpit Master Controller**:
  ```bash
  node cockpit/server.js             # http://localhost:4000
  ```
- **Linux Production systemd Units (`deploy/`)**:
  ```bash
  sudo cp deploy/nordic-omni-web.service deploy/nordic-omni-worker.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now nordic-omni-web nordic-omni-worker
  curl -fsS http://127.0.0.1:3000/api/health
  ```

### 6.4 Verification Commands & Observed Results
Run the core automated verification suite from `/Users/gaganrajput11/the final form`:

```bash
# 1. TypeScript typecheck (web)
(cd web && npx tsc --noEmit)

# 2. Root & Web contract test suites (package.json runs both test/*.test.ts and web/test/*.test.ts)
npm test

# 3. Python worker unit & smoke tests (no network/DB required)
(cd agent-worker && .venv/bin/python -m unittest discover -s tests)
```

**Directly Observed Passing Output (verified on current working tree):**
- `(cd web && npx tsc --noEmit)`: Exited `0` (0 type errors).
- `npm test`:
  - Root `test/*.test.ts` (`call_ui_contract.test.ts`, `dashboard_contract.test.ts`, `livekit_policy.test.ts`): **13 passed, 0 failed**.
  - Web `web/test/*.test.ts` (`ai-contract.test.ts`, `contracts.test.ts`): **9 passed, 0 failed** (total **22 passed**).
- `(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`:
  - Executed `test_agent_smoke.py` (`ALL WORKER SMOKE CHECKS PASSED`) plus `unittest` discovery: **40 tests discovered — 35 passed, 5 skipped** (the 5 skipped tests are opt-in DB/network integration suites gated on `RUN_DB_TESTS=1` or live API credentials).

**Full Release Gate & Opt-In DB/Live Probes (from `DEPLOYMENT.md` & `READMEFIRST.md`):**
```bash
# Full web production build + audit
cd web && npm ci && npm run build && npx tsc --noEmit && npm audit

# Python suite with live PostgreSQL integration tests (requires Postgres running on 54330)
cd agent-worker && RUN_DB_TESTS=1 .venv/bin/python -B -m unittest discover -s tests -p 'test_*.py'

# Standalone worker smoke & live inference checks
cd agent-worker && .venv/bin/python tests/test_agent_smoke.py
cd agent-worker && .venv/bin/python tests/test_inference.py

# PostgreSQL RLS & constraint SQL probes
psql -h 127.0.0.1 -p 54330 -U omni_app -d nordic_omni -f db/tests/rls_probe.sql
psql -h 127.0.0.1 -p 54330 -U omni_app -d nordic_omni -f db/tests/create_probe.sql
psql -h 127.0.0.1 -p 54330 -U omni_app -d nordic_omni -f db/tests/stage_enum_probe.sql
```
