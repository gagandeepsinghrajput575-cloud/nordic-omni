import { apiRequireTenant } from '@/lib/auth/guard';
import { jsonError, readJson } from '@/lib/api-utils';
import { PostChatMessageSchema } from '@/contracts/schemas';
import {
  appendChatMessage,
  findOpenDelegation,
  getChatState,
  listChatMessages,
  recordDelegationAnswer,
} from '@/lib/db/client-chat';
import { buildCopilotContext } from '@/lib/copilot/context';
import { respondToClient, summariseDelegationAnswer } from '@/lib/copilot/engine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/chat
 *
 * The client's own thread. The tenant is taken from the session and never from
 * a query parameter — a portal user has exactly one workspace, and passing a
 * different `tenantId` is refused by `apiRequireTenant`.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = url.searchParams.get('tenantId') ?? '';
  const session = await apiRequireTenant(requested);
  if (!session) return jsonError('Adgang nægtet', 403);

  const tenantId = requested || session.tenantIds[0];
  if (!tenantId) return jsonError('Ingen arbejdsrum i sessionen', 403);
  const contactId = url.searchParams.get('contactId');

  try {
    const [messages, state] = await Promise.all([
      listChatMessages(session.userId, tenantId, { contactId }),
      getChatState(session.userId, tenantId),
    ]);
    return Response.json({ messages, state });
  } catch {
    return jsonError('Chatten kunne ikke læses. Prøv igen.', 503);
  }
}

/**
 * POST /api/portal/chat
 *
 * A client message, followed by the co-pilot's automated reply loop.
 *
 * Two things are deliberately strict here:
 *
 *  1. The role is stamped `client` regardless of the request body. A client can
 *     never post as the agency operator.
 *
 *  2. If the agency has taken the conversation over (`aiEnabled === false`), no
 *     automated reply is generated at all. The co-pilot does not talk over a
 *     human who is already answering.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const requested = typeof body.tenantId === 'string' ? body.tenantId : '';
  const session = await apiRequireTenant(requested);
  if (!session) return jsonError('Adgang nægtet', 403);

  const tenantId = requested || session.tenantIds[0];
  if (!tenantId) return jsonError('Ingen arbejdsrum i sessionen', 403);

  const parsed = PostChatMessageSchema.safeParse({
    body: body.body,
    kind: body.kind ?? 'message',
    delegationId: body.delegationId ?? null,
  });
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'Ugyldig besked', 422);
  }

  const contactId = typeof body.contactId === 'string' ? body.contactId : null;

  // 1. Persist the client's own message first, so it is never lost to a
  //    downstream failure in the co-pilot path.
  const clientMessage = await appendChatMessage(session.userId, {
    tenantId,
    contactId,
    senderRole: 'client',
    senderRef: session.userId,
    channel: 'web_chat',
    kind: parsed.data.kind,
    body: parsed.data.body,
  });

  // 2. If this message answers an open delegation, capture it and summarise for
  //    the operator. This happens even when the AI is muted — the operator asked
  //    for an answer and must still receive it.
  const openDelegation = await findOpenDelegation(session.userId, tenantId, contactId);
  // Computed once and reused in the response, so the stored row and the JSON the
  // operator sees cannot drift apart.
  const delegationSummary = openDelegation
    ? summariseDelegationAnswer(openDelegation.question ?? '', parsed.data.body)
    : null;
  if (openDelegation && delegationSummary) {
    await recordDelegationAnswer(
      session.userId,
      openDelegation.id,
      parsed.data.body,
      delegationSummary,
      false,
    );
  }

  // 3. The auto-reply loop, gated on the human-takeover latch.
  const state = await getChatState(session.userId, tenantId);
  if (!state.aiEnabled) {
    return Response.json({ ok: true, message: clientMessage, replied: false, state });
  }

  const copilot = await buildCopilotContext(session.userId, tenantId, 'da-DK');
  if (!copilot) {
    // No grounded context means no grounded answer. Stay silent rather than
    // improvisie; the operator still sees the client's message.
    return Response.json({ ok: true, message: clientMessage, replied: false, state });
  }

  const reply = respondToClient(copilot, parsed.data.body);
  const aiMessage = await appendChatMessage(session.userId, {
    tenantId,
    contactId,
    senderRole: 'ai_copilot',
    senderRef: null,
    channel: 'web_chat',
    kind: 'message',
    body: reply.body,
    metadata: {
      intent: reply.intent,
      needsAgencyInput: reply.needsAgencyInput,
      ...(reply.mutation ? { stagedMutation: reply.mutation } : {}),
    },
  });

  return Response.json({
    ok: true,
    message: clientMessage,
    reply: aiMessage,
    replied: true,
    intent: reply.intent,
    // The client is told when we could not ground an answer, so the promise to
    // check with the operator is visible in the UI, not just in the text.
    needsAgencyInput: reply.needsAgencyInput,
    stagedMutation: reply.mutation,
    delegationAnswered:
      openDelegation && delegationSummary
        ? { id: openDelegation.id, summary: delegationSummary }
        : null,
    state,
  });
}
