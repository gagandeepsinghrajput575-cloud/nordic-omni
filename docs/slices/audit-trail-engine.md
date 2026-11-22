## Vertical Slice Architecture: Audit Trail Engine
Status: PROPOSED
Slice ID: slice-audit-trail-engine

### 1. Domain Entities & State Machine
- Identify primary entity and lifecycle transitions (e.g., draft -> active -> archived).
- Immutability rule: Never mutate historic audit records; append-only events.

### 2. Database Schema (PostgreSQL with RLS)
- Primary Key: UUIDv4
- Multi-tenancy: `tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE`
- Row Level Security:
  ```sql
  ALTER TABLE public.audit_trail_engine ENABLE ROW LEVEL SECURITY;
  CREATE POLICY audit_trail_engine_tenant_isolation ON public.audit_trail_engine
    FOR ALL TO omni_app
    USING (public.is_agency() OR (tenant_id IS NOT NULL AND public.is_tenant_member(tenant_id)));
  ```

### 3. Strict API Contract (Zod & TypeScript)
- Input Schema: Validates request body, parameters, query.
- Output Schema: Standardized response envelope `{ ok: true, data: T, timestamp: string }`.
- Idempotency: Mutations require `Idempotency-Key` header or client-supplied UUID.

### 4. Non-Negotiable Invariants
1. No tenant may ever read or mutate data belonging to another tenant.
2. Every mutation generates an audit event or delivery receipt.
3. Zero `any`, zero `@ts-ignore`.

### 5. Verification Floor (TDD)
- [ ] Contract tests verifying input validation & failure modes.
- [ ] Tenant isolation test proving cross-tenant access returns 403/404.
- [ ] Idempotency test proving duplicate calls do not double-write.
- [ ] UI contrast & motion test proving WCAG AA compliance.
