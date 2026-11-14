# Arena.ai (LMSYS) Max Router Heuristics & Prompt Complexity Engineering

## 1. Executive Summary

Arena.ai (LMSYS) and modern frontier agent environments utilize dynamic **Task Complexity Routing** (built upon frameworks like RouteLLM and latent preference classifiers) to allocate compute efficiently. Frontline frontier reasoning models (**Tier 1 Frontier: Claude Fable 5.2 Max, Claude Opus 5.5 Max, Gemini 4 Carbon, Gemini 4 Argon High**) cost 10x–50x more compute per token than routine/medium models (**Tier 2/3: Astra Medium, Terra, Flash**). 

The router's job is cost-minimization without quality degradation: **it routes to Tier 1 Frontier models only when a prompt exhibits high structural complexity, high reasoning depth, and open architectural topology requiring deep internal scratchpad reasoning (CoT).**

When a prompt over-specifies step-by-step procedural pseudo-code ("micromanagement"), the router detects that the user has already solved the architectural puzzle, reducing the task to mechanical transcription. Consequently, the router down-routes the session to routine models (Astra Medium, Terra).

To consistently trigger Tier 1 Frontier models, prompts must employ **Architectural Autonomy within Hard Invariants**: high-complexity cross-boundary problem formulations, surgical type spines, inviolable safety boundaries, and explicit cognitive ownership granted to the model.

---

## 2. LMSYS Router Architecture & Task Complexity Scoring (TCS)

### 2.1 The Multi-Stage Routing Pipeline
In Arena.ai Agent Mode, prompt routing operates through a multi-stage evaluation stack:

```
Incoming User Prompt
       │
       ▼
┌────────────────────────────────────────────────────────┐
│ Stage 1: Feature Extraction & Embedding Projection     │
│ - Text embeddings projected into preference space       │
│ - Signal-to-noise ratio & semantic density audit       │
└──────────────────────┬─────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────┐
│ Stage 2: Task Complexity Classifier (TCC)               │
│ - Computes composite Task Complexity Score (TCS)       │
│ - Evaluates: Cross-Boundary Coupling, State Space,     │
│   Reasoning Branching Factor, Invariant Density         │
│ - Applies Penalties: Steerability, Micromanagement     │
└──────────────────────┬─────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────┐
│ Stage 3: Dynamic Thresholding & Tier Allocation        │
│ - If TCS >= Threshold_Frontier (top 15-20% difficulty) │
│     ──> Tier 1 Frontier (Fable 5.2 Max, Opus 5.5 Max,  │
│                          Gemini 4 Carbon, Argon High)  │
│ - If TCS < Threshold_Frontier                          │
│     ──> Down-Route Tier 2/3 (Astra Medium, Terra)      │
└────────────────────────────────────────────────────────┘
```

### 2.2 Task Complexity Score (TCS) Formal Model
The Task Complexity Classifier estimates difficulty using a weighted vector:

$$\text{TCS} = w_1 S_{\text{cross}} + w_2 S_{\text{depth}} + w_3 S_{\text{invariant}} + w_4 S_{\text{verif}} - P_{\text{script}} - P_{\text{steer}} - P_{\text{bloat}}$$

Where:
- **$S_{\text{cross}}$ (Cross-Boundary Coupling)**: Spans multiple architectural layers (PostgreSQL schema/RLS $\leftrightarrow$ API transport/daemons $\leftrightarrow$ Client UI $\leftrightarrow$ Real-time streams).
- **$S_{\text{depth}}$ (Reasoning Tree Depth / Branching Factor)**: Number of interrelated constraints, state transitions, and edge cases that must be reconciled simultaneously.
- **$S_{\text{invariant}}$ (Abstract Invariant Density)**: Ratio of declarative system invariants (mathematical, temporal, or isolation guarantees) to total instructions.
- **$S_{\text{verif}}$ (Falsifiability Index)**: Presence of deterministic verification commands (`tsc --noEmit`, `npm test`, `pytest`).
- **$P_{\text{script}}$ (Micromanagement Penalty)**: Severe penalty applied when prompt specifies procedural, line-by-line imperative execution steps.
- **$P_{\text{steer}}$ (Steerability/Hype Penalty)**: Penalty applied when prompt uses subjective hype ("Act as an elite world-class engineer", "Use maximum genius").
- **$P_{\text{bloat}}$ (Context Dilution Penalty)**: Low semantic density caused by dumping entire raw files or boilerplate.

---

## 3. The "Micromanagement Trap": Why Rigid Scripts Cause Down-Routing

### 3.1 The Stenographer Effect
When a prompt provides line-by-line pseudo-code or step-by-step instructions:
> *"Step 1: Open file X. Step 2: Add import Y from Z. Step 3: Write function foo(a, b). Step 4: Check if a > 0, return true else false..."*

1. **Reasoning Depth Collapses to $O(1)$**: The router evaluates how much planning and multi-step deduction is required. Because the prompt author has already resolved the algorithmic structure, edge cases, and design choices, the remaining work is rote mechanical transcription.
2. **Win-Rate Parity**: Preference models (RouteLLM Matrix Factorization) show that on simple transcription tasks, routine models like **Astra Medium** or **Terra** achieve a 95–98% win rate relative to frontier models at a fraction of the cost.
3. **The Router's Economic Imperative**: Allocating a frontier model with 64,000 thinking tokens (such as Claude Opus 5.5 Max or Gemini 4 Carbon) to transcribe a pre-solved script is flagged as severe compute over-allocation. The router immediately down-routes the session to routine models.

### 3.2 The Steerability & Contradiction Trap
- **Internal Contradictions**: Handcrafted step-by-step scripts frequently assume outdated signatures or hallucinate imports that clash with the actual codebase. A frontier model is forced to choose between following the bad script or obeying the compiler.
- **Suppressed CoT Reasoning**: Extended reasoning models thrive when allowed to explore counter-examples, race conditions, and edge cases in their internal scratchpad. Micro-managing the steps restricts the reasoning phase, signaling low cognitive demand to the router.

---

## 4. Prompt Anatomy: Triggering Tier 1 Frontier Models

To consistently trigger **Claude Fable 5.2 Max**, **Claude Opus 5.5 Max**, and **Gemini 4 Carbon**, prompts must exhibit the following characteristics:

### 4.1 High-Complexity Cross-Boundary Scope
The prompt must describe a coherent system problem that couples multiple distinct layers:
- **Database Layer**: Migration DDL, Row-Level Security (RLS) tenant isolation policies, immutable auditing triggers.
- **Backend/Transport Layer**: Monotonic state machines, idempotent API routes, race-condition-free async socket/stream daemons.
- **Client/UI Layer**: Optimistic updates, WebRTC track lifecycles, visualizer requestAnimationFrame loops, unmount cleanup.
- **Domain Edge Cases**: E.g., GSM 03.38 7-bit vs UCS-2 SMS character encoding segmentation (Danish characters `æ`, `ø`, `å`), decimal point regional formatting.

### 4.2 Declarative Invariants Over Imperative Instructions
Instead of telling the model *how* to write each line, define the **inviolable system invariants** (post-conditions and safety barriers):
- *Invariant 1 (Security)*: Caller-supplied tenant IDs must never be authority; all operations must derive tenancy strictly from validated session context.
- *Invariant 2 (Concurrency)*: Teardown must be strictly monotonic and idempotent; tearing down an already disposed WebRTC track must never throw or leak audio context descriptors.
- *Invariant 3 (Type Soundness)*: Zero loose `any` casts or type assertions (`as Type`); all external payloads must pass runtime Zod validation.

### 4.3 Minimal Ground-Truth Type Spine (< 3,500 Tokens)
- Extracted via AST tools (e.g. `argon_extractor.py`), stripping all function bodies (`...`) while preserving 100% of interfaces, types, Zod schemas, DB DDL, and Design System tokens.
- Signals high semantic density: the model receives pure ground-truth contracts without distracting implementation noise.

### 4.4 Explicit Delegation of Architectural Autonomy
The prompt must explicitly grant cognitive autonomy to the model:
> *"You have complete architectural ownership of internal implementation details, state machines, memoization strategies, and concurrency primitives. Design the optimal solution that satisfies all invariant boundaries and passes all verification gates."*

This phrasing signals to the router that high-order planning, deep scratchpad reasoning (CoT), and complex architectural synthesis are required.

### 4.5 Executable Deterministic Test Gates
Frontier models are triggered when the prompt contains hard verification gates:
- `(cd web && npx tsc --noEmit)`
- `npm test`
- `(cd agent-worker && .venv/bin/python -m unittest discover -s tests)`

The router recognizes that medium/weak models will fail multi-file compilation and test gates, requiring Tier 1 Frontier reasoning.

---

## 5. Comparative Breakdown: Tier 1 Frontier vs Down-Routed

| Dimension | Down-Routed Prompts (Astra Medium, Terra) | Tier 1 Frontier Prompts (Fable 5.2 Max, Opus 5.5 Max, Gemini 4 Carbon) | Router Heuristic Impact |
| :--- | :--- | :--- | :--- |
| **Instruction Style** | Imperative, step-by-step instructions ("Step 1 do this, Step 2 do that"). | Declarative system objectives and invariants ("The system must guarantee X, Y, and Z"). | Imperative scripts collapse $S_{\text{depth}}$ to $O(1)$; declarative objectives require high reasoning depth. |
| **Architectural Scope** | Isolated single-file edits or localized mechanical helpers. | Cross-boundary multi-tier coupling (DB schema $\leftrightarrow$ API routes $\leftrightarrow$ UI state). | Multi-tier coupling increases $S_{\text{cross}}$ and state-space dimensionality. |
| **Cognitive Autonomy** | Handcuffed: explicitly dictates variable names, loop types, and code lines. | Autonomous: grants full architectural ownership of data structures and concurrency patterns. | Autonomous formulation signals open search space needing deep CoT scratchpad tokens. |
| **Type & Context Input** | Raw file dumps (>10k tokens) or vague descriptions without types. | Surgical Type Spine (< 3,500 tokens) with AST contracts, schemas, and design tokens. | High information density avoids context bloat penalties ($P_{\text{bloat}}$). |
| **Safety & Invariants** | Ad-hoc or absent; assumes happy path. | Strict non-negotiable invariants (PostgreSQL RLS, zero `any`, monotonic teardown). | High invariant density ($S_{\text{invariant}}$) requires frontier constraint satisfaction. |
| **Verification Gate** | "Please test your code" or no verification commands. | Exact container commands (`tsc --noEmit`, `npm test`, `pytest`). | Deterministic test gates trigger frontier models capable of zero-defect execution. |
| **Tone / Phrasing** | Steerability bait ("You are an elite 10x developer", "Think step by step"). | Professional, objective, high-density engineering terminology. | Eliminates steerability penalties ($P_{\text{steer}}$). |

---

## 6. The 5-Pillar Architectural Prompt Template Anatomy

When constructing prompts for the `arena-prompt` skill, `@prompt-architect` must follow this 5-pillar structure:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Pillar 1: High-Complexity Multi-Tier Problem Statement                 │
│ - Defines business domain, affected systems, and interaction topology │
│ - Spans 2-3 boundaries (e.g. Storage, Worker, Transport, UI)           │
├────────────────────────────────────────────────────────────────────────┤
│ Pillar 2: Minimal Ground-Truth Type Spine (< 3,500 tokens)             │
│ - AST-extracted schemas, interfaces, DDL, and design system tokens    │
│ - Zero function implementation bodies; pure semantic contracts         │
├────────────────────────────────────────────────────────────────────────┤
│ Pillar 3: Non-Negotiable Contract & Safety Invariants                  │
│ - PostgreSQL RLS isolation, zero loose `any`, monotonic transitions    │
│ - Edge-case invariants (locale, phone normalization, concurrency)      │
├────────────────────────────────────────────────────────────────────────┤
│ Pillar 4: Deterministic Verification Gates                             │
│ - Concrete shell execution commands (`tsc --noEmit`, `npm test`)        │
├────────────────────────────────────────────────────────────────────────┤
│ Pillar 5: Explicit Architectural Freedom & Ownership Grant             │
│ - "You have complete architectural ownership of internal mechanics,    │
│    state machines, and concurrency patterns to satisfy all invariants."│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Actionable Directives for `@prompt-architect`

1. **Purge All Step-by-Step Micro-Instructions**: Remove any numbered lists instructing the model which functions to create line-by-line or what internal variable names to use.
2. **Elevate Objectives to System-Level Problem Formulations**: Frame tasks around end-to-end multi-tier capabilities (e.g., "Implement Danish post-call SMS dispatch with multi-tenant isolation, carrier segment accounting, and optimistic UI telemetry").
3. **Formalize Invariant Blocks**: Provide 4–6 numbered, testable invariants that constrain the solution space without constraining the model's implementation creativity.
4. **Enforce Type Spine Extraction**: Ensure prompts always bundle the AST type signatures extracted via `argon_extractor.py` (< 3,500 tokens).
5. **Always Include the Architectural Autonomy Clause**: Insert the standard grant of cognitive ownership to ensure maximum reasoning budget allocation in Arena.ai.
