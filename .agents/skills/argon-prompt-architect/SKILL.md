---
name: argon-prompt-architect
description: >-
  Architects surgical, high-density, turn-sliced prompts for Argon and 64k context models in LM Arena Agentic mode.
  Extracts minimal Type Spines, Design System tokens, and API contracts without dumping raw codebase files.
  Enforces a strict < 3,500 input token budget, single-block copyable output, and anti-steerability rules.
  Trigger whenever the user asks for an Argon prompt, tags Argon, mentions 64k model limits, or exports tasks to LM Arena.
---

# Argon Prompt Architect

Use this skill whenever you need to prepare an optimized prompt for **Argon**, **DeepSeek v4.1**, **Claude**, or any **64k context window model** running in LM Arena or an external sandbox.

Models with 64k total context windows quickly fail when fed raw repository files:
- **Context Bloat**: Feeding 20k–50k raw tokens exhausts the context and cuts the model's Chain-of-Thought (deep reasoning) budget.
- **Output Truncation**: Asking for multiple massive files in one go causes the model to cut off mid-code.
- **Hallucination & Slop**: Without strict design system tokens and exact TypeScript/Python types, models hallucinate database columns, invent mismatched props, or fall back to generic CSS.

This skill solves that by running a **4-Phase Surgical Extraction** that keeps prompts under **3,500 input tokens** while providing 100% of the type and contract ground truth.

---

## The 4-Phase Workflow

### Phase 1: Problem Scope & Invariant Identification
1. Identify the user's objective (e.g., adding SMS follow-up, Google Calendar booking, or redesigning a console).
2. Map the cross-boundary dependencies:
   - Database / Schema files (`web/src/db/schema.ts`, migrations)
   - TypeScript types (`web/src/lib/types.ts`)
   - Backend routes / Daemons (`web/src/app/api/...`, `agent-worker/...`)
   - Frontend UI components (`web/src/components/...`)
   - Design System tokens (`web/src/app/globals.css`, `web/src/components/ui/studio.tsx`)

### Phase 2: Surgical Type Spine Extraction
Run the bundled extractor script over the target dependency files:

```bash
python3 .agents/skills/argon-prompt-architect/scripts/argon_extractor.py \
  --files web/src/lib/types.ts web/src/db/schema.ts web/src/app/globals.css \
  --max-tokens 3500
```

The script:
- Strips all function implementation bodies, leaving clean headers.
- Extracts interfaces, types, Zod schemas, and enums.
- Extracts Python AST class structures and typed method signatures (`def foo(...) -> Ret: ...`).
- Extracts SQL DDL (tables, types, triggers) while dropping raw row inserts.
- Extracts CSS custom properties (`:root { --... }`) so the model uses the exact design tokens.

### Phase 3: Token Audit & Turn-Slicing Check
Evaluate the extracted token budget reported by `argon_extractor.py`:
- **If <= 2,500 tokens & <= 2 files**: Proceed with a **Single-Turn Frontier Prompt**.
- **If > 3,000 tokens OR touches >= 3 cross-boundary files**: Apply the **Turn-Slicing Protocol**:
  - **Turn 1 (Contract & Backend)**: Database schema migration + API route handlers + test assertions.
  - **Turn 2 (UI & Telemetry)**: Frontend component + state machine + Arena telemetry webhook.

### Phase 4: Prompt Synthesis (Single Copyable Block)
Output the generated prompt enclosed in a single markdown code block (` ````markdown ```` `) so the user can copy-paste it directly into Arena with one click.

Ensure the prompt contains:
1. **Mission Objective**: 1 paragraph stating what the feature is and how it behaves.
2. **Strict Invariants**: Next.js 15 App Router, TypeScript strict (zero `any`), RLS database boundaries, and exact import aliases (`@/...`).
3. **Design Tokens**: The exact palette variables and available UI primitives (`Pill`, `Equalizer`, `LiveStatus`, etc.).
4. **The Type Spine**: The minimal, pristine type contracts extracted in Phase 2.
5. **Exact Deliverable Files**: List of specific file paths to create or update.
6. **Local Verification Commands**: The exact terminal commands the model should optimize to pass (`(cd web && npx tsc --noEmit)`, `npm test`, `pytest`).

---

## Quick Reference Commands

- **Extract specific symbols from files**:
  ```bash
  python3 .agents/skills/argon-prompt-architect/scripts/argon_extractor.py --files web/src/lib/types.ts --symbols TelephonyNumberView SipSessionView
  ```
- **Inspect canonical templates**:
  Read [prompt_templates.md](./references/prompt_templates.md).
- **Inspect real-world telephony benchmark**:
  Read [telephony_example.md](./examples/telephony_example.md).
