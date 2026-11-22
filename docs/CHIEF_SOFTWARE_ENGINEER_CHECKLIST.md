# 🏛️ The Chief Software Engineer Protocol & Enterprise AI Checklist

This document is the operational standard for leading and scaling massive, multi-feature enterprise applications autonomously with AI—ensuring rock-solid reliability, zero security vulnerabilities, and lightning-fast execution without context bloat or AI latency slowdowns.

---

## ⚡ The Golden Rule: How to Keep AI Fast on Massive Codebases
The #1 reason AI becomes slow, confused, or hallucinates on large enterprise repositories is **Context Bloat**. Damping 50,000 lines of code into a model burns its thinking budget, dilutes its attention, and triggers rate-limiting latency.

### The Fast-AI Laws:
1. **Never Dump Full Codebases:** Use targeted AST extraction (`argon_extractor.py`) to feed the AI minimal **Type Spines (< 3,500 tokens)** containing only Zod schemas, TypeScript interfaces, and SQL DDL.
2. **Read-Only Phase 1 Audit:** The AI must read targeted lines (`grep`, line-range reads) before writing a single line of code.
3. **Decoupled Vertical Slices:** Build and verify one vertical slice at a time (Schema → API Contract → UI → Tests).
4. **Automated Zero-Trust Gates:** Never ask the AI "are you sure?". Run compiler (`tsc --noEmit`) and test suites (`npm test`) programmatically.

---

## 📋 The Step-by-Step Enterprise Lead Checklist

### Step 1: Invariant & Domain Modeling (Before Any Code)
- [ ] **Define the Immutable Invariants:**
  - *Multi-Tenancy:* What data can NEVER cross tenant boundaries?
  - *Financial & Historical:* Can historical state be mutated? (Law: Append-only event logs or double-entry ledgers).
  - *Concurrency & Retries:* Is every state mutation protected by an `Idempotency-Key`?
- [ ] **Establish Database Schemas with RLS:**
  - Primary keys are UUIDs (`gen_random_uuid()`).
  - Multi-tenant foreign keys (`REFERENCES public.tenants(id) ON DELETE CASCADE`).
  - Row Level Security explicitly enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) with non-bypassable policies.

### Step 2: Contract-First Architecture
- [ ] **Strict Typing & Input Validation:**
  - All ingress points (HTTP, Webhooks, WebSockets) parse payloads with strict Zod schemas.
  - Discriminated unions used for polymorphic action dispatchers.
  - Standardized JSON response envelope: `{ ok: boolean, data?: T, error?: string, timestamp: string }`.
- [ ] **Zero Tolerance for Loose Types:**
  - 0 instances of `any` or `as any`.
  - 0 instances of `@ts-ignore` or `@ts-nocheck`.

### Step 3: Pervasive Automated Testing (TDD)
- [ ] **The Testing Pyramid:**
  1. *Unit & Contract Tests:* Input boundary verification, malformed payload rejections, edge cases.
  2. *Security & Tenant Isolation Tests:* Proving that Tenant A cannot query or mutate Tenant B's data (expected 403/404).
  3. *Idempotency Tests:* Proving duplicate network requests execute exactly once.
  4. *WCAG Accessibility & Motion Tests:* Contrast ratios (>= 4.5:1 text, >= 3:1 controls) and `prefers-reduced-motion` fallbacks.

### Step 4: Fluid Motion & Enterprise UI Standards
- [ ] **Standardized Spring Motion Vocabulary:**
  - Shared presets (`stiffness: 420, damping: 34`) used across all animated surfaces.
  - Tactile micro-interactions: card hover lifts (`-2px`), button presses (`0.98`), tab indicator glides (`layoutId`).
- [ ] **High-Contrast Theme System:**
  - Stark contrast: Deep Obsidian black (`#050507`) and crisp studio paper white (`#fafafa` / `#ffffff`).
  - Measured WCAG AAA contrast for typography and primary buttons (>= 18:1).
  - Pre-paint boot script preventing theme flicker.

### Step 5: Continuous Zero-Trust Verification
- [ ] **Automated Quality Gates:**
  - `(cd web && npx tsc --noEmit)` exits with 0 errors.
  - `npm test` runs with 100% green pass rate across all suites.
  - Production build (`next build`) compiles cleanly without SSR hydration mismatches.

---

## 🛠️ CLI Engine Reference

Run the autonomous Chief Engineer command center at any time:

```bash
# 1. Audit current project health & enterprise checklist readiness score
npx tsx scripts/chief-engineer.ts status

# 2. Architect a new enterprise vertical slice
npx tsx scripts/chief-engineer.ts plan "Stripe Billing & Subscription Engine"

# 3. Generate a token-conserving, surgical AST prompt for Frontier models
npx tsx scripts/chief-engineer.ts prompt "Stripe Billing & Subscription Engine"

# 4. Run the full verification pipeline
npx tsx scripts/chief-engineer.ts verify
```
