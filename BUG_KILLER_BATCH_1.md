# BUG KILLER — Batch 1

**Status:** 48 tracked defects fixed and verified in the NORDIC-OMNI call/CRM path.

This is not 48 commits or 48 unrelated files. It is the count of distinct failure
modes that were reproduced from code or live execution, fixed, and covered by a
regression check where a stable seam existed.

**Not counted as “fixed”:** real Azure Christel voice, owner phone transfer, SMS
delivery, calendar booking, EU LiveKit region, or a human Danish accent review.
Those remain external blockers or explicitly unimplemented integrations.

## A. Security and tenant isolation — 10

| # | Severity | Bug killed | Fix and evidence |
|---|---|---|---|
| 01 | P0 | Anonymous public link could request an owner role and reach owner tools | Owner role now requires authenticated agency or explicit tenant-owner membership; live HTTP returned 403 |
| 02 | P0 | Participant identity containing `owner`/`consult` granted owner privileges | Worker trusts only the signed token's exact role; identity text is never authorization |
| 03 | P0 | Signed-in Tenant A could submit Tenant B's contact ID | Token policy validates session membership and exact contact-to-tenant ownership |
| 04 | P0 | Worker read contacts by ID without tenant scope | `get_contact` now requires both contact and tenant IDs |
| 05 | P0 | Worker CRM writes updated contacts by ID across tenants | Stage, estimate, and inspection writes require tenant plus contact |
| 06 | P0 | Call-log lookup trusted a reusable room name without tenant/contact verification | Lookup requires room, tenant, and contact; mismatch cannot reuse a row |
| 07 | P0 | Customer could choose another contact's room name and join/eavesdrop | Browser room and participant identity are ignored; the server generates both |
| 08 | P1 | Customer could spoof participant identity to collide with another participant | Attempt-scoped server identity prevents caller-controlled identity reuse |
| 09 | P1 | Paused/archived tenants could still mint call tokens and connect | Token policy and worker both require tenant status `active` |
| 10 | P1 | Public token minting had a 2-hour TTL and no abuse control | TTL reduced to 15 minutes; fixed-window rate limiting added |

## B. Call attempt and persistence lifecycle — 10

| # | Severity | Bug killed | Fix and evidence |
|---|---|---|---|
| 11 | P1 | Every call used `<slug>_call_<contactId>`, so repeat calls reused one room | Server-generated attempt UUID is part of every room |
| 12 | P1 | Repeat calls reused the same `call_logs` row | Each attempt has its own server-created row and unique room |
| 13 | P1 | Recording filename was deterministic and could overwrite prior audio | Unique attempt room produces a unique recording path |
| 14 | P1 | Simultaneous calls for the same contact could collide in one room | Attempt-scoped rooms and identities isolate concurrent calls |
| 15 | P1 | Failed browser/worker connections left rows in `ringing` forever | `/api/livekit/abandon` marks unresolved attempts `missed` |
| 16 | P1 | Normal calls never received `completed`/`missed` terminal status | Shutdown always writes a terminal status and duration |
| 17 | P1 | Caller disconnect left the job alive for the 300-second session grace period | Session close requests job shutdown; 15-second ceiling configured |
| 18 | P1 | Empty transcript skipped persistence and lost call duration | Finalization always writes transcript array and duration |
| 19 | P1 | System prompts and tool-internal content could appear in customer transcripts | Only `assistant` and `user` turns are persisted |
| 20 | P1 | Recording wait used synchronous `time.sleep()` inside the async shutdown loop | File preservation runs with `asyncio.to_thread(...)` |

## C. Browser and call-state honesty — 10

| # | Severity | Bug killed | Fix and evidence |
|---|---|---|---|
| 21 | P1 | Any token, microphone, or WebRTC error was swallowed and converted to “active” | Public UI now fails closed with a visible error state |
| 22 | P1 | Placeholder LiveKit URL produced a fake active call | Missing/invalid server URL now throws before connection |
| 23 | P1 | UI displayed a fabricated AI greeting and transcript | Fake caption stream removed; only real agent audio promotes the call |
| 24 | P1 | Ended screen claimed an SMS confirmation that was never sent | False SMS claim removed |
| 25 | P1 | Browser acquired the microphone twice: `getUserMedia` plus LiveKit | One microphone path remains, owned by the LiveKit participant |
| 26 | P1 | Room connection alone was treated as a working call | “Live” requires a subscribed agent audio track |
| 27 | P1 | A missing agent could leave the user waiting indefinitely | Explicit 30-second agent-answer timeout added |
| 28 | P1 | Error/retry/disconnect paths leaked rooms, audio elements, or microphone tracks | Central idempotent teardown now covers every exit |
| 29 | P1 | Agent audio was played before `startAudio()` unlocked autoplay | Audio now plays only after the subscribed track and audio-context unlock |
| 30 | P2 | Language selection could choose Danish for an English caller under a Danish tenant | Contact preference now takes precedence over tenant default |

## D. Estimation, booking, and business honesty — 10

| # | Severity | Bug killed | Fix and evidence |
|---|---|---|---|
| 31 | P1 | Raw JSON config hit `json.loads` without importing `json`, silently losing hours/prices/policy | Import fixed; raw JSON contract test added |
| 32 | P1 | Client #1's `emergency_keywords` were ignored because code read `emergencies` | Both canonical and legacy keys supported |
| 33 | P1 | Prompt quoted 95–145k while catalog quoted 95–165k for the same bathroom | Hard-coded conflicting example removed; configured bracket is authoritative |
| 34 | P1 | LLM could choose and persist any estimate amount | Deterministic catalog calculator owns min/max/midpoint |
| 35 | P1 | Only one overwritten CRM value existed; no estimate ledger or dashboard history | Added `project_estimates` history and dashboard display |
| 36 | P1 | Missing square meters, unknown catalog IDs, negative/non-finite values could be estimated | Calculator fails closed with explicit validation |
| 37 | P1 | Recording an estimate forced booked/closed leads back to `qualified` and overwrote memory | Stage transition protected; memory appends instead of replacing |
| 38 | P1 | Generic stage tool could mark an inspection as `booked` without an appointment | `booked` is refused; inspection is stored as an unconfirmed request |
| 39 | P1 | Emergency tool claimed the owner was connected when no transfer existed | Tool records the urgent request and explicitly states no live connection |
| 40 | P1 | No persistent model existed for requested inspections | Added `inspection_requests`, RLS read policy, dashboard view, and real DB test |

## E. Configuration and worker infrastructure — 8

| # | Severity | Bug killed | Fix and evidence |
|---|---|---|---|
| 41 | P2 | `client.config.json` was documentation only; no loader, validation, or apply path | Added validated loader and idempotent `apply_client_config.py` |
| 42 | P1 | Fresh Azure installs omitted `livekit-plugins-azure`; missing credentials silently fell back despite the Christel script | Dependency declared and missing-credential fallback is now logged explicitly |
| 43 | P1 | Recording UPDATE failed with asyncpg `AmbiguousParameterError` on `$5` | Explicit `varchar(20)` casts; real PostgreSQL regression test |
| 44 | P1 | Estimate UPDATE failed with asyncpg `IndeterminateDatatypeError` on `$5` | Explicit `text` cast; real PostgreSQL regression test |
| 45 | P1 | CPU load threshold marked the only worker unavailable during local background load | CPU threshold no longer gates dispatch; capacity uses an explicit request counter |
| 46 | P1 | Custom job request called async `accept()`/`reject()` without awaiting | Both are now awaited; assignment timeout path covered by worker contract checks |
| 47 | P1 | Shutdown callback `release_call_slot` was synchronous in an async callback contract | Converted to async; live finalization no longer raises `NoneType` await error |
| 48 | P1 | Idle/process-pool mode competed with active inference on the 8 GB host and could leave no ready job process | Single bounded thread worker with `MAX_CONCURRENT_CALLS=1` and a 15-second shutdown ceiling; verified live |

## Verification of Batch 1

- Security/policy/browser/dashboard tests: **11/11 passed**
- Worker discovery suite: **22 tests passed**, with 3 opt-in DB tests skipped
- Opt-in real PostgreSQL tests: **3/3 passed**
- TypeScript: **exit 0**
- Production Next.js build: **all 17 routes compiled**
- Live WebRTC: agent joined, audio subscribed, caller disconnected
- Final call row: `completed`, transcript present, `recording_status=ok`
- Recording playback: `200 audio/ogg`, **104,814 bytes**, byte count matched
- Anonymous owner token request: **403**
- Web server and bounded worker: **one each running**
- `git diff --check`: **clean**

## Deliberately not counted as fixed

1. Azure `da-DK-ChristelNeural` is not active because Azure Speech credentials are absent.
2. No owner telephone transfer exists.
3. No SMS provider exists.
4. No calendar/confirmed booking integration exists.
5. LiveKit is registered in India South, not an EU region.
6. STT/LLM/TTS are remote LiveKit Inference, not local models.
7. No human two-way Danish accent/fluency review has been completed.
