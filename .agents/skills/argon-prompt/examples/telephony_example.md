# End-to-End Telephony Benchmark Example: Architectural Autonomy within Hard Invariants

This example demonstrates how `argon-prompt` takes a real cross-boundary telephony feature in `nordic-omni` (spanning ~3,500 lines of raw code across 5 files), extracts the surgical Type Spine and Design Tokens, and produces a single-block, non-handcuffed prompt that maximizes LMSYS Max Router Tier-1 triggering probability.

---

## 1. Source Context & Raw Metrics

| File | Raw Characters | Raw Estimated Tokens | Extracted Role |
|---|---|---|---|
| `agent-worker/main.py` | 22,028 chars | ~5,796 tokens | Voice worker lifecycle, VAD, shutdown lock |
| `agent-worker/services/call_slots.py` | 1,622 chars | ~426 tokens | Concurrency rate limiter & reservation |
| `db/migrations/0008_sip_inbound_routing.sql` | 1,147 chars | ~301 tokens | PostgreSQL DID normalization & indexes |
| `web/src/contracts/schemas.ts` | 14,671 chars | ~3,860 tokens | Zod schemas (`CallStatusSchema`, `PipelineStageSchema`) |
| `web/src/app/globals.css` | 28,814 chars | ~7,580 tokens | Warm editorial design tokens (`:root`) |
| **Total Raw** | **68,282 chars** | **~17,963 tokens** | **Exceeds lightweight model context & KV-cache efficiency** |

---

## 2. Extraction Command

```bash
python3 .agents/skills/argon-prompt/scripts/argon_extractor.py \
  --files "agent-worker/main.py" "agent-worker/services/call_slots.py" "db/migrations/0008_sip_inbound_routing.sql" "web/src/contracts/schemas.ts" "web/src/app/globals.css" \
  --symbols "CallSlotRegistry,CallStatusSchema,PipelineStageSchema" \
  --max-tokens 3500
```

### Extraction Outcome:
- **Raw Volume**: 68,282 chars (~17,963 tokens)
- **Extracted Type Spine**: 3,110 chars (~818 tokens)
- **Token Reduction**: **95.4%** reduction with 100% of interfaces preserved!

---

## 3. Synthesized 5-Pillar Arena Prompt (Turn-Sliced Autonomous Milestones)

The unified pastable block below is generated for Tier 1 Frontier models (Claude Fable 5.2 Max, Opus 5.5 Max, Gemini 4 Carbon, Argon High) in LM Arena Agentic mode:

````markdown
### Target Repository & Branch
- Repository: `gagandeepsinghrajput575-cloud/nordic-omni` (`main`)
- Active Branch: `feat/telephony-sip-hardening`

### 1. High-Complexity Multi-Tier Problem Statement
Design and implement an end-to-end resilient Danish telephony ingress and live call routing architecture coupling three systems:
1. **LiveKit SIP Inbound Ingress (`agent-worker/main.py`, `agent-worker/services/call_slots.py`)**: Real-time voice session dispatch, VAD barge-in with Azure TTS (`da-DK-ChristelNeural`), bounded concurrency via `CallSlotRegistry`, and ordered asynchronous shutdown teardown.
2. **PostgreSQL Multi-Tenant DID Routing (`db/migrations/0008_sip_inbound_routing.sql`)**: Normalized E.164 FlyNumber DID resolution mapping incoming PSTN numbers directly to tenant accounts without fallback leakage.
3. **Telephony State Machine & Contracts (`web/src/contracts/schemas.ts`)**: Monotonic call lifecycle progression preventing invalid state reversals across concurrent WebRTC events.

### 2. Extracted Ground-Truth Type Spine (< 3,500 tokens)

#### `agent-worker/services/call_slots.py` (AST interface)
```python
class CallSlotRegistry:
    def __init__(self, limit: int) -> None:
        ...
    @property
    def active_count(self) -> int:
        ...
    @property
    def limit(self) -> int:
        ...
    def acquire(self, job_id: str) -> bool:
        """Reserve one job exactly once, returning False at capacity."""
        ...
    def release(self, job_id: str) -> bool:
        """Release a job; duplicate/unknown releases do not change capacity."""
        ...
```

#### `web/src/contracts/schemas.ts` (AST contracts)
```typescript
export const PipelineStageSchema = z.enum([
  'new_lead',
  'contacted',
  'qualified',
  'booked',
  'dire_escalated',
  'closed_won',
  'closed_lost',
]);

export const CallStatusSchema = z.enum([
  'ringing',
  'in_progress',
  'dire_hold_for_owner',
  'owner_consulting_ai',
  'merged_live_with_owner',
  'ai_relaying_owner_instruction',
  'completed',
  'missed',
]);
export type CallStatus = z.infer<typeof CallStatusSchema>;
```

#### `db/migrations/0008_sip_inbound_routing.sql`
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_flynumber_did_normalized
    ON tenants (((CASE WHEN regexp_replace(flynumber_did, '[^0-9]', '', 'g') LIKE '00%'
        THEN '+' || substr(regexp_replace(flynumber_did, '[^0-9]', '', 'g'), 3)
        ELSE '+' || regexp_replace(flynumber_did, '[^0-9]', '', 'g') END)))
    WHERE flynumber_did IS NOT NULL;
```

### 3. Non-Negotiable Contract & Safety Invariants
1. **Concurrency Ceiling**: `CallSlotRegistry` must strictly enforce `active_count <= limit`. Spurious or duplicate `release()` calls must be idempotent and must never decrement below zero or corrupt slot state under concurrent async tasks.
2. **Deterministic Teardown**: In `agent-worker/main.py`, slot release and socket cleanup must execute deterministically under an `asyncio.Lock` inside the `finally` block of `entrypoint()`, guaranteeing zero resource leaks even if connection initialization or Azure TTS fails.
3. **DID Normalization Parity**: PSTN phone numbers formatted with Danish local (8 digits), international (`+45`), or trunk (`0045`) prefixes must resolve deterministically to the unique normalized E.164 format.
4. **Monotonic Call Lifecycle**: Transitions in `CallStatusSchema` must be strictly monotonic. Once marked `completed` or `missed`, a call must never transition back to `in_progress` or `ringing`.
5. **Zero Type Escapes**: All TypeScript code must compile with zero errors and zero loose `any` casts.

---

### Autonomous Turn-Slicing Protocol

#### [Turn 1: Backend Concurrency, DID Ingress & Invariant Harness]
- **Autonomous Scope**: Design and harden `CallSlotRegistry` capacity bounds, deterministic `asyncio.Lock` teardown in `agent-worker/main.py`, and regression tests in `agent-worker/tests/test_call_slots.py`.
- **Architectural Autonomy**: You have complete architectural ownership of internal implementation details, locking patterns, and test vector generation.
- **Verification Gate**:
  - `(cd web && npx tsc --noEmit)`
  - `(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`

#### [Turn 2: Monotonic State Progression & Cockpit Telemetry Bridge]
- **Autonomous Scope**: Enforce monotonic transitions across WebRTC events and wire real-time completion telemetry to the Cockpit webhook bridge (`POST http://localhost:4000/api/webhook/arena`).
- **Architectural Autonomy**: You have complete architectural ownership of state machine implementation and telemetry payload serialization.
- **Verification Gate**:
  - `npm test`
  - Dispatch final evaluation payload to Cockpit.

---

### 4. Executable Test Gates
Verify your implementation in the container by executing:
- `(cd web && npx tsc --noEmit)`
- `npm test`
- `(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`

### 5. Architectural Autonomy Grant
You have complete architectural ownership of internal implementation details, state machines, memoization strategies, error recovery, and concurrency patterns. Design the optimal solution that satisfies all invariant boundaries and passes all verification gates.

### Required Final Output: Cockpit Arena Evaluation Payload
Conclude your response with the exact evaluation payload for `POST http://localhost:4000/api/webhook/arena`:
```json
{
  "model": "gemini-4-argon-high",
  "category": "telephony-sip-and-worker-concurrency",
  "score": 0.0,
  "verdict": "<PASS/FAIL with exact observed test results>",
  "experience": "<files modified, verified invariants, and command outputs>",
  "snippet": "<core hardened CallSlotRegistry or teardown lock snippet>"
}
```
````
