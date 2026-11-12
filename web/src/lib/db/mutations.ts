import { withUser, jsonb } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';

/**
 * Write functions. Every one runs inside withUser(), so `app.user_id` is set and
 * Row Level Security decides whether the write is allowed. Nothing here
 * re-implements authorization in TypeScript — if RLS denies, the statement
 * affects zero rows or raises. That is the whole point.
 */

/** Thrown when a unique constraint fires. Actions turn this into a field error. */
export class DuplicateError extends Error {
  readonly field: string;
  constructor(field: string, message = 'That value already exists.') {
    super(message);
    this.name = 'DuplicateError';
    this.field = field;
  }
}

/** Maps Postgres errors to something an action can render without leaking SQL. */
export function rethrow(e: unknown): never {
  const err = e as { code?: string; constraint_name?: string };
  if (err?.code === '23505') {
    const c = err.constraint_name ?? '';
    const field = c.includes('phone') ? 'phone_number' : c.includes('slug') ? 'slug' : 'value';
    throw new DuplicateError(field);
  }
  if (err?.code === '42501') {
    throw new Error('Not permitted.');
  }
  throw e;
}

/* ------------------------------------------------------------- Contacts --- */

export interface NewContactInput {
  fullName: string;
  phoneNumber: string | null;
  email: string | null;
  preferredLanguage: 'da' | 'en';
  preferredChannel: string;
  pipelineStage: string;
  leadScore: number;
  estimatedValueDkk: number;
  sharedMemorySummary: string;
}

export async function createContact(
  userId: string,
  tenantId: string,
  input: NewContactInput
): Promise<{ id: string }> {
  return withUser(userId, async (tx) => {
    try {
      const rows = await tx`
        insert into contacts (
          tenant_id, full_name, phone_number, email, preferred_language,
          preferred_channel, pipeline_stage, lead_score, estimated_value_dkk,
          shared_memory_summary
        ) values (
          ${tenantId}, ${input.fullName}, ${input.phoneNumber || null}, ${input.email || null},
          ${input.preferredLanguage}, ${input.preferredChannel}::channel_type,
          ${input.pipelineStage}::pipeline_stage, ${input.leadScore},
          ${input.estimatedValueDkk}, ${input.sharedMemorySummary}
        )
        returning id
      `;
      return { id: rows[0].id as string };
    } catch (e) {
      rethrow(e);
    }
  });
}

/**
 * Partial update. `null` means "leave alone"; pass an explicit value to change.
 * `ai_auto_reply_enabled = false` also stamps `last_human_takeover_at`, which is
 * what the agent reads to decide it must stay silent.
 */
export async function updateContact(
  userId: string,
  contactId: string,
  patch: Partial<NewContactInput> & { aiAutoReplyEnabled?: boolean }
): Promise<number> {
  const stage = patch.pipelineStage ?? null;
  return withUser(userId, async (tx) => {
    try {
      const rows = await tx`
        update contacts set
          full_name              = coalesce(${patch.fullName ?? null}, full_name),
          phone_number           = coalesce(${patch.phoneNumber ?? null}, phone_number),
          email                  = coalesce(${patch.email ?? null}, email),
          preferred_language     = coalesce(${patch.preferredLanguage ?? null}, preferred_language),
          pipeline_stage         = coalesce(${stage}::pipeline_stage, pipeline_stage),
          lead_score             = coalesce(${patch.leadScore ?? null}, lead_score),
          estimated_value_dkk    = coalesce(${patch.estimatedValueDkk ?? null}, estimated_value_dkk),
          shared_memory_summary  = coalesce(${patch.sharedMemorySummary ?? null}, shared_memory_summary),
          ai_auto_reply_enabled  = coalesce(${patch.aiAutoReplyEnabled ?? null}, ai_auto_reply_enabled),
          last_human_takeover_at = case
            when ${patch.aiAutoReplyEnabled ?? null} = false then now()
            else last_human_takeover_at
          end,
          updated_at             = now()
        where id = ${contactId}
        returning id
      `;
      return rows.length;
    } catch (e) {
      rethrow(e);
    }
  });
}

export async function deleteContact(userId: string, contactId: string): Promise<number> {
  return withUser(userId, async (tx) => {
    const rows = await tx`delete from contacts where id = ${contactId} returning id`;
    return rows.length;
  });
}

/* --------------------------------------------------------------- Tenant --- */

export interface NewTenantInput {
  name: string;
  slug: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  defaultLanguage: 'da-DK' | 'en-US';
  did?: string | null;
  initialPassword: string;
}

/**
 * Creates the workspace and its agent config **in one transaction**, so a
 * half-provisioned client can never exist. Both inserts pass RLS as agency
 * staff (`tenants_agency_insert`, `agent_config_agency_write`).
 *
 * It fabricates nothing: no invented owner, no invented opening hours, no
 * placeholder contacts. Compare with the provisioning wizard this replaces,
 * which always returned `Lars Henriksen` and inserted a fake test lead.
 */
export async function createTenantWithAgent(
  userId: string,
  input: NewTenantInput
): Promise<{ id: string; slug: string }> {
  return withUser(userId, async (tx) => {
    try {
      const danish = input.defaultLanguage === 'da-DK';

      const businessPrompt = danish
        ? `Du er den indgående AI-receptionist for ${input.name}. Du tager imod opkald, ` +
          `forstår kundens problem, giver priser fra priskataloget og booker en tid, når ` +
          `kunden bekræfter. Du er kortfattet, venlig og professionel.`
        : `You are the inbound AI receptionist for ${input.name}. You take calls, understand ` +
          `the customer's problem, quote prices from the price catalogue and book an ` +
          `appointment once the customer confirms. Be brief, warm and professional.`;

      const copilotPrompt = danish
        ? `Du er co-pilot for ejeren af ${input.name}. Svar kort på dansk, og brug værktøjerne til at slå kunder og opkald op.`
        : `You are the co-pilot for the owner of ${input.name}. Answer briefly, and use the tools to look up customers and calls.`;

      const greeting = danish
        ? `Hej, du er kommet til ${input.name}. Hvordan kan jeg hjælpe?`
        : `Hi, you have reached ${input.name}. How can I help?`;

      const escalation = {
        emergencies: danish
          ? ['vandskade', 'sprunget rør', 'oversvømmelse', 'akutt']
          : ['water damage', 'burst pipe', 'flooding', 'urgent'],
        always_escalate_on_human_request: true,
        escalate_outside_opening_hours: false,
      };

      // Empty hours and empty price list on purpose: the client fills them in.
      const tenants = await tx`
        insert into tenants (
          name, slug, owner_name, owner_phone, owner_email, default_language,
          business_hours, pricing_catalog, status
        ) values (
          ${input.name}, ${input.slug}, ${input.ownerName}, ${input.ownerPhone},
          ${input.ownerEmail}, ${input.defaultLanguage}, '{}'::jsonb, '[]'::jsonb, 'active'
        )
        returning id, slug
      `;

      const tenantId = tenants[0].id as string;
      if (input.did) await tx`update tenants set flynumber_did = ${input.did} where id = ${tenantId}`;
      const passwordHash = hashPassword(input.initialPassword);
      await tx`select provision_tenant_member(${tenantId}, ${input.ownerEmail}, ${passwordHash}, ${input.ownerName}, 'owner', true)`;

      await tx`
        insert into tenant_agent_config (
          tenant_id, customer_system_prompt, copilot_system_prompt,
          greeting_script, escalation_policy, stt_language, updated_by
        ) values (
          ${tenantId}, ${businessPrompt}, ${copilotPrompt}, ${greeting},
          ${jsonb(escalation)}, ${danish ? 'da' : 'en'}, ${userId}
        )
      `;

      return { id: tenantId, slug: tenants[0].slug as string };
    } catch (e) {
      rethrow(e);
    }
  });
}

/* ---------------------------------------------------------------- Facts --- */

export interface TenantFactsPatch {
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  /** `null` clears the broadcast; `undefined` leaves it untouched. */
  activeBroadcastMessage?: string | null;
  businessHours?: Record<string, { open: string; close: string; closed: boolean }>;
  pricingCatalog?: import('@/lib/estimation').CatalogItem[];
}

/**
 * Client-editable facts. Permitted by `tenants_client_update` for the tenant
 * owner, and by the same policy for agency staff. Behaviour columns are absent
 * from this function entirely — they live in `tenant_agent_config`.
 */
export async function updateTenantFacts(
  userId: string,
  tenantId: string,
  patch: TenantFactsPatch
): Promise<number> {
  const hasBroadcast = patch.activeBroadcastMessage !== undefined;
  const broadcast = patch.activeBroadcastMessage ?? null;
  const hours = patch.businessHours ? jsonb(patch.businessHours) : null;
  const prices = patch.pricingCatalog ? jsonb(patch.pricingCatalog) : null;

  return withUser(userId, async (tx) => {
    const rows = await tx`
      update tenants set
        owner_name               = coalesce(${patch.ownerName ?? null}, owner_name),
        owner_phone              = coalesce(${patch.ownerPhone ?? null}, owner_phone),
        owner_email              = coalesce(${patch.ownerEmail ?? null}, owner_email),
        active_broadcast_message = case
          when ${hasBroadcast} then ${broadcast}
          else active_broadcast_message
        end,
        business_hours           = coalesce(${hours}::jsonb, business_hours),
        pricing_catalog          = coalesce(${prices}::jsonb, pricing_catalog),
        updated_at               = now()
      where id = ${tenantId}
      returning id
    `;
    return rows.length;
  });
}

/* ------------------------------------------------------------ Knowledge --- */

export interface KnowledgeInput {
  title: string;
  content: string;
  category: string;
  priority: number;
}

export async function createKnowledgeItem(
  userId: string,
  tenantId: string,
  item: KnowledgeInput
): Promise<{ id: string }> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      insert into knowledge_items (tenant_id, title, content, category, priority)
      values (${tenantId}, ${item.title}, ${item.content}, ${item.category}, ${item.priority})
      returning id
    `;
    return { id: rows[0].id as string };
  });
}

export async function updateKnowledgeItem(
  userId: string,
  itemId: string,
  item: KnowledgeInput
): Promise<number> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      update knowledge_items set
        title = ${item.title},
        content = ${item.content},
        category = ${item.category},
        priority = ${item.priority},
        updated_at = now()
      where id = ${itemId}
      returning id
    `;
    return rows.length;
  });
}

export async function deleteKnowledgeItem(userId: string, itemId: string): Promise<number> {
  return withUser(userId, async (tx) => {
    const rows = await tx`delete from knowledge_items where id = ${itemId} returning id`;
    return rows.length;
  });
}


