# RFC 002: Comprehensive Bug Resolutions and English First-Class Localization

## 1. Executive Summary & Problem Statement
This RFC details the architectural resolution of all cross-boundary bugs and complete English first-class localization across **Project NORDIC-OMNI** (`web/`, `agent-worker/`, and `supabase/`). 

### Core Audit Findings:
1. **Language Barrier**: The initial phase hardcoded Danish strings in scorecards, Kanban headers, WaveformPlayer, PitchSimulatorDrawer, Meta auto-replies, and owner copilot voice greetings. English-speaking clients or tenants with `default_language: 'en-US'` (e.g., `nordic-dental`) received Danish system greetings and Danish UI labels.
2. **Realtime UI Dropped Events**: `TRIGGER_DIRE_MODAL` in `ui-command-store.ts` required a pre-existing `CallLog` object in the local array. If an event was emitted via webhook or Python worker before the call log row was synchronized, the modal failed to open.
3. **Property Mismatch in Pipeline Filtering**: `crm_tools.py` in Python dispatched `{"highlight_stage": stage}` while `ui-command-store.ts` parsed `payload.stage`, causing automatic pipeline stage movements to be ignored on the UI.
4. **PostgreSQL UUID Casting Exceptions**: `callLogId` and ephemeral contact IDs using strings like `"simulated-call-log-uuid"` or `"ephemeral"` triggered PostgreSQL `invalid input syntax for type uuid` crashes on database updates.
5. **Token Metadata Casing Inconsistency**: Next.js token route created metadata with camelCase (`contactId`, `tenantId`) while Python agent worker read snake_case (`contact_id`, `tenant_id`).
6. **LLM Provider Unhandled Rejection**: In `/api/copilot/command`, an unauthenticated or invalid placeholder API key threw an unhandled 500 error instead of falling back smoothly to deterministic algorithmic intent parsing.

---

## 2. Technical Specification & Implementation Plan

### Phase A: Database & UUID Hygiene
- Enhance `agent-worker/services/supabase_service.py` with UUID validation using standard `uuid.UUID(val)` to prevent PostgreSQL crashes.
- Generate valid UUIDs (`uuid.uuid4()`) for ephemeral contacts and inbound FlyNumber SIP calls.
- In `/api/livekit/warm-transfer/route.ts`, support lookup by either `id` (if valid UUID) or `room_name`.

### Phase B: Frontend English & Bilingual Localization
- `AnimatedScorecards.tsx`: Responsive English titles with Danish parity based on tenant language or active toggle.
- `InteractiveKanban.tsx`: Clean English stage column titles (`New Leads`, `Contacted`, `Qualified`, `Booked`, `🚨 Dire Emergency`, `Closed Won`).
- `AvailabilityPricingMatrix.tsx`: English day labels (`Monday`, `Tuesday`, etc.) and bilingual headers.
- `WaveformPlayer.tsx`: English playback statuses, transcript headers, and empty states.
- `PitchSimulatorDrawer.tsx`: Add English simulation options for English lead form submissions ("Emergency water leak in dental clinic"), English call requests, and English emergency alerts.
- `Lead360Drawer.tsx`: English labels, timestamps, and message inputs.

### Phase C: Cross-Boundary API & Store Fixes
- `ui-command-store.ts`:
  - Handle `TRIGGER_DIRE_MODAL` directly from payload even if `matchingCall` is not yet loaded in local store.
  - Parse both `payload.stage` and `payload.highlight_stage` in `FILTER_PIPELINE`.
  - Parse `payload.metricId` and `payload.metric` in `FOCUS_SCORECARD`.
- `/api/copilot/command/route.ts`:
  - Wrap LLM completion in a try/catch block with automatic fallback to deterministic algorithmic parser.
- `/api/webhooks/lead-form/route.ts` & `/api/webhooks/meta/route.ts`:
  - Broaden keyword matching to include full English dictionary (`emergency`, `urgent`, `flood`, `burst`, `leak`, `broken`, `damage`).
  - Auto-detect English vs Danish inbound messages and reply in the matching language.
- `/api/livekit/token/route.ts`:
  - Emit both `tenantId` & `tenant_id`, and `contactId` & `contact_id` in token metadata.

### Phase D: Python Agent Worker Bilingual Alignment
- `agent-worker/main.py`: Parse both `tenant_id` / `tenantId` and `contact_id` / `contactId`.
- `agent-worker/agents/owner_copilot_agent.py`: Dynamic voice selection (`en-US-AvaMultilingualNeural` vs `da-DK-JeppeNeural`) and English initial greeting when tenant default language is English.
- `agent-worker/agents/customer_agent.py`: Complete English prompt adherence.
