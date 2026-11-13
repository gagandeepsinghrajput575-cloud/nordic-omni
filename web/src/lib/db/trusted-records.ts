import { adminSql } from '@/lib/db/client';

/**
 * Server-owned estimate/inspection history. No browser or portal code imports
 * this module, and migrations intentionally define no client INSERT policy for
 * either table. The chat route reaches these writes only after authentication-
 * independent contact lookup, Zod validation, and deterministic catalog pricing.
 */

export async function recordChatEstimate({
  tenantId,
  contactId,
  catalogItemId,
  projectType,
  scopeDetails,
  squareMeters,
  minimum,
  maximum,
  midpoint,
  followupNotes,
}: {
  tenantId: string;
  contactId: string;
  catalogItemId: string;
  projectType: string;
  scopeDetails: string;
  squareMeters: number | null;
  minimum: number;
  maximum: number;
  midpoint: number;
  followupNotes: string;
}): Promise<string> {
  return adminSql.begin(async (tx) => {
    const rows = await tx`
      insert into project_estimates (
        tenant_id, contact_id, call_log_id, project_type, scope_details,
        square_meters, estimated_min_dkk, estimated_max_dkk,
        estimated_value_dkk, followup_notes
      )
      select ${tenantId}, ${contactId}, null, ${projectType}, ${scopeDetails},
             ${squareMeters}, ${minimum}, ${maximum}, ${midpoint}, ${followupNotes}
      where exists (
        select 1 from contacts where id = ${contactId} and tenant_id = ${tenantId}
      )
      returning id
    `;
    if (!rows[0]) throw new Error('Estimate contact is outside the tenant');

    const summary =
      `Overslag: ${projectType} (${minimum.toFixed(0)}-${maximum.toFixed(0)} DKK). ` +
      `Omfang: ${scopeDetails}. Noter: ${followupNotes}`;
    await tx`
      update contacts
         set estimated_value_dkk = ${midpoint},
             pipeline_stage = case
               when pipeline_stage in ('new_lead', 'contacted', 'qualified')
               then 'qualified'::pipeline_stage else pipeline_stage end,
             lead_score = greatest(lead_score, 85),
             shared_memory_summary = left(
               concat_ws(E'\n', nullif(shared_memory_summary, ''), ${summary}::text),
               12000
             ),
             updated_at = now()
       where id = ${contactId} and tenant_id = ${tenantId}
    `;
    await tx`
      insert into ui_command_events (tenant_id, command_type, payload)
      values (
        ${tenantId}, 'PROJECT_ESTIMATE_RECORDED',
        ${JSON.stringify({ contactId, catalogItemId, estimatedValueDkk: midpoint })}::jsonb
      )
    `;
    return rows[0].id as string;
  });
}

export async function requestChatInspection({
  tenantId,
  contactId,
  requestedTimeText,
  address,
  notes,
}: {
  tenantId: string;
  contactId: string;
  requestedTimeText: string;
  address: string;
  notes: string;
}): Promise<string> {
  return adminSql.begin(async (tx) => {
    const rows = await tx`
      insert into inspection_requests (
        tenant_id, contact_id, call_log_id, requested_time_text, address, notes, status
      )
      select ${tenantId}, ${contactId}, null, ${requestedTimeText}, ${address}, ${notes}, 'requested'
      where exists (
        select 1 from contacts where id = ${contactId} and tenant_id = ${tenantId}
      )
      returning id
    `;
    if (!rows[0]) throw new Error('Inspection contact is outside the tenant');

    await tx`
      insert into ui_command_events (tenant_id, command_type, payload)
      values (
        ${tenantId}, 'INSPECTION_REQUESTED',
        ${JSON.stringify({ contactId, status: 'requested' })}::jsonb
      )
    `;
    return rows[0].id as string;
  });
}

export interface ActiveWebhookTarget {
  id: string;
  tenant_id: string | null;
  url: string;
  signing_secret: string;
}

export async function listActiveWebhooksForDispatch(
  tenantId: string,
  eventType: string
): Promise<ActiveWebhookTarget[]> {
  const rows = await adminSql`
    select id, tenant_id, url, signing_secret
    from public.webhooks
    where is_active = true
      and (tenant_id = ${tenantId}::uuid or tenant_id is null)
      and ${eventType} = any(events)
  `;
  return rows as unknown as ActiveWebhookTarget[];
}

export async function recordWebhookDeliverySystem({
  webhookId,
  tenantId,
  eventType,
  statusCode,
  success,
  error,
  payload,
}: {
  webhookId: string;
  tenantId: string | null;
  eventType: string;
  statusCode: number | null;
  success: boolean;
  error: string | null;
  payload: unknown;
}): Promise<void> {
  await adminSql`
    insert into public.webhook_deliveries (
      webhook_id, tenant_id, event_type, status_code, success, error, payload
    ) values (
      ${webhookId}::uuid,
      ${tenantId}::uuid,
      ${eventType},
      ${statusCode},
      ${success},
      ${error ? error.slice(0, 500) : null},
      ${JSON.stringify(payload)}::jsonb
    )
  `;
}

export async function getAgencyTenantRecord(): Promise<Record<string, unknown> | null> {
  const rows = await adminSql`
    select id, name, slug, owner_name, owner_phone, owner_email,
           default_language::text as default_language, status
    from tenants
    order by created_at asc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getTenantBySlugRecord(slug: string): Promise<Record<string, unknown> | null> {
  const rows = await adminSql`
    select id, name, slug, owner_name, owner_phone, owner_email,
           default_language::text as default_language, status
    from tenants
    where slug = ${slug} and status <> 'archived'
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getActivePortalTenantRecord(): Promise<Record<string, unknown> | null> {
  const rows = await adminSql`
    select id, name, slug, owner_name, owner_phone, owner_email,
           default_language::text as default_language, status
    from tenants
    where status = 'active'
    order by name asc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getTenantHoursRecord(workspaceId: string): Promise<Record<string, { open: string; close: string; closed: boolean }> | null> {
  const rows = await adminSql`
    select business_hours from tenants where id = ${workspaceId}::uuid limit 1
  `;
  return (rows[0]?.business_hours as Record<string, { open: string; close: string; closed: boolean }>) ?? null;
}

export async function getTenantKnowledgeRecord(workspaceId: string): Promise<{
  active_broadcast_message: string | null;
  pricing_catalog: Array<{ id: string; name: string; unit_dkk: number; description?: string }> | null;
}> {
  const rows = await adminSql`
    select pricing_catalog, active_broadcast_message from tenants where id = ${workspaceId}::uuid limit 1
  `;
  return {
    active_broadcast_message: (rows[0]?.active_broadcast_message as string) ?? null,
    pricing_catalog: (rows[0]?.pricing_catalog as Array<{ id: string; name: string; unit_dkk: number; description?: string }>) ?? null,
  };
}

export async function getTenantByIdRecord(id: string): Promise<Record<string, unknown> | null> {
  const rows = await adminSql`
    select id, name, slug, owner_name, owner_phone, owner_email,
           default_language::text as default_language, status
    from tenants
    where id = ${id}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

export async function listAllTenantsRecord(): Promise<Array<Record<string, unknown>>> {
  const rows = await adminSql`
    select id, name, slug, owner_name, owner_phone, owner_email,
           default_language::text as default_language, status
    from tenants
    where status = 'active'
    order by name asc
  `;
  return rows as unknown as Array<Record<string, unknown>>;
}

