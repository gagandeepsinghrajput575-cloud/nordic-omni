/**
 * Persistence for the agency <-> client chat bridge.
 *
 * Every function takes an authenticated `userId` and goes through `withUser`, so
 * RLS decides visibility. This module never touches the owner-pool binding:
 * `web/test/rls-contract.test.ts` pins the owner-pool importer allowlist, and a
 * chat read has no business bypassing tenant isolation. That test flags any file
 * containing the binding's identifier, comments included, so it is never named
 * here.
 *
 * `sender_role` is a parameter of the *insert* function rather than a field of
 * the caller's payload, and the routes pass a literal derived from the session.
 * A client request body can never reach this argument.
 */

import { withUser } from '@/lib/db/client';
import type {
  AgencyClientMessage,
  ChatChannel,
  ChatState,
  CopilotDelegation,
  CopilotDelegationStatus,
  MessageKind,
  SenderRole,
} from '@/contracts/schemas';

// -----------------------------------------------------------------------------
// Row shapes (snake_case, as Postgres returns them)
// -----------------------------------------------------------------------------

interface MessageRow {
  id: string;
  tenant_id: string;
  sender_role: SenderRole;
  sender_ref: string | null;
  channel: ChatChannel;
  kind: MessageKind;
  body: string;
  delegation_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface DelegationRow {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  status: CopilotDelegationStatus;
  instruction: string;
  topic: string | null;
  question: string | null;
  answer: string | null;
  summary: string | null;
  needs_agency_input: boolean;
  created_at: string;
  resolved_at: string | null;
}

interface ChatStateRow {
  tenant_id: string;
  ai_enabled: boolean;
  paused_reason: string | null;
  updated_at: string;
}

function toMessage(row: MessageRow): AgencyClientMessage {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    senderRole: row.sender_role,
    senderRef: row.sender_ref,
    channel: row.channel,
    kind: row.kind,
    body: row.body,
    delegationId: row.delegation_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function toDelegation(row: DelegationRow): CopilotDelegation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    status: row.status,
    instruction: row.instruction,
    topic: row.topic,
    question: row.question,
    answer: row.answer,
    summary: row.summary,
    needsAgencyInput: row.needs_agency_input,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

/**
 * Read a thread. `contactId` narrows to one client's conversation; passing null
 * returns the tenant-wide firehose the agency console shows.
 *
 * `limit` is clamped so a caller cannot ask for the whole table.
 */
export async function listChatMessages(
  userId: string,
  tenantId: string,
  options: { contactId?: string | null; limit?: number; sinceId?: string | null } = {},
): Promise<AgencyClientMessage[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
  const contactId = options.contactId ?? null;

  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, tenant_id, sender_role, sender_ref, channel, kind, body,
             delegation_id, metadata, created_at
      from agency_client_messages
      where tenant_id = ${tenantId}
        and (${contactId}::uuid is null or contact_id = ${contactId}::uuid)
      order by created_at asc
      limit ${limit}
    `;
    return (rows as unknown as MessageRow[]).map(toMessage);
  });
}

/**
 * Append a message. The `senderRole` argument is a literal chosen by the calling
 * route from the session — never read out of a request body.
 */
export async function appendChatMessage(
  userId: string,
  input: {
    tenantId: string;
    contactId: string | null;
    senderRole: SenderRole;
    senderRef: string | null;
    channel: ChatChannel;
    kind: MessageKind;
    body: string;
    delegationId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<AgencyClientMessage> {
  const metadata = input.metadata ?? {};

  return withUser(userId, async (tx) => {
    const rows = await tx`
      insert into agency_client_messages
        (tenant_id, contact_id, sender_role, sender_ref, channel, kind, body, delegation_id, metadata)
      values (
        ${input.tenantId}, ${input.contactId}, ${input.senderRole}::chat_sender_role,
        ${input.senderRef}, ${input.channel}, ${input.kind}::chat_message_kind,
        ${input.body}, ${input.delegationId ?? null}, ${tx.json(metadata)}::jsonb
      )
      returning id, tenant_id, sender_role, sender_ref, channel, kind, body,
                delegation_id, metadata, created_at
    `;
    const row = (rows as unknown as MessageRow[])[0];
    if (!row) throw new Error('message insert returned no row');
    return toMessage(row);
  });
}

// -----------------------------------------------------------------------------
// Takeover latch
// -----------------------------------------------------------------------------

/**
 * Read the per-tenant AI latch.
 *
 * A missing row means "never touched", which defaults to enabled — matching the
 * column default and the tenant's own `ai_auto_reply_default` semantics.
 */
export async function getChatState(userId: string, tenantId: string): Promise<ChatState> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select tenant_id, ai_enabled, paused_reason, updated_at
      from agency_client_chat_state
      where tenant_id = ${tenantId}
    `;
    const row = (rows as unknown as ChatStateRow[])[0];
    if (!row) {
      return {
        tenantId,
        aiEnabled: true,
        pausedReason: null,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      tenantId: row.tenant_id,
      aiEnabled: row.ai_enabled,
      pausedReason: row.paused_reason,
      updatedAt: row.updated_at,
    };
  });
}

/** Flip the latch. Upsert so the first toggle creates the row. */
export async function setChatAiEnabled(
  userId: string,
  tenantId: string,
  enabled: boolean,
  pausedReason: string | null,
): Promise<ChatState> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      insert into agency_client_chat_state (tenant_id, ai_enabled, paused_reason, updated_by, updated_at)
      values (${tenantId}, ${enabled}, ${pausedReason}, ${userId}, now())
      on conflict (tenant_id) do update
        set ai_enabled = excluded.ai_enabled,
            paused_reason = excluded.paused_reason,
            updated_by = excluded.updated_by,
            updated_at = now()
      returning tenant_id, ai_enabled, paused_reason, updated_at
    `;
    const row = (rows as unknown as ChatStateRow[])[0];
    if (!row) throw new Error('chat state upsert returned no row');
    return {
      tenantId: row.tenant_id,
      aiEnabled: row.ai_enabled,
      pausedReason: row.paused_reason,
      updatedAt: row.updated_at,
    };
  });
}

// -----------------------------------------------------------------------------
// Delegations
// -----------------------------------------------------------------------------

export async function createDelegation(
  userId: string,
  input: {
    tenantId: string;
    contactId: string | null;
    instruction: string;
    topic: string | null;
    question: string;
  },
): Promise<CopilotDelegation> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      insert into copilot_delegations
        (tenant_id, contact_id, status, instruction, topic, question, created_by)
      values (
        ${input.tenantId}, ${input.contactId}, 'sent',
        ${input.instruction}, ${input.topic}, ${input.question}, ${userId}
      )
      returning id, tenant_id, contact_id, status, instruction, topic, question,
                answer, summary, needs_agency_input, created_at, resolved_at
    `;
    const row = (rows as unknown as DelegationRow[])[0];
    if (!row) throw new Error('delegation insert returned no row');
    return toDelegation(row);
  });
}

export async function listDelegations(
  userId: string,
  tenantId: string,
  limit = 50,
): Promise<CopilotDelegation[]> {
  const clamped = Math.min(Math.max(limit, 1), 200);
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, tenant_id, contact_id, status, instruction, topic, question,
             answer, summary, needs_agency_input, created_at, resolved_at
      from copilot_delegations
      where tenant_id = ${tenantId}
      order by created_at desc
      limit ${clamped}
    `;
    return (rows as unknown as DelegationRow[]).map(toDelegation);
  });
}

/** The delegatee's reply, captured and summarised. */
export async function recordDelegationAnswer(
  userId: string,
  delegationId: string,
  answer: string,
  summary: string,
  needsAgencyInput: boolean,
): Promise<CopilotDelegation | null> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      update copilot_delegations
         set status = 'answered',
             answer = ${answer},
             summary = ${summary},
             needs_agency_input = ${needsAgencyInput},
             resolved_at = now()
       where id = ${delegationId}
      returning id, tenant_id, contact_id, status, instruction, topic, question,
                answer, summary, needs_agency_input, created_at, resolved_at
    `;
    const row = (rows as unknown as DelegationRow[])[0];
    return row ? toDelegation(row) : null;
  });
}

export async function closeDelegation(
  userId: string,
  delegationId: string,
): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      update copilot_delegations set status = 'closed'
       where id = ${delegationId} and status <> 'closed'
      returning id
    `;
    return (rows as unknown as Array<{ id: string }>).length > 0;
  });
}

/**
 * Find the open delegation a client message is most likely answering.
 *
 * Only `sent` delegations count: a `pending` one was never delivered, so a reply
 * cannot belong to it.
 */
export async function findOpenDelegation(
  userId: string,
  tenantId: string,
  contactId: string | null,
): Promise<CopilotDelegation | null> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, tenant_id, contact_id, status, instruction, topic, question,
             answer, summary, needs_agency_input, created_at, resolved_at
      from copilot_delegations
      where tenant_id = ${tenantId}
        and status = 'sent'
        and (${contactId}::uuid is null or contact_id = ${contactId}::uuid)
      order by created_at desc
      limit 1
    `;
    const row = (rows as unknown as DelegationRow[])[0];
    return row ? toDelegation(row) : null;
  });
}
