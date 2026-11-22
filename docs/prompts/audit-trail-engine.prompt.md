## Objective
Implement vertical slice "Audit Trail Engine" end-to-end to enterprise standards: PostgreSQL schema with RLS, typed Zod contract, zero-fluff modular implementation, and automated test suite.

## AST Type Spine (< 3,500 tokens)
<!-- ARGON EXTRACTION STATS: 2 files | Raw: 67110 chars (~17660 tokens) -> Spine: 4847 chars (~1340 tokens) | Reduction: 92.8% -->

### Extracted Type Spine & Contracts Under Test

#### `web/src/lib/webhooks/inbound-contract.ts` (2374 chars, ~624 tokens, 45.5% reduction)
```typescript
export type AgencyAction = (typeof AGENCY_ACTIONS)[number];

export const InboundWebhookPayloadSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('fetch_leads'),
    tenantId: Uuid.optional(),
    status: z.string().max(40).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  z.object({
    action: z.literal('fetch_calls'),
    tenantId: Uuid.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  z.object({ action: z.literal('fetch_clients') }),
  z.object({ action: z.literal('fetch_client_detail'), tenantId: Uuid }),
  z.object({
    action: z.literal('fetch_calendar_slots'),
    tenantId: Uuid,
    date: z.string().regex(IsoDate),
  }),
  z.object({ action: z.literal('fetch_metrics'), tenantId: Uuid.optional() }),
  z.object({
    action: z.literal('create_lead'),
    tenantId: Uuid,
    name: z.string().min(1).max(255),
    phone: Phone,
    note: z.string().max(2000).optional(),
    triggerSms: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('dispatch_call'),
    tenantId: Uuid,
    phone: Phone,
    promptOverride: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal('send_sms'),
    tenantId: Uuid,
    to: Phone,
    message: z.string().min(1).max(480),
  }),
  z.object({
    action: z.literal('book_appointment'),
    tenantId: Uuid,
    slotStart: z.string().min(10).max(40),
    slotEnd: z.string().min(10).max(40),
    customerName: z.string().min(1).max(255),
    customerPhone: Phone,
  }),
  z.object({
    action: z.literal('update_client'),
    tenantId: Uuid,
    // Zod 4 requires an explicit key schema; the spec's one-argument
    // `z.record(z.any())` no longer compiles.
    businessHours: z.record(z.string(), z.unknown()).optional(),
    broadcastMessage: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('ask_copilot'),
    tenantId: Uuid,
    query: z.string().min(1).max(1000),
  }),
]);

export type InboundWebhookPayload = z.infer<typeof InboundWebhookPayloadSchema>;

export interface GatewaySuccess<T = unknown> {
  ok: true;
  action: AgencyAction;
  deliveryId: string;
  timestamp: string;
  data: T;
}

export interface GatewayFailure {
  ok: false;

export function describeIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string  { /* ... */ }
```

#### `web/src/app/globals.css` (2473 chars, ~650 tokens, 96.1% reduction)
```css
:root {
  --font-sans: 'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif;
  --r-xs: 6px;
  --r-sm: 10px;
  --r-md: 12px;
  --r-lg: 16px;
  --r-xl: 20px;
  --r: 12px;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 120ms;
  --dur: 180ms;
  --dur-slow: 320ms;
  --sidebar-width: 248px;
  --header-height: 64px;
}

:root {
  --studio-black: #08090c;
  --studio-panel: #0e1116;
  --studio-panel-2: #12151c;
  --studio-line: rgba(255, 255, 255, 0.08);
  --studio-line-strong: rgba(255, 255, 255, 0.16);
  --studio-ink: #f5f7fb;
  --studio-ink-secondary: #a1a1aa;
  --studio-ink-muted: #a1a1aa;
  --studio-cyan: #d4d4d8;
  --studio-violet: #e4e4e7;
  --studio-magenta: #a1a1aa;
  --studio-mint: #f4f4f6;
  --studio-amber: #a1a1aa;
  --studio-rose: #e4e4e7;
  --studio-iri: linear-gradient(90deg, rgba(255,255,255,.4) 0%, #ffffff 34%, rgba(255,255,255,.6) 66%, rgba(255,255,255,.3) 100%);
  --studio-iri-soft: linear-gradient(
  --studio-budget: 300ms;
  --studio-shadow: 0 24px 64px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --studio-glow: 0 0 0 1px rgba(255, 255, 255, 0.22), 0 12px 40px rgba(255, 255, 255, 0.1);
}

:root {
  --el-black: #050507;
  --el-surface: #0b0b0f;
  --el-elevated: #121218;
  --el-line: rgba(255, 255, 255, 0.09);
  --el-line-strong: rgba(255, 255, 255, 0.18);
  --el-ink: #f4f4f6;
  --el-ink-secondary: #c6c6d0;
  --el-ink-muted: #a1a1aa;
  --el-accent: #ffffff;
  --el-violet: #d4d4d8;
  --el-cyan: #a1a1aa;
  --el-magenta: #d4d4d8;
  --el-mint: #e4e4e7;
  --el-amber: #a1a1aa;
  --el-rose: #e4e4e7;
  --el-iri: linear-gradient(90deg, rgba(255,255,255,.4) 0%, #ffffff 34%, rgba(255,255,255,.6) 66%, rgba(255,255,255,.3) 100%);
  --el-mesh-a: radial-gradient(58% 46% at 18% 0%, rgba(255, 255, 255, 0.07), transparent 68%);
  --el-mesh-b: radial-gradient(48% 42% at 88% 12%, rgba(255, 255, 255, 0.05), transparent 66%);
  --el-mesh-c: radial-gradient(52% 44% at 50% 108%, rgba(255, 255, 255, 0.04), transparent 70%);
  --el-glass: var(--glass);
  --el-glass-soft: var(--glass-soft);
  --el-blur: var(--blur);
  --el-shadow: 0 24px 70px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  --el-shadow-soft: 0 10px 34px rgba(0, 0, 0, 0.32);
  --el-glow: 0 0 0 1px rgba(255, 255, 255, 0.2), 0 14px 46px rgba(255, 255, 255, 0.07);
  --el-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --el-spring-soft: cubic-bezier(0.32, 0.72, 0, 1);
  --sidebar-width: 264px;
}
```

## Non-Negotiable Invariants
1. Strict Multi-Tenant Isolation: Every table MUST enable RLS and isolate tenant data.
2. Idempotency: All state mutations must be idempotent.
3. Zero Tolerance for Loose Types: 0 `any`, 0 `@ts-ignore`.
4. High Contrast & Motion: UI surfaces must pass WCAG AA (>= 4.5:1) with `useReducedMotion` fallbacks.

## Mandatory 3-Phase Execution Protocol

### Phase 1: Environment Audit (Read-Only)
1. Inspect directory structure, dependencies, and existing contract tests using targeted search (`grep`, `find`). Do NOT dump entire files.
2. Formulate your implementation plan.
*Constraint: Do NOT edit any files until Phase 1 audit plan is output.*

### Phase 2: Implementation
1. Database Migration: Create `db/migrations/00XX_audit_trail_engine.sql` with RLS policies.
2. Contracts & Handlers: Implement schemas in `src/lib/` and route in `src/app/api/`.
3. UI Components: Build accessible, fluid spring-animated interfaces adhering to the design system.
4. Unit & Contract Tests: Write failing tests and make them pass.

### Phase 3: Verification & Self-Correction
1. Run strict type check: `(cd web && npx tsc --noEmit)`.
2. Run test suite: `npm test`.
3. Confirm 0 compiler errors and 100% test pass rate before completion.
