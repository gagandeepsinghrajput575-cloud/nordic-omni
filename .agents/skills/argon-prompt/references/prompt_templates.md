# Frontier Model Prompt Templates: Architectural Autonomy within Hard Invariants

This guide defines the official prompt engineering specifications for LM Arena Agentic Mode and frontier models (Claude Fable 5.2 Max, Claude Opus 5.5 Max, Gemini 4 Carbon, Gemini 4 Argon High).

---

## 1. LMSYS Max Router & Frontier Model Triggering Engine

LM Arena Agentic mode does NOT allocate top-tier frontier models based on prompt hype. Prompting with phrases like *"Act as a world-class engineer"* or *"Use your smartest model"* triggers Arena's **Steerability Penalty ($P_{\text{steer}}$)**, causing sessions to down-route to lightweight utility models.

### Why Over-Prescriptive Micromanagement Causes Down-Routing
When a prompt provides rigid, step-by-step pseudo-code ("Step 1: Open file X. Step 2: Add import Y. Step 3: Write function foo(a, b)..."):
1. **Collapses Reasoning Tree Depth to $O(1)$**: The prompt author has already solved the causal reasoning and architecture. The task degenerates into mechanical stenography and code transcription.
2. **Win-Rate Parity on Procedural Code**: LMSYS empirical preference data demonstrates that routine models (Astra Medium, Terra) achieve ~96–98% win-rate parity on rote code transcription at 1/10th the inference cost.
3. **Compute Over-Allocation Penalty ($P_{\text{script}}$)**: Allocating 64,000 extended thinking tokens (CoT) to transcribe a pre-solved script is penalized as economic over-allocation. The router down-routes the session to routine models.

### What Triggers Tier 1 Frontier Models
The router allocates Tier 1 Frontier models when the **Task Complexity Score (TCS)** spikes across 5 dimensions:
1. **Cross-Boundary Coupling ($S_{\text{cross}}$)**: Tasks spanning 2–3 coupled architectural tiers simultaneously (PostgreSQL RLS migrations $\leftrightarrow$ async worker daemon lifecycle $\leftrightarrow$ client React state machines $\leftrightarrow$ carrier/SIP encoding protocols).
2. **Abstract Invariant Density ($S_{\text{invariant}}$)**: High ratio of declarative system invariants (what must *never* break) vs imperative instructions (how to write it). Models must use deep CoT to satisfy all invariants simultaneously.
3. **High Semantic Signal-to-Noise Ratio**: Lean Type Spines (< 3,500 tokens) with AST interfaces, Zod schemas, and DB DDL (bodies stripped to `...`) without dumping raw codebase files.
4. **Deterministic Falsifiability ($S_{\text{verif}}$)**: Concrete container verification commands (`(cd web && npx tsc --noEmit)`, `npm test`, `pytest`). Weak models fail multi-file compilation; the router recognizes only frontier models achieve zero-defect pass rates.
5. **Explicit Architectural Freedom**: Explicitly delegating architectural ownership to the model forces the router to budget deep CoT search space rather than routine line generation.

---

## 2. The 5-Pillar Architectural Prompt Anatomy

Every prompt must adhere strictly to the 5-pillar structure delivered in **EXACTLY ONE COPYABLE BLOCK**:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Pillar 1: High-Complexity Multi-Tier Problem Statement                 │
│ - Defines real system objective coupling 2-3 distinct tiers            │
│ - Zero steerability hype ("elite", "world-class", "think step-by-step")│
├────────────────────────────────────────────────────────────────────────┤
│ Pillar 2: Minimal Ground-Truth Type Spine (< 3,500 tokens)             │
│ - AST-extracted interfaces, types, Zod schemas, DB DDL & CSS tokens    │
│ - Zero implementation bodies (...); 100% semantic contracts            │
├────────────────────────────────────────────────────────────────────────┤
│ Pillar 3: Non-Negotiable Contract & Safety Invariants                  │
│ - 4 to 6 declarative post-conditions and mathematical boundaries       │
│ - PostgreSQL RLS session authority, zero loose any, monotonic state    │
├────────────────────────────────────────────────────────────────────────┤
│ Pillar 4: Executable Deterministic Test Gates                          │
│ - Exact container shell commands: tsc --noEmit, npm test, unittest     │
├────────────────────────────────────────────────────────────────────────┤
│ Pillar 5: Explicit Architectural Freedom Grant                         │
│ - Standardized autonomy mandate delegating complete design ownership   │
└────────────────────────────────────────────────────────────────────────┘
```

### The Standardized Architectural Freedom Clause
Every prompt directive section must conclude with this cognitive ownership clause:
> *"You have complete architectural ownership of internal implementation details, state machines, memoization strategies, error recovery, and concurrency patterns. Design the optimal solution that satisfies all invariant boundaries and passes all verification gates."*

---

## 3. Autonomous Turn-Slicing Protocol (< 3,500 Token Budget)

When an assignment requires generating over 300 lines of implementation across multiple boundaries, Antigravity slices the task into **Autonomous Architectural Milestones** rather than procedural step lists:

```mermaid
flowchart TD
    Task[Incoming High-Complexity Request] --> Extractor[Run argon_extractor.py]
    Extractor --> Budget{Token Budget & Scope Check}
    Budget -->|<= 3,500 tok & <= 2 files| Single[Single-Turn Frontier Prompt]
    Budget -->|> 3,500 tok OR >= 3 files| Sliced[Turn-Sliced Autonomous Milestones]
    
    Sliced --> Turn1[Turn 1: Foundation, Domain Logic & Worker Concurrency\n- Full architectural autonomy over DB schema/migrations\n- Core domain algorithms & async worker lifecycle\n- Gate: tsc --noEmit && pytest/unittest]
    Turn1 --> Verify1[Gate 1: tsc --noEmit && unittest]
    Verify1 --> Turn2[Turn 2: Reactive UI, Streaming & Telemetry Bridge\n- Full architectural autonomy over React components\n- Real-time visualizer loops & state progression\n- Gate: npm test && POST /api/webhook/arena]
    Turn2 --> Verify2[Gate 2: npm test && Telemetry Dispatch]
```

---

## 4. Canonical Production-Grade Templates

### Template 1: Real-Time Telephony, LiveKit SIP & Worker Concurrency

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

```python
# agent-worker/services/call_slots.py (AST interface)
class CallSlotRegistry:
    def __init__(self, limit: int) -> None: ...
    @property
    def active_count(self) -> int: ...
    @property
    def limit(self) -> int: ...
    def acquire(self, job_id: str) -> bool: ...
    def release(self, job_id: str) -> bool: ...
```

```typescript
// web/src/contracts/schemas.ts (AST contracts)
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

```sql
-- db/migrations/0008_sip_inbound_routing.sql
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
  "model": "<evaluated-model-name>",
  "category": "telephony-sip-and-worker-concurrency",
  "score": 0.0,
  "verdict": "<PASS/FAIL with exact observed test results>",
  "experience": "<files modified, verified invariants, and command outputs>",
  "snippet": "<core hardened logic snippet>"
}
```
````

---

### Template 2: Dual-Runtime Domain Parity, PostgreSQL RLS & Carrier SMS Dispatch

````markdown
### Target Repository & Branch
- Repository: `gagandeepsinghrajput575-cloud/nordic-omni` (`main`)
- Active Branch: `feat/danish-sms-rls-parity`

### 1. High-Complexity Multi-Tier Problem Statement
Implement an end-to-end, multi-tenant Danish post-call SMS dispatch and catalog estimation system that enforces strict isolation and calculation parity across runtimes:
1. **Multi-Tenant Security & PostgreSQL RLS (`db/migrations/0013_public_contact_rls_and_tenant_integrity.sql`, `web/src/app/api/telephony/sms/route.ts`)**: Tenant authority must be derived exclusively from verified session tokens (`apiSession()`), preventing cross-tenant injection or caller-supplied tenant spoofing.
2. **Carrier SMS Segment Engine (`web/src/lib/sms.ts`, `web/src/contracts/schemas.ts`)**: Carrier dispatch accounting supporting both GSM 03.38 7-bit encoding (including Danish letters `æ`, `ø`, `å`) and UCS-2 multi-segment fallback for Unicode/emoji payloads.
3. **Dual-Runtime Estimation Parity (`agent-worker/agents/estimation.py`, `web/src/lib/calculator.ts`)**: Mathematical pricing and midpoint rounding parity between Python (half-to-even) and TypeScript (half-up) with zero floating-point drift.

### 2. Extracted Ground-Truth Type Spine (< 3,500 tokens)

```typescript
// web/src/contracts/schemas.ts
export const SmsMessageTypeSchema = z.enum([
  'customer_followup',
  'lead_alert',
  'inspection_confirm',
  'custom',
]);

export const SmsStatusSchema = z.enum(['queued', 'sending', 'delivered', 'failed']);

export const SmsDispatchRecordSchema = z.object({
  id: z.string(),
  recipient: z.string(),
  messageType: SmsMessageTypeSchema,
  body: z.string(),
  callLogId: z.string().nullable(),
  contactId: z.string().nullable(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  status: SmsStatusSchema,
  carrier: z.string(),
  segments: z.number().int().positive(),
  deliveryLatencyMs: z.number().int().nonnegative(),
  createdAt: z.string(),
  error: z.string().optional(),
});

export const SmsSendRequestSchema = z.object({
  recipient: z.string().min(1),
  messageType: SmsMessageTypeSchema.optional().default('custom'),
  body: z.string().optional(),
  callLogId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  workspaceId: z.string().optional(),
});
```

```sql
-- db/migrations/0013_public_contact_rls_and_tenant_integrity.sql
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contacts ON contacts
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

### 3. Non-Negotiable Contract & Safety Invariants
1. **Session-Derived Tenancy**: The SMS dispatch route handler must derive tenant context strictly from the authenticated session. Requests attempting to supply an external tenant ID must fail with an invariant violation.
2. **GSM 03.38 & UCS-2 Encoding Accuracy**: Messages composed strictly of GSM 03.38 characters (including Danish `æ, ø, å`) must allocate 160 characters for single segment, and 153 characters per segment for multi-part messages. Any payload containing characters outside GSM 03.38 must immediately switch to UCS-2 boundaries (70 chars single, 67 chars multi-part).
3. **Dual-Runtime Mathematical Parity**: Currency and midpoint rounding between Python worker calculations and TypeScript web representations must achieve 100% agreement on test vectors.
4. **Type Soundness**: Zero loose `any` casts, zero unchecked type assertions (`as Type`), and 100% validation coverage via Zod schemas.

### 4. Executable Test Gates
Verify your implementation in the container by executing:
- `(cd web && npx tsc --noEmit)`
- `npm test`
- `(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`

### 5. Architectural Autonomy Grant
You have complete architectural ownership of internal implementation details, state machines, memoization strategies, error recovery, and concurrency patterns. Design the optimal solution that satisfies all invariant boundaries and passes all verification gates.

### Required Final Output: Cockpit Arena Evaluation Payload
Conclude your response with the exact evaluation payload:
```json
{
  "model": "<evaluated-model-name>",
  "category": "dual-runtime-parity-and-sms-rls",
  "score": 0.0,
  "verdict": "<PASS/FAIL with exact observed test results>",
  "experience": "<files modified, verified invariants, and command outputs>",
  "snippet": "<hardened RLS route or GSM segmentation snippet>"
}
```
````

---

### Template 3: High-Fidelity Client Experience, Audio Visualizer & Real-Time Telemetry

````markdown
### Target Repository & Branch
- Repository: `gagandeepsinghrajput575-cloud/nordic-omni` (`main`)
- Active Branch: `feat/audio-visualizer-telemetry`

### 1. High-Complexity Multi-Tier Problem Statement
Engineer a high-performance, accessible real-time WebRTC audio visualization interface and telemetry bridge coupling:
1. **Web Audio API & Visualizer RAF Loop (`web/src/components/audio/OrbVisualizer.tsx`)**: High-FPS frequency-domain visualization that dynamically paces frames, manages Web Audio API context lifecycles, and executes clean disposal on unmount without leaking audio descriptors or RAF handles.
2. **Public Call State Machine (`web/src/app/call/[contactId]/CallClientView.tsx`)**: Finite state orchestration (`idle`, `connecting`, `active`, `reconnecting`, `error`, `ended`) resilient to unexpected network disconnects and WebRTC track dropouts.
3. **Design System & Accessibility Invariants (`web/src/app/globals.css`)**: Warm Nordic editorial palette adhering strictly to CSS design tokens with full WCAG 2.2 AA compliance and `prefers-reduced-motion` static fallbacks.
4. **Cockpit Telemetry Bridge (`cockpit/server.js`)**: Real-time evaluation telemetry dispatch reporting call metrics to the Cockpit controller.

### 2. Extracted Ground-Truth Type Spine & Design Tokens (< 3,500 tokens)

```css
/* web/src/app/globals.css */
:root {
  --bg: #FAF7F2;
  --panel: #fffdf9;
  --text: #1C1512;
  --muted: #6E6259;
  --border: rgba(44, 34, 28, 0.12);
  --a: #7C3AED;
  --accent: #2563EB;
}
```

```typescript
// Extracted component interfaces
export interface OrbVisualizerProps {
  mediaStream: MediaStream | null;
  isActive: boolean;
  size?: number;
  className?: string;
  onAnalysisUpdate?: (rms: number) => void;
}

export type CallConnectionState = 
  | 'idle' 
  | 'requesting_media' 
  | 'connecting' 
  | 'active' 
  | 'reconnecting' 
  | 'ended' 
  | 'failed';
```

### 3. Non-Negotiable Contract & Safety Invariants
1. **Idempotent Resource Teardown**: Component unmounting or track replacement must deterministically close the `AudioContext`, disconnect all analyser nodes, and cancel pending `requestAnimationFrame` IDs without throwing runtime exceptions.
2. **Zero Magic Styling Values**: All colors, borders, and transitions must reference existing `:root` design tokens. Magic hex values and ad-hoc Tailwind arbitrary values (`text-[12.5px]`) are prohibited.
3. **Accessibility & Reduced Motion**: When `prefers-reduced-motion: reduce` is active, the visualizer must immediately cancel continuous RAF oscillation and transition to an accessible, static SVG representation.
4. **State Machine Integrity**: Connection failures must never leave the UI in a fake "active" state; the state machine must transition deterministically to `failed` and display actionable user feedback.
5. **Zero Type Escapes**: Must pass TypeScript compiler validation with zero errors and zero loose `any` casts.

### 4. Executable Test Gates
Verify your implementation in the container by executing:
- `(cd web && npx tsc --noEmit)`
- `npm test`

### 5. Architectural Autonomy Grant
You have complete architectural ownership of internal implementation details, state machines, memoization strategies, error recovery, and concurrency patterns. Design the optimal solution that satisfies all invariant boundaries and passes all verification gates.

### Required Final Output: Cockpit Arena Evaluation Payload
Conclude your response with the exact evaluation payload:
```json
{
  "model": "<evaluated-model-name>",
  "category": "audio-visualizer-and-client-telemetry",
  "score": 0.0,
  "verdict": "<PASS/FAIL with exact observed test results>",
  "experience": "<files modified, verified invariants, and command outputs>",
  "snippet": "<hardened RAF teardown or state machine snippet>"
}
```
````

---

## 5. Anti-Pattern Checklist: Purging Handcuffs & Down-Routing Triggers

When auditing or generating prompts, ensure none of the following down-routing triggers are present:

| Anti-Pattern (Down-Routing Trigger) | Why It Causes Down-Routing | Required Replacement Pattern |
|---|---|---|
| **Step-by-step procedural pseudo-code** ("Step 1 do this, Step 2 do that") | Pre-solves the logic, collapsing reasoning tree depth ($S_{\text{depth}}$) to $O(1)$ and triggering the Micromanagement Penalty ($P_{\text{script}}$). | **High-Complexity Multi-Tier Problem Statement** + **Explicit Architectural Freedom Grant**. |
| **Steerability Hype** ("Act as an elite 10x architect", "Use maximum genius") | Triggers Arena's Steerability Penalty ($P_{\text{steer}}$) and results in session downgrades to cheap models. | **Objective, high-density technical specifications** describing real invariants and domain complexities. |
| **Raw Repository Code Dumps** (>10,000 tokens) | Triggers Context Bloat Penalty ($P_{\text{bloat}}$), DOM freezes in web client, and dilutes attention heads. | **Surgical Type Spine (< 3,500 tokens)** extracted via AST tools with function bodies stripped to `...`. |
| **Vague or Missing Verification** ("Please test your code") | Fails to signal deterministic falsifiability ($S_{\text{verif}}$) to the router. | **Concrete container shell commands** (`(cd web && npx tsc --noEmit)`, `npm test`, `pytest`). |
| **Single-File Trivial Helpers** | Low cross-boundary complexity ($S_{\text{cross}}$) signals a task suitable for routine utility models. | **Multi-tier problem formulation** coupling database, transport, and client layers simultaneously. |
