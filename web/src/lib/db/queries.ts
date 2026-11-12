import { adminSql, withUser } from '@/lib/db/client';

/**
 * Read queries. Every one runs inside withUser(), which sets `app.user_id` so
 * Row Level Security decides what is visible. No query here filters by tenant
 * manually — RLS is the authority, which is why a client can never widen scope.
 */

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  default_language: string;
  contact_count: number;
  pipeline_dkk: number;
  call_count: number;
  open_dire: number;
  flynumber_did: string | null;
  reception_mode: string;
}

export async function listTenants(userId: string): Promise<TenantSummary[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select
        t.id,
        t.name,
        t.slug,
        t.status,
        t.reception_mode,
        t.flynumber_did,
        t.default_language::text as default_language,
        (select count(*)::int from contacts c where c.tenant_id = t.id) as contact_count,
        (select coalesce(sum(c.estimated_value_dkk), 0)::float from contacts c
           where c.tenant_id = t.id and c.pipeline_stage <> 'closed_lost') as pipeline_dkk,
        (select count(*)::int from call_logs cl where cl.tenant_id = t.id) as call_count,
        (select count(*)::int from conversation_escalations e
           where e.tenant_id = t.id and e.status <> 'resolved' and e.urgency >= 4) as open_dire
      from tenants t
      order by t.name
    `;
    return rows as unknown as TenantSummary[];
  });
}

export interface TenantFacts {
  id: string;
  name: string;
  slug: string;
  owner_name: string;
  owner_phone: string;
  owner_email: string;
  default_language: string;
  flynumber_did: string | null;
  active_broadcast_message: string | null;
  business_hours: Record<string, { open: string; close: string; closed: boolean }>;
  pricing_catalog: import('@/lib/estimation').CatalogItem[];
  status: string;
  reception_mode: string;
  telephony_mode: string;
}

export async function getTenantFacts(userId: string, tenantId: string): Promise<TenantFacts | null> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, name, slug, owner_name, owner_phone, owner_email,
             default_language::text as default_language, flynumber_did,
             active_broadcast_message, business_hours, pricing_catalog,
             status, reception_mode, telephony_mode::text as telephony_mode
      from tenants where id = ${tenantId} limit 1
    `;
    return (rows[0] as unknown as TenantFacts) ?? null;
  });
}

export interface ContactRow {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  email: string | null;
  pipeline_stage: string;
  lead_score: number;
  estimated_value_dkk: number;
  ai_auto_reply_enabled: boolean;
  shared_memory_summary: string;
  preferred_language: string;
  sentiment_score: number;
  created_at: string;
  updated_at: string;
}

export async function listContacts(userId: string, tenantId: string, limit = 50): Promise<ContactRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, full_name, phone_number, email, pipeline_stage::text as pipeline_stage,
             lead_score, estimated_value_dkk::float as estimated_value_dkk,
             ai_auto_reply_enabled, shared_memory_summary,
             preferred_language, sentiment_score::float as sentiment_score,
             created_at, updated_at
      from contacts
      where tenant_id = ${tenantId}
      order by updated_at desc
      limit ${limit}
    `;
    return rows as unknown as ContactRow[];
  });
}

export async function searchContacts(
  userId: string,
  tenantId: string,
  query: string
): Promise<ContactRow[]> {
  const pattern = `%${query.trim()}%`;
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, full_name, phone_number, email, pipeline_stage::text as pipeline_stage,
             lead_score, estimated_value_dkk::float as estimated_value_dkk,
             ai_auto_reply_enabled, shared_memory_summary,
             preferred_language, sentiment_score::float as sentiment_score,
             created_at, updated_at
      from contacts
      where tenant_id = ${tenantId}
        and (
          full_name ilike ${pattern}
          or phone_number ilike ${pattern}
          or email ilike ${pattern}
        )
      order by updated_at desc
      limit 5
    `;
    return rows as unknown as ContactRow[];
  });
}

/**
 * One contact, by id. RLS decides whether this caller is even visible, so no
 * tenant filter is written here — a cross-tenant id simply returns null.
 */
export async function getContact(userId: string, contactId: string): Promise<ContactRow | null> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, full_name, phone_number, email, pipeline_stage::text as pipeline_stage,
             lead_score, estimated_value_dkk::float as estimated_value_dkk,
             ai_auto_reply_enabled, shared_memory_summary,
             preferred_language, sentiment_score::float as sentiment_score,
             created_at, updated_at
      from contacts
      where id = ${contactId}
      limit 1
    `;
    return (rows[0] as unknown as ContactRow) ?? null;
  });
}

export interface CallLogRow {
  id: string;
  room_name: string;
  status: string;
  created_at: string;
  duration_seconds: number;
  recording_url: string | null;
  recording_status: 'ok' | 'failed' | 'skipped' | null;
  recording_error: string | null;
  recording_bytes: number | null;
  transcript_full: Array<{ role: string; content: string }>;
}

/**
 * Calls for one contact, newest first.
 *
 * `transcript_full` and `recording_url` are the two things that make a voice
 * call reviewable: what was said, and the audio itself. Before this existed the
 * worker wrote neither, so a finished call left no evidence in the portal.
 */
export async function listCallsForContact(
  userId: string,
  contactId: string,
  limit = 10
): Promise<CallLogRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, room_name, status::text as status, created_at, duration_seconds,
             recording_url, recording_status, recording_error,
             recording_bytes::float8 as recording_bytes,
             transcript_full
      from call_logs
      where contact_id = ${contactId}
      order by created_at desc
      limit ${limit}
    `;
    return rows as unknown as CallLogRow[];
  });
}

export interface ProjectEstimateRow {
  id: string;
  project_type: string;
  scope_details: string;
  square_meters: number | null;
  estimated_min_dkk: number;
  estimated_max_dkk: number;
  estimated_value_dkk: number;
  followup_notes: string;
  created_at: string;
}

export async function listProjectEstimates(
  userId: string,
  contactId: string,
  limit = 20,
): Promise<ProjectEstimateRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, project_type, scope_details,
             square_meters::float8 as square_meters,
             estimated_min_dkk::float8 as estimated_min_dkk,
             estimated_max_dkk::float8 as estimated_max_dkk,
             estimated_value_dkk::float8 as estimated_value_dkk,
             followup_notes, created_at
      from project_estimates
      where contact_id = ${contactId}
      order by created_at desc
      limit ${limit}
    `;
    return rows as unknown as ProjectEstimateRow[];
  });
}

export interface InspectionRequestRow {
  id: string;
  requested_time_text: string;
  address: string;
  notes: string;
  status: string;
  created_at: string;
}

export async function listInspectionRequests(
  userId: string,
  contactId: string,
  limit = 20,
): Promise<InspectionRequestRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, requested_time_text, address, notes, status, created_at
      from inspection_requests
      where contact_id = ${contactId}
      order by created_at desc
      limit ${limit}
    `;
    return rows as unknown as InspectionRequestRow[];
  });
}

/** Conversation history for one contact, oldest first (reads like a chat). */
export interface MessageRow {
  id: string;
  direction: string;
  sender: string;
  content: string;
  created_at: string;
}

export async function listMessages(
  userId: string,
  contactId: string,
  limit = 50
): Promise<MessageRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, direction::text as direction, sender::text as sender, content, created_at
      from messages
      where contact_id = ${contactId}
      order by created_at asc
      limit ${limit}
    `;
    return rows as unknown as MessageRow[];
  });
}

export interface TenantOverview {
  contacts: number;
  pipeline_dkk: number;
  booked: number;
  dire: number;
  calls: number;
  messages: number;
}

export interface AgentConfig {
  customer_system_prompt: string;
  copilot_system_prompt: string;
  greeting_script: string | null;
  voice_id: string | null;
  stt_language: string;
  escalation_policy: Record<string, unknown>;
  updated_at: string;
}

export async function getAgentConfig(
  userId: string,
  tenantId: string
): Promise<AgentConfig | null> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select customer_system_prompt, copilot_system_prompt, greeting_script,
             voice_id, stt_language, escalation_policy, updated_at
      from tenant_agent_config
      where tenant_id = ${tenantId}
      limit 1
    `;
    return (rows[0] as unknown as AgentConfig) ?? null;
  });
}

export interface KnowledgeItem {
  id: string;
  category: string;
  title: string;
  content: string;
  priority: number;
  is_active: boolean;
}

export async function listKnowledge(userId: string, tenantId: string): Promise<KnowledgeItem[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, category, title, content, priority, is_active
      from knowledge_items
      where tenant_id = ${tenantId}
      order by priority desc, category, title
    `;
    return rows as unknown as KnowledgeItem[];
  });
}

export interface HistoryEntry {
  id: string;
  customer_system_prompt: string;
  changed_at: string;
}

export interface PublicCallContext {
  contact: {
    id: string;
    tenant_id: string;
    full_name: string | null;
    phone_number: string | null;
    preferred_language: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    reception_mode: string;
    flynumber_did: string | null;
    default_language: string;
  };
}

/**
 * Public, unauthenticated lookup for a customer who opened a call link.
 *
 * Uses adminSql because there is no signed-in user — the caller IS the customer.
 * It deliberately returns the minimum needed to render the call UI: never
 * prompts, never pricing, never other contacts.
 */
export async function getPublicCallContext(contactId: string): Promise<PublicCallContext | null> {
  const rows = await adminSql`
    select c.id, c.tenant_id, c.full_name, c.phone_number,
           c.preferred_language, c.ai_auto_reply_enabled,
           t.name, t.slug, t.status, t.reception_mode, t.flynumber_did, t.default_language::text as default_language
    from contacts c
    join tenants t on t.id = c.tenant_id
    where c.id = ${contactId}
    limit 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    contact: {
      id: row.id as string,
      tenant_id: row.tenant_id as string,
      full_name: (row.full_name as string | null) ?? null,
      phone_number: (row.phone_number as string | null) ?? null,
      preferred_language: (row.preferred_language as string) ?? 'da',
    },
    tenant: {
      id: row.tenant_id as string,
      name: row.name as string,
      slug: row.slug as string,
      status: row.status as string,
      reception_mode: row.reception_mode as string,
      flynumber_did: row.flynumber_did as string | null,
      default_language: row.default_language as string,
    },
  };
}

export async function listConfigHistory(
  userId: string,
  tenantId: string,
  limit = 10
): Promise<HistoryEntry[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, customer_system_prompt, changed_at
      from agent_config_history
      where tenant_id = ${tenantId}
      order by changed_at desc
      limit ${limit}
    `;
    return rows as unknown as HistoryEntry[];
  });
}

export interface OpenEscalation {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  channel: string;
  reason: string;
  urgency: number;
  briefing: string;
  n8n_status: string;
  created_at: string;
}

export async function listOpenEscalations(
  userId: string,
  tenantId: string,
  limit = 5,
): Promise<OpenEscalation[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select e.id, e.contact_id, c.full_name as contact_name,
             e.channel, e.reason, e.urgency, e.briefing, e.n8n_status, e.created_at
      from conversation_escalations e
      left join contacts c on c.id = e.contact_id
      where e.tenant_id = ${tenantId} and e.status <> 'resolved'
      order by e.urgency desc, e.created_at desc
      limit ${limit}
    `;
    return rows as unknown as OpenEscalation[];
  });
}

export async function getTenantOverview(userId: string, tenantId: string): Promise<TenantOverview> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select
        (select count(*)::int from contacts where tenant_id = ${tenantId}) as contacts,
        (select coalesce(sum(estimated_value_dkk), 0)::float from contacts
           where tenant_id = ${tenantId} and pipeline_stage <> 'closed_lost') as pipeline_dkk,
        (select count(*)::int from contacts
           where tenant_id = ${tenantId} and pipeline_stage = 'booked') as booked,
        (select count(*)::int from conversation_escalations
           where tenant_id = ${tenantId} and status <> 'resolved' and urgency >= 4) as dire,
        (select count(*)::int from call_logs where tenant_id = ${tenantId}) as calls,
        (select count(*)::int from messages where tenant_id = ${tenantId}) as messages
    `;
    return rows[0] as unknown as TenantOverview;
  });
}
