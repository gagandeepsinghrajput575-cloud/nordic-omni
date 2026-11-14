import { apiRequireAgency } from '@/lib/auth/guard';
import { jsonError, readJson } from '@/lib/api-utils';
import {
  CopilotDelegationRequestSchema,
  PostChatMessageSchema,
  SenderRoleSchema,
  type CopilotDelegation,
  type SenderRole,
} from '@/contracts/schemas';
import {
  appendChatMessage,
  closeDelegation,
  createDelegation,
  getChatState,
  listChatMessages,
  listDelegations,
  setChatAiEnabled,
} from '@/lib/db/client-chat';
import { buildCopilotContext } from '@/lib/copilot/context';
import { buildDelegationQuestion } from '@/lib/copilot/engine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agency/clients/[id]/chat
 *
 * The agency operator's view of one client thread: messages, delegations, and
 * whether the co-pilot is currently muted.
 *
 * `[id]` is the tenant. Agency-only: a portal session cannot read another
 * tenant's history even by guessing the UUID, because `apiRequireAgency` gates
 * the route and RLS scopes the query a second time.
 *
 * Query: `?contactId=<uuid>` narrows to one client's thread.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await apiRequireAgency();
  if (!session) return jsonError('Agency access required', 403);

  const { id } = await context.params;
  const url = new URL(request.url);
  const contactId = url.searchParams.get('contactId');

  try {
    const [messages, delegations, state] = await Promise.all([
      listChatMessages(session.userId, id, { contactId }),
      listDelegations(session.userId, id),
      getChatState(session.userId, id),
    ]);
    return Response.json({ messages, delegations, state });
  } catch {
    // A failed read is reported as such. Returning an empty thread would look
    // like "this client never wrote to you", which is a different claim.
    return jsonError('Chatten kunne ikke læses. Prøv igen.', 503);
  }
}

/**
 * POST /api/agency/clients/[id]/chat
 *
 * Three intents, discriminated by `action`:
 *
 *   - `message`    — post as the agency operator
 *   - `delegation` — hand a Danish instruction to the co-pilot
 *   - `toggle_ai`  — mute/unmute the co-pilot for this tenant
 *
 * The sender role is never read from the body. Whatever the caller sends, an
 * agency session posts as `agency_operator`; the co-pilot only ever appears via
 * its own actions.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await apiRequireAgency();
  if (!session) return jsonError('Agency access required', 403);

  const { id: tenantId } = await context.params;
  const body = await readJson(request);
  const action = typeof body.action === 'string' ? body.action : 'message';

  if (action === 'toggle_ai') {
    const enabled = body.enabled === true;
    const state = await setChatAiEnabled(
      session.userId,
      tenantId,
      enabled,
      enabled ? null : 'Agenten har overtaget samtalen.',
    );
    return Response.json({ ok: true, state });
  }

  if (action === 'delegation') {
    const parsed = CopilotDelegationRequestSchema.safeParse({
      instruction: body.instruction,
      contactId: body.contactId ?? null,
      channel: body.channel ?? 'web_chat',
      topic: body.topic ?? null,
    });
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? 'Ugyldig instruks', 422);
    }

    const copilot = await buildCopilotContext(session.userId, tenantId, 'da-DK');
    if (!copilot) return jsonError('Arbejdsrummet blev ikke fundet', 404);

    const contactName = typeof body.contactName === 'string' ? body.contactName : null;
    const { question, topic } = buildDelegationQuestion(
      copilot,
      parsed.data.instruction,
      contactName,
    );

    const delegation = await createDelegation(session.userId, {
      tenantId,
      contactId: parsed.data.contactId ?? null,
      instruction: parsed.data.instruction,
      topic: parsed.data.topic ?? topic,
      question,
    });

    // The question goes into the thread as the co-pilot's own utterance, so the
    // client sees a coherent conversation rather than an out-of-band blast.
    const message = await appendChatMessage(session.userId, {
      tenantId,
      contactId: delegation.contactId,
      senderRole: 'ai_copilot',
      senderRef: null,
      channel: parsed.data.channel,
      kind: 'delegation',
      body: question,
      delegationId: delegation.id,
    });

    return Response.json({ ok: true, delegation, message }, { status: 201 });
  }

  // Default: a plain operator message.
  const parsed = PostChatMessageSchema.safeParse({
    body: body.body,
    kind: body.kind ?? 'message',
    delegationId: body.delegationId ?? null,
  });
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'Ugyldig besked', 422);
  }

  // Invariant #3: an operator speaking takes the conversation over. The latch is
  // cleared only by an explicit toggle, so the co-pilot cannot talk over a human.
  const senderRole: SenderRole = 'agency_operator';
  // Belt and braces: this literal must remain a valid role.
  SenderRoleSchema.parse(senderRole);

  const message = await appendChatMessage(session.userId, {
    tenantId,
    contactId: typeof body.contactId === 'string' ? body.contactId : null,
    senderRole,
    senderRef: session.userId,
    channel: 'portal',
    kind: parsed.data.kind,
    body: parsed.data.body,
    delegationId: parsed.data.delegationId ?? null,
  });

  const state = await setChatAiEnabled(
    session.userId,
    tenantId,
    false,
    'Agenten har overtaget samtalen.',
  );

  return Response.json({ ok: true, message, state }, { status: 201 });
}

/** PATCH closes a delegation out once the operator has what they needed. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await apiRequireAgency();
  if (!session) return jsonError('Agency access required', 403);

  await context.params; // tenant id is enforced by RLS on the update itself
  const body = await readJson(request);
  const delegationId = typeof body.delegationId === 'string' ? body.delegationId : '';
  if (!delegationId) return jsonError('delegationId mangler', 422);

  const closed = await closeDelegation(session.userId, delegationId);
  if (!closed) return jsonError('Opgaven blev ikke fundet', 404);

  const delegation: CopilotDelegation | null = null;
  return Response.json({ ok: true, closed, delegation });
}
