# M2 — "Make it a product"

**Mode:** B (inline). Zenith runtime unavailable: no harness checkout, no
`claude`/`codex`/ACP adapter, no provider API key. Independence is
session-internal; a runtime validator would add cold third-party verification
that I cannot simulate.

**Slug:** `m2-usable-and-beautiful` · **Commit:** `80f3636`

## Brief

The user rejected the previous milestone as incomplete:

> "you didnt shipped what you promised and planned … its too plain … i cant
> really create callers and chatbot"

That was correct. Investigation confirmed it exactly: the application contained
**five** write statements in total (`insert agent_config_history` ×2,
`update tenant_agent_config` ×2, `insert sessions`) and **zero** `INSERT INTO
contacts`. There was no code path to create a caller or a workspace. The agency
clients page even rendered the sentence *"Provisioning arrives in the next
milestone."*

## Accepted scope

1. Write surface: create/update callers, create workspace + agent, client facts, knowledge CRUD
2. Agent depth: use the columns the agency can edit
3. Full frontend rebuild on a real design system
4. Schema support for uniqueness

## Accepted non-goals

- Meta/lead-form webhooks (unchanged from M1)
- SSE realtime and the dire modal
- Kanban
- Owner co-pilot

## Contract and verdicts

Every row was checked on the real surface. "Verdict" records what the evidence
supports, not what I intended.

| ID | Assertion | Verdict | Evidence |
|---|---|---|---|
| VAL-CREATE-101 | Caller can be created; row lands in `contacts` | **PASS** (data layer) | `create_probe.sql` → `INSERT 0 1` |
| VAL-CREATE-103 | Duplicate phone → field error, not 500 | **PASS** | probe → `23505` on `contacts_tenant_phone_uniq`; mapped to `DuplicateError`, rendered as a field message |
| VAL-CREATE-104 | Client cannot create in another tenant | **PASS** | probe → `new row violates row-level security policy for table "contacts"` |
| VAL-CREATE-102/105 | Client-side create, immediately callable | **PARTIAL** | route 200 + form renders; click-through not automated |
| VAL-SPACE-201 | Workspace + agent config created atomically | **PASS** (code) / **PARTIAL** (UI) | one `withUser()` transaction; `/agency/clients/new` → 200; not exercised end-to-end |
| VAL-SPACE-202 | Slug validated, duplicate rejected | **PASS** (code) | Zod regex + `DuplicateError`; not exercised at runtime |
| VAL-SPACE-205 | Creation fabricates nothing | **PASS** | empty `'{}'` hours, `'[]'` prices, zero contacts inserted |
| VAL-FACTS-301 | Hours persist and reach the prompt | **PASS** (prompt) / **PARTIAL** (form) | `test_prompt.py` proves hours → prompt; `/portal/settings` → 200 |
| VAL-FACTS-304 | Client still cannot write prompts | **PASS** | `rls_probe.sql` #4 → `UPDATE 0` |
| VAL-KNOW-401 | Knowledge CRUD reaches the prompt | **PARTIAL** | editor renders → 200; injection proven separately |
| VAL-KNOW-402 | Client denied knowledge writes | **PASS** | `rls_probe.sql` #5 → `UPDATE 0` |
| VAL-AI-501 | `escalation_policy` composed into instructions | **PASS** | term present, and prompt changes when the policy changes |
| VAL-AI-502 | Open/closed computed server-side | **PASS** | Mon noon open, 22:00 closed, Sunday closed, unconfigured ≠ open |
| VAL-AI-503 | Pricing injected as a table | **PASS** | services present, `1.250 DKK` formatting, empty catalogue forbids quoting |
| VAL-AI-504 | Danish greeting spelling | **PASS** | `hjælpe` present, `hjalpe` absent |
| VAL-AI-508 | Prompt composed from named parts | **PASS** | 9 section headers asserted |
| VAL-AI-505/506/507 | Live-call behaviour (no invented price, escalate in ≤2 turns, no unconfirmed booking) | **NOT VERIFIED** | needs a live call; assertions are prompt-level only |
| VAL-UI-601 | Primitives exist and are used | **PASS** | 3 files in `components/ui`, imported by 7 routes |
| VAL-UI-602 | No page hand-rolls a table | **PARTIAL** | tables now inside `Card`; leads list still bespoke markup |
| VAL-UI-604 | Designed empty states | **PASS** | callers, knowledge, portfolio, conversation |
| VAL-UI-605 | No new raw hex outside tokens | **PASS** | new components read `var(--token)` only |
| VAL-UI-607 | Respects reduced motion | **PASS** | explicit `prefers-reduced-motion` block |
| VAL-UI-603/606/608 | Pipeline visual, skeletons, contrast | **PARTIAL** | pipeline bars shipped; skeletons unused; contrast not measured |
| VAL-RT-701..703 | SSE realtime | **NOT STARTED** | outside accepted scope |
