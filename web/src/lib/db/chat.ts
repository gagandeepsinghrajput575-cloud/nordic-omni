import { adminSql } from '@/lib/db/client';
import type { CatalogItem } from '@/lib/estimation';

export interface ChatContactContext {
  contact: {
    id: string;
    tenant_id: string;
    full_name: string | null;
    phone_number: string | null;
    email: string | null;
    preferred_language: string;
    pipeline_stage: string;
    lead_score: number;
    estimated_value_dkk: number;
    ai_auto_reply_enabled: boolean;
    shared_memory_summary: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    default_language: string;
    owner_name: string;
    owner_phone: string;
    owner_email: string;
    business_hours: Record<string, unknown>;
    pricing_catalog: CatalogItem[];
    active_broadcast_message: string | null;
  };
  agent: {
    customer_system_prompt: string;
    escalation_policy: Record<string, unknown>;
  };
  knowledge: string;
}

export interface ChatMessageRow {
  id: string;
  channel: string;
  direction: 'inbound' | 'outbound' | 'system';
  sender: 'customer' | 'ai' | 'owner' | 'system';
  content: string;
  created_at: string;
}

export async function loadChatContext(contactId: string): Promise<ChatContactContext | null> {
  const rows = await adminSql`
    select
      c.id, c.tenant_id, c.full_name, c.phone_number, c.email,
      c.preferred_language, c.pipeline_stage::text as pipeline_stage,
      c.lead_score, c.estimated_value_dkk::float as estimated_value_dkk,
      c.ai_auto_reply_enabled, c.shared_memory_summary,
      t.name, t.slug, t.status, t.default_language::text as default_language,
      t.owner_name, t.owner_phone, t.owner_email, t.business_hours,
      t.pricing_catalog, t.active_broadcast_message,
      coalesce(cfg.customer_system_prompt, '') as customer_system_prompt,
      coalesce(cfg.escalation_policy, '{}'::jsonb) as escalation_policy
    from contacts c
    join tenants t on t.id = c.tenant_id
    left join tenant_agent_config cfg on cfg.tenant_id = t.id
    where c.id = ${contactId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const knowledgeRows = await adminSql`
    select title, content from knowledge_items
    where tenant_id = ${row.tenant_id} and is_active = true
    order by priority desc, category, title
    limit 120
  `;
  const knowledge = knowledgeRows
    .map((entry) => `- ${String(entry.title)}: ${String(entry.content)}`)
    .join('\n')
    .slice(0, 24_000);

  return {
    contact: {
      id: row.id as string,
      tenant_id: row.tenant_id as string,
      full_name: (row.full_name as string | null) ?? null,
      phone_number: (row.phone_number as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      preferred_language: (row.preferred_language as string) ?? 'da',
      pipeline_stage: row.pipeline_stage as string,
      lead_score: Number(row.lead_score ?? 50),
      estimated_value_dkk: Number(row.estimated_value_dkk ?? 0),
      ai_auto_reply_enabled: Boolean(row.ai_auto_reply_enabled),
      shared_memory_summary: (row.shared_memory_summary as string) ?? '',
    },
    tenant: {
      id: row.tenant_id as string,
      name: row.name as string,
      slug: row.slug as string,
      status: row.status as string,
      default_language: row.default_language as string,
      owner_name: row.owner_name as string,
      owner_phone: row.owner_phone as string,
      owner_email: row.owner_email as string,
      business_hours: (row.business_hours as Record<string, unknown>) ?? {},
      pricing_catalog: (row.pricing_catalog as CatalogItem[]) ?? [],
      active_broadcast_message: (row.active_broadcast_message as string | null) ?? null,
    },
    agent: {
      customer_system_prompt: (row.customer_system_prompt as string) ?? '',
      escalation_policy: (row.escalation_policy as Record<string, unknown>) ?? {},
    },
    knowledge,
  };
}

export async function loadChatMessages(
  tenantId: string,
  contactId: string,
  limit = 12,
): Promise<ChatMessageRow[]> {
  const rows = await adminSql`
    select id, channel::text as channel, direction, sender, content, created_at
    from (
      select id, channel, direction, sender, content, created_at
      from messages
      where tenant_id = ${tenantId} and contact_id = ${contactId}
      order by created_at desc
      limit ${limit}
    ) recent
    order by created_at asc
  `;
  return rows as unknown as ChatMessageRow[];
}

export async function appendChatMessage({
  tenantId,
  contactId,
  channel,
  direction,
  sender,
  content,
  metadata = {},
}: {
  tenantId: string;
  contactId: string;
  channel: 'web_chat' | 'voice_inbound' | 'voice_instant_webrtc';
  direction: 'inbound' | 'outbound' | 'system';
  sender: 'customer' | 'ai' | 'owner' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; created_at: string }> {
  const rows = await adminSql`
    insert into messages
      (tenant_id, contact_id, channel, direction, sender, content, metadata)
    values (
      ${tenantId}, ${contactId}, ${channel}::channel_type,
      ${direction}, ${sender}, ${content.slice(0, 8000)},
      ${JSON.stringify(metadata)}::jsonb
    )
    returning id, created_at
  `;
  return rows[0] as unknown as { id: string; created_at: string };
}

export async function mergeContactMemory(
  tenantId: string,
  contactId: string,
  memoryUpdate: string | null,
): Promise<void> {
  const clean = (memoryUpdate || '').trim().slice(0, 700);
  if (!clean) return;
  await adminSql`
    update contacts
       set shared_memory_summary = left(
             concat_ws(E'\n', nullif(shared_memory_summary, ''), ${clean}::text),
             12000
           ),
           updated_at = now()
     where id = ${contactId} and tenant_id = ${tenantId}
  `;
}

export async function updateChatContactState(
  tenantId: string,
  contactId: string,
  stage: string | null,
  leadScore: number | null,
): Promise<void> {
  const allowed = new Set([
    'new_lead',
    'contacted',
    'qualified',
    'dire_escalated',
    'closed_won',
    'closed_lost',
  ]);
  if (!stage || !allowed.has(stage)) return;
  const score = leadScore === null ? null : Math.max(0, Math.min(100, Math.round(leadScore)));
  await adminSql`
    update contacts
       set pipeline_stage = ${stage}::pipeline_stage,
           lead_score = coalesce(${score}, lead_score),
           updated_at = now()
     where id = ${contactId} and tenant_id = ${tenantId}
  `;
}


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
      ) values (
        ${tenantId}, ${contactId}, null, ${projectType}, ${scopeDetails},
        ${squareMeters}, ${minimum}, ${maximum}, ${midpoint}, ${followupNotes}
      )
      returning id
    `;
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
      ) values (
        ${tenantId}, ${contactId}, null, ${requestedTimeText}, ${address}, ${notes}, 'requested'
      )
      returning id
    `;
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

