# NORDIC-OMNI repair ledger

Approved plan execution began after the read-only audit. Existing uncommitted changes are preserved; no reset, commit, push, or destructive database test is part of this work.

## Rulings

- External SMS, calendar, and owner-phone delivery will fail honestly until a real delivery acknowledgement exists. The repair adds persistent inspection requests rather than fabricating bookings.
- Existing pricing catalog display strings remain supported while structured estimate fields are introduced, so already-applied Client #1 data keeps working.
- Browser-supplied room names and identities are ignored for compatibility; the server derives them. Anonymous owner-role requests are rejected.

## Release-hardening pass (11 November)

- **Azure/Christel verified live.** First attempt exposed
  `RuntimeError: Plugins must be registered on the main thread` from lazy-importing
  Azure inside the thread executor. Provider imports moved to worker startup and a
  contract test now prevents regression.
- **Azure 400 fixed.** The plugin interpolates text into SSML; `Dansk Byg &`
  produced malformed XML. `agents/azure_tts.py` escapes `&`, `<`, `>` before
  synthesis. A real provider probe synthesized 26 frames with the ampersand text.
- **Live call check 4:** `Using Microsoft Azure TTS voice: da-DK-ChristelNeural`,
  one-turn Danish greeting, `status=completed`, 16 seconds, `recording_status=ok`,
  132,165-byte Ogg. The transcript preserves “Dansk Byg & Renovering”.
- **Dispatch pinned by name.** Stale unnamed workers repeatedly joined rooms
  without accepting the job. Web tokens now request `nordic-omni`, the worker
  registers with `agent_name=nordic-omni`, and SIP dispatch uses the same name.
  Live call check 4 answered immediately after this change.
- **Inbound SIP implemented.** Exact DID → active tenant lookup, inbound contact
  creation/reuse, `voice_inbound` channel, no first-tenant fallback. Real
  PostgreSQL test passes. `0008_sip_inbound_routing.sql` adds the normalized DID
  uniqueness constraint and removes Client #1’s obsolete VVS demo DID; `0009`
  makes tenant phone identity unique and the insert is conflict-safe.
- **Web Audio hardened.** `AudioContext.resume()` plus state/visibility retry in
  both analyser hooks; analyser sources disconnected on teardown; orb resolution
  follows DPR, colours follow theme, reduced motion renders a still frame, and a
  missing analyser no longer invents speech energy.
- **Premium UI pass.** Aurora blobs, glass blur, gradient CTAs, gradient KPIs and
  decorative emoji were removed. Primary actions are inverted flat surfaces;
  metrics are 2×2 on mobile; the public call page is a split-screen console and
  puts its call button in the first 390 px viewport; old call logs collapse after
  the latest three.
- **Dependency security.** Next 15.5.29, Zod 4.6.7, unused OpenAI client removed,
  PostCSS pinned. `npm audit` reports **0 vulnerabilities**.
- **Thread-executor database crash fixed.** The second browser call crashed with
  `Future attached to a different loop` / `another operation is in progress`
  because one asyncpg pool was shared across job loops. The pool is now scoped to
  the worker thread + event loop and closed after finalisation. Two consecutive
  browser attempts then ran without a pool crash; the verified completed call
  produced a 117 KB recording.
- **Browser UI verified.** Headless Chrome with a fake microphone reached
  `Forbundet` in 2–3 seconds, kept `AudioContext.state='running'`, showed one
  agent audio element, ended cleanly, and closed every observed audio context on
  hang-up. Recording ranged streaming now returns `206` with `Content-Range`.
- **Production build:** 24 routes, exit 0. `/api/health` reports database, LiveKit,
  and agent checks as true; security headers are present.
- **AI Brain Ingestion & Knowledge Approval:** Secure crawler (SSRF-protected, 450 KB limit)
  and LiveKit Inference compiler extract business facts without inventing data. Agency review
  panel supports one-click approval, promoting 24 structured items to active client knowledge
  and merging escalation triggers.
- **Shared Memory & Customer Chat:** Web chat (`/chat/[contactId]`) shares contact memory,
  estimate state, and message history with voice agents. Renders older voice turns labeled "Telefon".
  Strict Danish guardrails enforce 1-3 sentences, catalog-grounded non-binding estimates, and
  unconfirmed inspection requests.
- **Escalation Engine & N8N Webhooks:** Triggers (`high_value_emergency`, `angry_customer`,
  `human_requested`) record to `conversation_escalations` and deliver via HMAC-signed webhooks.
  The portal displays open escalations with "Kun registreret" when N8N is unconfigured, and
  provides a verified resolve action.
- **Full Test Suite:** 33 Python tests (worker architecture, tool registration, prompt Danish rules,
  regression smoke) and 18 TypeScript contract tests pass cleanly.


- RED suite added for LiveKit authorization/attempt identity, deterministic
  estimation, config parsing, transcript filtering, recording shutdown, exact
  greeting, and honest browser state.
- Security policy suite: 6/6. Browser/dashboard contract suite: 5/5. Worker
  discovery suite: 22 tests, all passing with 3 opt-in DB tests skipped. Three
  opt-in real-PostgreSQL tests pass: recording metadata, estimate history, and
  inspection-request persistence.
- Live HTTP checks: anonymous owner role → 403; cross-tenant contact → 403;
  malformed/unknown call state cannot be converted to an active UI.
- Live call check 1 (headless Chrome): reached agent-audio state, then exposed
  `AmbiguousParameterError` in recording metadata. The 1.1 MB Ogg existed, so
  this was a metadata write failure, not an audio failure.
- Live call check 2 (Python LiveKit WebRTC, after fix): agent joined, Danish
  audio track subscribed, caller disconnected, and the call self-finalized to
  `completed` with a transcript, `recording_status=ok`, and an 89,789-byte Ogg.
- Authenticated playback: `200 audio/ogg`, byte count matched the stored file.
- Production build passed after removing a stale generated `.next` cache: all 17
  app/API routes compiled, including the call page, dashboard, recording stream,
  token issuance, and call-abandon endpoint.
- Live call check 3 (final bounded worker): agent joined, audio subscribed,
  disconnected, and self-finalized to `completed` with a 104,814-byte recording;
  authenticated playback returned `200 audio/ogg` with the identical byte count.
- The synthetic probes were removed. One verified pilot call was retained as the
  sole new call record in the pilot workspace.

## Findings fixed

| Finding | Fix |
|---|---|
| Anonymous `owner_consult` could reach owner tools | Role policy; owner requires authenticated owner/agency membership |
| Contact ID was trusted without its tenant | Token and worker both scope contact by tenant |
| Reusable contact room overwrote call attempts | Server-generated attempt UUID in room, identity, and call ID |
| Public UI converted failures into fake success | Fail-closed state machine; real agent audio or explicit error |
| Fake SMS and “confirmed” inspection claims | Removed; persistent `inspection_requests` is explicitly unconfirmed |
| Emergency claimed a live owner connection | Tool now records the urgent request and states no connection exists |
| Client usage of `emergency_keywords` was ignored | Both canonical and legacy policy keys read |
| Estimate amount came from the LLM | Deterministic catalog calculator; min/max/midpoint/history stored |
| Raw JSON configuration silently became empty | Missing `json` import fixed and contract-tested |
| System prompt/tool internals could enter transcripts | Only `assistant` and `user` turns persisted |
| Recording wait blocked the async loop | `asyncio.to_thread(preserve, ...)` |
| Recording UPDATE had ambiguous `$5` SQL type | Explicit `varchar(20)` casts; live DB regression test added |
| Estimate UPDATE had undetermined `$5` text type | Explicit `text` cast; live DB regression test added |
| Caller disconnect left job running for 300s | Session close requests job shutdown; 15s session-end ceiling |
| CPU load threshold rejected calls during local background load | Explicit `MAX_CONCURRENT_CALLS` request gate; CPU threshold no longer blocks dispatch |
| Client config/terminology unused by code | Validated loader and idempotent apply script |

## External blockers

- Azure is verified for Client #1 (`da-DK-ChristelNeural`, Sweden Central).
- No owner telephone bridge or SMS/calendar delivery exists. Those operations
  remain truthfully “recorded only”.
- The LiveKit project registers in the India South region for Danish traffic.
  Move the project to an EU region before production.
- STT/LLM use remote LiveKit Inference; TTS uses Azure. There are no local models.
- FlyNumber DID and SIP credentials have not been supplied. The inbound code path
  and setup script are ready, but Client #1 remains browser-only until a DID is
  assigned and forwarded by FlyNumber.
- No human Danish listening review has been performed in this execution.

