# LM Arena Agentic Prompts — `nordic-omni` (`main`)

Target repository: `gagandeepsinghrajput575-cloud/nordic-omni` (`main` branch)  
Cockpit telemetry endpoint: `POST http://localhost:4000/api/webhook/arena`

Each prompt below is packaged as a single self-contained copyable block following cross-boundary architecture, strict invariants, real codebase symbols, and deterministic test/webhook output requirements.

---

## Prompt 1: Inbound/Outbound LiveKit SIP Routing & Audio Recording Pipeline Hardening

````markdown
### Target Repository & Branch
- Repository: `gagandeepsinghrajput575-cloud/nordic-omni` (`main`)

### Architecture & Cross-Boundary Context
Multi-tenant Danish/English AI voice receptionist spanning four boundaries:
1. **LiveKit SIP Provisioning (`agent-worker/scripts/setup_livekit_sip.py`, `agent-worker/services/phone.py`)**: Provisions `SIPInboundTrunkInfo` and `SIPDispatchRuleInfo` (`SIPDispatchRuleIndividual` with `RoomAgentDispatch(agent_name=LIVEKIT_AGENT_NAME)` and `{"tenant_id": ...}` room metadata) via `livekit.api.LiveKitAPI`.
2. **Voice Worker Runtime (`agent-worker/main.py`, `agent-worker/services/recordings.py`, `agent-worker/services/db.py`)**: Resolves tenant identity from signed web token metadata (`tenant_id`) or dialled PSTN trunk number (`sip.trunkPhoneNumber` -> `Database.get_tenant_by_did`), resolves/creates caller contacts (`Database.get_or_create_inbound_contact`), runs `AgentSession.start(..., record=record_opts)`, and under a single `asyncio.Lock` shutdown handler (`on_shutdown`) calls `close_agent_session(session)` -> `finalise_call(...)` (which invokes `preserve()` in `asyncio.to_thread` and `Database.set_recording(...)`) -> `close_db()` -> `release_call_slot(job_id)`.
3. **PostgreSQL Migrations (`db/migrations/0004_call_recording.sql`, `db/migrations/0008_sip_inbound_routing.sql`, `db/migrations/0009_unique_contact_phone.sql`)**: Enforces normalized unique DID routing index `idx_tenants_flynumber_did_normalized`, normalized per-tenant contact uniqueness `idx_contacts_tenant_phone_normalized`, `tenants.record_calls`, and `call_logs` recording audit columns (`recording_bytes`, `recording_path`, `recording_error`, `recording_status` checked against `'ok' | 'failed' | 'skipped'`).
4. **Next.js Audio Streaming API (`web/src/app/api/recordings/[callId]/route.ts`)**: Enforces session auth (`apiSession()`) + PostgreSQL RLS (`withUser(session.userId, ...)`), validates UUIDs, checks `recording_status === 'ok'`, verifies `statSync(row.recording_path)`, and serves `audio/ogg` with RFC 9110 byte-range (`206 Partial Content` / `416 Range Not Satisfiable`) and `Cache-Control: private, no-store`.

### Active File Tree & Interface Contracts
- `agent-worker/scripts/setup_livekit_sip.py`: `livekit_http_url()`, `provision()`, `main()`
- `agent-worker/services/phone.py`: `normalize_phone(value: str | None) -> str | None`
- `agent-worker/main.py`: `read_metadata()`, `close_agent_session()`, `finalise_call()`, `entrypoint()`
- `agent-worker/services/recordings.py`: `MIN_VALID_BYTES = 2048`, `WAIT_ATTEMPTS = 10`, `WAIT_SECONDS = 0.5`, `recordings_root()`, `_wait_for()`, `_safe_component()`, `preserve()`, `history_to_turns()`, `duration_seconds()`
- `agent-worker/services/db.py`: `Database.get_tenant_by_did()`, `Database.get_or_create_inbound_contact()`, `Database.ensure_call_log()`, `Database.finalise_call()`, `Database.set_recording()`
- `web/src/app/api/recordings/[callId]/route.ts`: `GET(request, { params })`
- `db/migrations/0004_call_recording.sql`, `db/migrations/0008_sip_inbound_routing.sql`, `db/migrations/0009_unique_contact_phone.sql`

### Objective & Deep Concurrency / Security Audit Scope
Audit and harden the end-to-end SIP ingress and local recording persistence/playback pipeline across all four boundaries:
1. **Fail-Closed Tenant & Role Isolation**: Verify in `read_metadata()` and `entrypoint()` (`agent-worker/main.py`) that inbound PSTN SIP calls (`sip.callID` or `sip.trunkPhoneNumber`) can NEVER assume privileged roles (`owner`, `owner_consult`, `owner_merged`) even if crafted room/participant metadata is injected, and that unresolved DIDs or inactive tenants fail closed without falling back to a default tenant.
2. **SIP Trunk & Dispatch Rule Idempotency**: Audit `setup_livekit_sip.py` for stale trunk/rule mismatch when a DID already exists on a trunk whose `metadata` or `room_config` changed, and verify `normalize_phone()` parity between Python (`services/phone.py`) and PostgreSQL `regexp_replace(..., '[^0-9+]', '', 'g')` in `0008_sip_inbound_routing.sql` and `0009_unique_contact_phone.sql` (including `00`-prefixed European numbers vs `+` E.164).
3. **Recording Durability & Shutdown Ordering**: Audit `preserve()` (`services/recordings.py`) and `finalise_call()` (`main.py`) for partial file reads while `AgentSession` flushes `audio.ogg` (`_wait_for()` checks `st_size > 0` immediately without checking write quiescence or atomic copy), path traversal safety in `_safe_component()`, and `recording_status` state integrity when `should_record` is `False` vs when `preserve()` raises.
4. **Next.js Range Streaming & Path/Stream Safety**: Audit `web/src/app/api/recordings/[callId]/route.ts` for open file descriptor leaks if client aborts mid-stream, `row.recording_path` canonicalization against `RECORDINGS_DIR` / expected base directory, suffix/multi-range header edge cases (`bytes=0-0`, `bytes=-500`, `bytes=99999999-`), and consistent `404` non-disclosure across missing/unauthorized/unrecorded rows.

### Non-Negotiable Acceptance & Sandbox Constraints
1. Preserve strict fail-closed multi-tenant isolation: zero fallback tenant selection, zero SIP role elevation, zero existence leakage on `/api/recordings/[callId]`.
2. Preserve all existing `call_logs.recording_status` SQL `CHECK` constraints (`NULL`, `'ok'`, `'failed'`, `'skipped'`) and `MIN_VALID_BYTES` (2048) floor.
3. Maintain full TypeScript strictness (`tsc --noEmit` exits 0 with no `any` escapes) and clean Python typing.
4. Any fixes must be accompanied by unit/regression tests covering the identified edge cases without breaking existing tests.
5. Run all verification commands after final edits:
   - `(cd web && npx tsc --noEmit)`
   - `npm test`
   - `(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`
   - `(cd agent-worker && .venv/bin/pytest)` (if `pytest` is installed in `.venv`, otherwise report `unittest` output accurately)

### Required Final Output: Cockpit Arena Evaluation Payload
Conclude your final response with the exact JSON payload formatted for `POST http://localhost:4000/api/webhook/arena` (and if `http://localhost:4000` is reachable in your environment, submit it via `curl` and confirm the HTTP response; otherwise output the exact ready-to-POST JSON object):

```json
{
  "model": "<evaluated-agent-id>",
  "category": "sip-routing-and-recording-hardening",
  "score": 0.0,
  "verdict": "<concise PASS/FAIL summary with exact observed findings>",
  "experience": "<exact files modified, invariants verified, and observed command results (tsc, npm test, unittest/pytest counts)>",
  "snippet": "<key hardened diff or regression test snippet>"
}
```
````

---

## Prompt 2: Danish Construction Estimation Engine, DB RLS Security & Migration Parity Audit

````markdown
### Target Repository & Branch
- Repository: `gagandeepsinghrajput575-cloud/nordic-omni` (`main`)

### Architecture & Cross-Boundary Context
Multi-tenant Danish construction lead qualification and estimation architecture spanning Python runtime, TypeScript contracts, and PostgreSQL RLS:
1. **Dual-Runtime Estimation Calculators (`agent-worker/agents/estimation.py`, `web/src/lib/estimation.ts`, `web/src/contracts/schemas.ts`)**: Deterministic catalog-grounded pricing (`calculate_estimate` in Python, `calculateEstimate` in TypeScript) designed to keep price arithmetic outside the LLM. Supports `fixed` and `per_square_meter` models using explicit `estimate_min_dkk` / `estimate_max_dkk` fields or legacy regex parsing of Danish `unit` strings (`typisk 95.000 - 165.000 kr.`), bounded by `0 < square_meters <= 100_000`, validated against `PricingItemSchema` (`web/src/contracts/schemas.ts`).
2. **PostgreSQL Dual-Pool RLS Architecture (`web/src/lib/db/client.ts`, `agent-worker/services/db.py`)**:
   - `sql` (`omni_app` non-owner role) wrapped by `withUser(userId, fn)` executing `SELECT set_config('app.user_id', $1, true)` per transaction; passing `null` yields empty RLS results.
   - `adminSql` (owner role bypassing RLS) restricted strictly to webhooks, login lookup, and server-minted call initiation.
   - Worker `Database` (`asyncpg.Pool`) executing parameterized tenant-scoped queries with monotonic state guards on `call_logs.status`.
3. **Migration & RLS Schema Parity (`db/migrations/0001_baseline.sql` through `0011_escalation_resolution.sql`)**:
   - `0007_estimates_and_inspections.sql`: Creates `project_estimates` and `inspection_requests` with `ENABLE ROW LEVEL SECURITY` and `SELECT`-only policies (`project_estimates_read`, `inspection_requests_read`), intentionally omitting client `INSERT` policies so only the trusted worker inserts voice-derived estimates/inspections, and backfills `pricing_catalog` JSONB metadata (`proj-bath`, `proj-kitchen`, `proj-extension`, `proj-roof`).
   - `0008_sip_inbound_routing.sql`, `0009_unique_contact_phone.sql`, `0010_ai_brain_chat_escalation.sql`, `0011_escalation_resolution.sql`.

### Active File Tree & Interface Contracts
- `agent-worker/agents/estimation.py`: `EstimateError`, `Estimate`, `calculate_estimate()`, `_number()`, `_legacy_bracket()`
- `web/src/lib/estimation.ts`: `CatalogItem`, `Estimate`, `EstimateError`, `calculateEstimate()`, `positiveNumber()`, `legacyBracket()`
- `web/src/contracts/schemas.ts`: `EstimateModelSchema`, `PricingItemSchema`, `CallStatusSchema`, `PipelineStageSchema`, `ChannelSchema`, `UICommandTypeSchema`
- `web/src/lib/db/client.ts`: `sql`, `adminSql`, `Tx`, `withUser()`, `pingDatabase()`
- `agent-worker/services/db.py`: `Database.get_contact()`, `Database.update_contact_stage()`, `Database.record_project_estimate()`, `Database.request_inspection()`, `Database.ensure_call_log()`, `Database.update_call_status()`, `Database.finalise_call()`
- `db/migrations/0001_baseline.sql` .. `db/migrations/0011_escalation_resolution.sql`
- Existing test suites: `agent-worker/tests/test_estimation.py`, `agent-worker/tests/test_estimation_db_integration.py`, `agent-worker/tests/test_danish_estimation_dialogue.py`, `agent-worker/tests/test_db_security.py`

### Objective & Deep Concurrency / Security Audit Scope
Perform a cross-language parity, SQL constraint, and RLS boundary audit across the estimation engine and database layer:
1. **Python / TypeScript Estimation Parity**: Verify exact behavioral equivalence between `agent-worker/agents/estimation.py::calculate_estimate` and `web/src/lib/estimation.ts::calculateEstimate` plus `PricingItemSchema` (`web/src/contracts/schemas.ts`). Check edge cases:
   - `NaN`, `Infinity`, boolean inputs (`True`/`False` in Python `float(True) == 1.0`, `Number(true) === 1` in JS!), empty strings, `0`, negative numbers, and `square_meters > 100_000`.
   - `square_meters` provided when `model == "fixed"` (currently stored or ignored differently? Verify consistency with DB `CHECK (square_meters IS NULL OR square_meters > 0)`).
   - Danish thousand-separator vs decimal parsing in `_legacy_bracket()` / `legacyBracket()` (e.g., `18.000 - 26.000`, `1.250,50`, multiple dots).
   - Half-to-even (`round()` in Python) vs half-up (`Math.round()` in JS) midpoint rounding parity (`midpoint` when `(low + high) / 2` ends in `.5`).
2. **PostgreSQL RLS & Role Privilege Audit**: Audit all migrations `0001`–`0011` and `web/src/lib/db/client.ts` to verify:
   - Every tenant-scoped table has `ENABLE ROW LEVEL SECURITY` and complete policy coverage (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) matching `omni_app` access paths.
   - Zero `adminSql` leakage into user-initiated read/write endpoints.
   - `Database` methods in `agent-worker/services/db.py` enforce `tenant_id` predicates on every query, preserve monotonic terminal states (`status NOT IN ('completed', 'missed')`), and match column/constraint definitions in `0007_estimates_and_inspections.sql` and `0010_ai_brain_chat_escalation.sql` (`conversation_escalations`, `knowledge_sources`, `knowledge_bundles`).
3. **Migration Parity & Ordering**: Verify sequential SQL migrations `0001`–`0011` contain no conflicting index names, enum alterations inside explicit `BEGIN`/`COMMIT` blocks (`ALTER TYPE ... ADD VALUE`), or schema drift against `web/src/contracts/schemas.ts`.

### Non-Negotiable Acceptance & Sandbox Constraints
1. Python `calculate_estimate`, TypeScript `calculateEstimate`, and Zod `PricingItemSchema` must agree on every valid/invalid input boundary, rejecting booleans and non-finite scalars fail-closed.
2. Zero RLS bypasses or missing `tenant_id` scoping predicates in `agent-worker/services/db.py` or `web/src/lib/db/`.
3. Zero TypeScript compilation errors (`tsc --noEmit`) and all Python & Node test suites must pass with newly added parity/boundary regression tests.
4. Run all verification commands after final edits:
   - `(cd web && npx tsc --noEmit)`
   - `npm test`
   - `(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`
   - `(cd agent-worker && .venv/bin/pytest)` (if `pytest` is installed in `.venv`, otherwise report `unittest` output accurately)

### Required Final Output: Cockpit Arena Evaluation Payload
Conclude your final response with the exact JSON payload formatted for `POST http://localhost:4000/api/webhook/arena` (and if `http://localhost:4000` is reachable in your environment, submit it via `curl` and confirm the HTTP response; otherwise output the exact ready-to-POST JSON object):

```json
{
  "model": "<evaluated-agent-id>",
  "category": "estimation-parity-and-rls-audit",
  "score": 0.0,
  "verdict": "<concise PASS/FAIL summary with exact observed findings>",
  "experience": "<exact files modified, parity/RLS invariants verified, and observed command results (tsc, npm test, unittest/pytest counts)>",
  "snippet": "<key hardened diff or cross-runtime parity test snippet>"
}
```
````

---

## Prompt 3: Next.js WebRTC Call UI, Real-Time Audio Visualizer & Cockpit Arena Webhook Telemetry Bridge

````markdown
### Target Repository & Branch
- Repository: `gagandeepsinghrajput575-cloud/nordic-omni` (`main`)

### Architecture & Cross-Boundary Context
Real-time browser WebRTC call lifecycle and local operational control plane spanning three subsystems:
1. **Next.js WebRTC Call Client (`web/src/app/call/[contactId]/CallClientView.tsx`, `web/src/lib/livekit/attempt.ts`)**: Drives `CallStage` (`'idle' | 'connecting' | 'waiting_for_agent' | 'active' | 'ended' | 'error'`), fetches scoped LiveKit JWTs from `/api/livekit/token`, races `RoomEvent.TrackSubscribed` (remote audio attachment + `MediaStream` extraction) against `AGENT_TIMEOUT_MS = 30_000`, handles browser audio unlock (`room.startAudio()`, `audioElement.play()`), prevents double-start (`startInFlightRef`), cleans up detached `<audio>` elements (`disposeAudioElement`), and reports pre-agent failures via `abandonCallAttempt()` (`POST /api/livekit/abandon` with `keepalive: true` on `pagehide`, unmount, or error).
2. **Server Token & Access Policy (`web/src/app/api/livekit/token/route.ts`, `web/src/app/api/livekit/abandon/route.ts`, `web/src/lib/livekit/policy.ts`)**: Enforces `resolveLiveKitAccess()`, per-process `FixedWindowRateLimiter`, server-owned `buildRoomName()` / `buildParticipantIdentity()`, pre-creates `call_logs` row (`status = 'ringing'`), and dispatches `RoomConfiguration` (`agentName: LIVEKIT_AGENT_NAME`).
3. **Web Audio Canvas Visualizer (`web/src/components/audio/OrbVisualizer.tsx`)**: Drives a DPR-aware `<canvas>` loop (`33ms` frame pacing, `prefers-reduced-motion` static fallback, theme CSS variable resolution `--accent-primary`, `--accent-secondary`, `--danger`, `--warning`, `--text-muted`, `--line`) backed by `AudioContext` + `AnalyserNode` (`fftSize = 64`, `smoothingTimeConstant = 0.78`) with `statechange`/`visibilitychange` resume hooks and teardown on `audioStream` change or unmount.
4. **Cockpit Master Controller & Telemetry Bridge (`cockpit/server.js`, `cockpit/arena_evals.json`, `cockpit/tools_registry.json`, `cockpit/public/index.html`)**: Zero-dependency Node HTTP daemon on `127.0.0.1:4000` probing ports `3000`, `8081`, `54330`, `11434`, `5678`, managing `web` and `worker` processes via `/api/status` and `/api/toggle`, and persisting LM Arena evaluation payloads (`model`, `category`, `score`, `verdict`, `experience`, `snippet`) via `POST /api/webhook/arena` and `GET /api/webhook/arena` into `cockpit/arena_evals.json` (capped at 50 entries).

### Active File Tree & Interface Contracts
- `web/src/app/call/[contactId]/CallClientView.tsx`: `CallClientView`, `CallStage`, `AGENT_TIMEOUT_MS`, `handleStartCall`, `handleEndCall`, `cleanupCall`, `toggleMute`
- `web/src/components/audio/OrbVisualizer.tsx`: `OrbVisualizer`, `OrbVisualizerProps`, `VisualizerState` (`'idle' | 'speaking' | 'listening' | 'dire_hold' | 'consulting'`)
- `web/src/lib/livekit/attempt.ts`: `abandonCallAttempt()`, `disposeAudioElement()`
- `web/src/lib/livekit/policy.ts`: `LiveKitRole`, `LIVEKIT_AGENT_NAME`, `resolveLiveKitAccess()`, `buildRoomName()`, `buildParticipantIdentity()`, `FixedWindowRateLimiter`
- `web/src/app/api/livekit/token/route.ts` & `web/src/app/api/livekit/abandon/route.ts`
- `cockpit/server.js`, `cockpit/arena_evals.json`, `cockpit/tools_registry.json`

### Objective & Deep Concurrency / Lifecycle Audit Scope
Audit and harden the browser WebRTC state machine, Web Audio teardown, and Cockpit HTTP controller:
1. **CallClientView Lifecycle & Race Conditions (`CallClientView.tsx`, `attempt.ts`)**:
   - Inspect `handleStartCall()` line `if (!agentStream) setStage('waiting_for_agent')`: `agentStream` is captured in closure at call start (stale closure!), and `TrackSubscribed` may fire before `room.startAudio()` resolves; verify deterministic stage transitions (`connecting` -> `waiting_for_agent` -> `active`) and ensure `TrackUnsubscribed` does not null out `agentStream` if another remote audio track remains active, nor leave stale `Audio` elements or timers on rapid `handleStartCall` -> `unmount` -> remount.
   - Verify `attemptIdRef.current` cannot trigger duplicate `abandonCallAttempt()` calls (e.g., `catch` block + `onPageHide` unmount cleanup both firing for the same `attemptId`, or calling `abandon` after `handleEndCall` once `reachedAgentRef` resets to `false` inside `cleanupCall()`).
   - Verify `toggleMute()` handles `NotAllowedError` / disconnected local track states without leaving `isMuted` desynced from `room.localParticipant.isMicrophoneEnabled`.
2. **OrbVisualizer AudioContext & Memory Hygiene (`OrbVisualizer.tsx`)**:
   - Verify cleanup when `audioStream` transitions rapidly or `AudioContext` creation throws/suspends under autoplay policies, ensuring `requestAnimationFrame` is cancelled, `AnalyserNode`/`MediaStreamAudioSourceNode` are disconnected, `document.removeEventListener('visibilitychange', resume)` always runs, and `window.matchMedia('(prefers-reduced-motion: reduce)')` changes are respected without memory leaks.
3. **Cockpit Server & Arena Webhook Hardening (`cockpit/server.js`)**:
   - Resolve the duplicate `/api/webhook/arena` `POST` and `GET` route handlers currently defined twice in `cockpit/server.js`, enforce request body size limits (`413 Payload Too Large` on oversized bodies instead of unbounded `body += chunk`), validate `POST /api/webhook/arena` JSON shape (`model`, `category`, `score`, `verdict`, `experience`, `snippet`), guard against directory traversal on static file serving (`PUBLIC_DIR` prefix check after `path.resolve`), and verify `getSystemStatus()` / `POST /api/toggle` process detection and atomic JSON writes to `arena_evals.json` and `tools_registry.json`.

### Non-Negotiable Acceptance & Sandbox Constraints
1. Zero stale-closure stage regressions, zero leaked `AudioContext` / `HTMLAudioElement` / `requestAnimationFrame` handles, and idempotent `abandonCallAttempt` semantics (never mark a `completed` call as `missed` and never double-fire on unmount after `active`).
2. `cockpit/server.js` must remain zero-dependency Node.js (`http`, `fs`, `path`, `child_process`, `net`), reject path traversal outside `PUBLIC_DIR`, cap request body sizes, deduplicate `/api/webhook/arena`, and preserve the exact `arena_evals.json` entry schema.
3. Full TypeScript safety (`(cd web && npx tsc --noEmit)` exits 0) and zero regressions across all test suites, plus targeted unit tests for `OrbVisualizer`/call attempt lifecycle and `cockpit/server.js` webhook & security guards.
4. Run all verification commands after final edits:
   - `(cd web && npx tsc --noEmit)`
   - `npm test`
   - `(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`
   - `(cd agent-worker && .venv/bin/pytest)` (if `pytest` is installed in `.venv`, otherwise report `unittest` output accurately)

### Required Final Output: Cockpit Arena Evaluation Payload
Conclude your final response with the exact JSON payload formatted for `POST http://localhost:4000/api/webhook/arena` (and if `http://localhost:4000` is reachable in your environment, submit it via `curl` and confirm the HTTP response; otherwise output the exact ready-to-POST JSON object):

```json
{
  "model": "<evaluated-agent-id>",
  "category": "webrtc-ui-visualizer-and-cockpit-bridge",
  "score": 0.0,
  "verdict": "<concise PASS/FAIL summary with exact observed findings>",
  "experience": "<exact files modified, lifecycle/webhook invariants verified, and observed command results (tsc, npm test, unittest/pytest counts)>",
  "snippet": "<key hardened diff or regression test snippet>"
}
```
````
