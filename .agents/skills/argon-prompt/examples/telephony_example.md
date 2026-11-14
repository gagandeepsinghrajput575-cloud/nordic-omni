# End-to-End Telephony Benchmark Example

This example demonstrates how `argon-prompt-architect` takes a real cross-boundary telephony feature in `nordic-omni` (spanning ~3,500 lines of raw code across 5 files), extracts the surgical Type Spine and Design Tokens, and produces a single-block, turn-sliced prompt under 2,800 tokens.

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
python3 .agents/skills/argon-prompt-architect/scripts/argon_extractor.py \
  --files "agent-worker/main.py" "agent-worker/services/call_slots.py" "db/migrations/0008_sip_inbound_routing.sql" "web/src/contracts/schemas.ts" "web/src/app/globals.css" \
  --symbols "CallSlotRegistry,CallStatusSchema,PipelineStageSchema" \
  --max-tokens 3500
```

### Extraction Outcome:
- **Raw Volume**: 68,282 chars (~17,963 tokens)
- **Extracted Type Spine**: 3,110 chars (~818 tokens)
- **Token Reduction**: **95.4%** reduction with 100% of interfaces preserved!

---

## 3. Synthesized Argon Single-Block Prompt (Turn-Sliced)

The unified pastable block below is generated for Argon in LM Arena Agentic mode:

````markdown
### Target Repository & Branch
- Repository: `gagandeepsinghrajput575-cloud/nordic-omni` (`main`)

### Architecture & Cross-Boundary Context
Multi-tenant Danish AI voice receptionist spanning three boundaries:
1. **LiveKit SIP & Worker Concurrency (`agent-worker/main.py`, `agent-worker/services/call_slots.py`)**: Manages real-time inbound call slots via `CallSlotRegistry` (strictly bounded by `MAX_CONCURRENT_CALLS`), handles VAD barge-in with Azure TTS (`SafeAzureTTS`), and enforces ordered `asyncio.Lock` teardown in `on_shutdown`.
2. **PostgreSQL DID Ingress Routing (`db/migrations/0008_sip_inbound_routing.sql`)**: Enforces unique normalized E.164 FlyNumber DID matching (`idx_tenants_flynumber_did_normalized`), mapping incoming PSTN numbers to isolated tenant records without fallback.
3. **Contracts & Telephony State (`web/src/contracts/schemas.ts`)**: Monotonic call lifecycle transitions validated via `CallStatusSchema` (`ringing` -> `in_progress` -> `dire_hold_for_owner` -> `completed` / `missed`).

### Extracted Type Spine & Contracts Under Test

#### `agent-worker/services/call_slots.py`
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

#### `web/src/contracts/schemas.ts`
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
```

#### `db/migrations/0008_sip_inbound_routing.sql`
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_flynumber_did_normalized
    ON tenants (((CASE WHEN regexp_replace(flynumber_did, '[^0-9]', '', 'g') LIKE '00%'
        THEN '+' || substr(regexp_replace(flynumber_did, '[^0-9]', '', 'g'), 3)
        ELSE '+' || regexp_replace(flynumber_did, '[^0-9]', '', 'g') END)))
    WHERE flynumber_did IS NOT NULL;
```

---

### Execution Protocol: Turn-Sliced Delivery

#### [Turn 1: Backend Call Slot Concurrency & Database Parity]
1. Audit `CallSlotRegistry` in `agent-worker/services/call_slots.py` to ensure duplicate release calls do not decrement active count below 0 or introduce race conditions under async worker teardown.
2. Verify in `agent-worker/main.py` that `release_call_slot(job_id)` is deterministically executed in the `finally` block of `entrypoint()` even if `AgentSession.start()` or database connection fails.
3. Add regression tests in `agent-worker/tests/test_call_slots.py` verifying capacity bounds under concurrent task spawns.
4. Verify Turn 1 Sandbox Constraints:
   - `(cd web && npx tsc --noEmit)`
   - `(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`

#### [Turn 2: Monotonic State Enforcement & Cockpit Arena Webhook Bridge]
1. Verify that `CallStatusSchema` state transitions are monotonic: a call cannot transition from `completed` or `missed` back to `in_progress`.
2. Connect call completion telemetry to the Cockpit webhook bridge (`POST http://localhost:4000/api/webhook/arena`).
3. Verify Turn 2 Sandbox Constraints:
   - `npm test`
   - Dispatch final evaluation payload to Cockpit.

---

### Non-Negotiable Acceptance & Verification Commands
1. Zero TypeScript compile errors (`(cd web && npx tsc --noEmit)` exits 0).
2. All Python unit tests pass with zero regressions (`(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`).
3. All web contract tests pass (`npm test`).

### Required Final Output: Cockpit Arena Evaluation Payload
Conclude your final response with the exact JSON payload:
```json
{
  "model": "gemini-4-argon-high",
  "category": "telephony-concurrency-and-slot-registry",
  "score": 0.0,
  "verdict": "<PASS/FAIL with exact observed test results>",
  "experience": "<files modified, verified invariants, and command outputs>",
  "snippet": "<hardened CallSlotRegistry or teardown lock snippet>"
}
```
````
