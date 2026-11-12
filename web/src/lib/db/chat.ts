import { withPublicContact } from '@/lib/db/client';
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
    reception_mode: string;
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
  return withPublicContact(contactId, async (tx) => {
    const rows = await tx`
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
      where c.id = ${contactId} and c.tenant_id = t.id
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;

    const knowledgeRows = await tx`
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
      reception_mode: row.reception_mode as string,
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
  });
}

export async function loadChatMessages(
  tenantId: string,
  contactId: string,
  limit = 12,
): Promise<ChatMessageRow[]> {
  return withPublicContact(contactId, async (tx) => {
    const rows = await tx`
      select id, channel::text as channel, direction, sender, content, created_at
      from (
        select id, channel, direction, sender, content, created_at
        from messages
        where tenant_id = ${tenantId} and contact_id = ${contactId}
        order by created_at desc
        limit ${Math.max(1, Math.min(100, Math.trunc(limit)))}
      ) recent
      order by created_at asc
    `;
    return rows as unknown as ChatMessageRow[];
  });
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
  return withPublicContact(contactId, async (tx) => {
    const rows = await tx`
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
  });
}

export async function mergeContactMemory(
  tenantId: string,
  contactId: string,
  memoryUpdate: string | null,
): Promise<void> {
  const clean = (memoryUpdate || '').trim().slice(0, 700);
  if (!clean) return;
  await withPublicContact(contactId, async (tx) => {
    await tx`
      update contacts
         set shared_memory_summary = left(
               concat_ws(E'\n', nullif(shared_memory_summary, ''), ${clean}::text),
               12000
             ),
             updated_at = now()
       where id = ${contactId} and tenant_id = ${tenantId}
    `;
  });
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
  await withPublicContact(contactId, async (tx) => {
    await tx`
      update contacts
         set pipeline_stage = case
               when pipeline_stage in ('closed_won', 'closed_lost') then pipeline_stage
               when ${stage}::pipeline_stage = 'dire_escalated' then 'dire_escalated'::pipeline_stage
               when pipeline_stage in ('booked', 'dire_escalated') then pipeline_stage
               when pipeline_stage = 'qualified'
                and ${stage}::pipeline_stage in ('new_lead', 'contacted') then pipeline_stage
               when pipeline_stage = 'contacted'
                and ${stage}::pipeline_stage = 'new_lead' then pipeline_stage
               else ${stage}::pipeline_stage
             end,
             lead_score = coalesce(${score}, lead_score),
             updated_at = now()
       where id = ${contactId} and tenant_id = ${tenantId}
    `;
  });
}


