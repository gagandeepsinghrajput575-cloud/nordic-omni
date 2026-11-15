import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol';
import { env } from '@/lib/env';
import { apiSession } from '@/lib/auth/guard';
import { adminSql } from '@/lib/db/client';
import {
  LIVEKIT_AGENT_NAME,
  buildParticipantIdentity,
  buildRoomName,
  FixedWindowRateLimiter,
  resolveLiveKitAccess,
} from '@/lib/livekit/policy';
import { liveCallBinding } from '@/lib/telephony/bridge';
import { TELEPHONY_DATA_TOPIC, ownerParticipantIdentity } from '@/lib/telephony/livekit-room';

/** Legacy identity/room fields are accepted but ignored; the server owns them. */
const BodySchema = z.object({
  tenantId: z.string().uuid(),
  roomName: z.string().min(1).max(200).optional(),
  participantIdentity: z.string().min(1).max(200).optional(),
  participantName: z.string().min(1).max(200).optional(),
  role: z.enum(['customer', 'owner_consult', 'owner_merged']).default('customer'),
  contactId: z.string().uuid().optional(),
  /**
   * The bridge's call id. When present the token joins *that* room instead of
   * minting a fresh attempt-scoped one — this is how a human gets onto a live
   * AI call without the two sides inventing different room names.
   */
  telephonySessionId: z.string().min(1).max(120).optional(),
});
const limiter = new FixedWindowRateLimiter(10, 60_000);

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid token request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { tenantId, role: requestedRole, contactId, telephonySessionId } = parsed.data;
  const session = await apiSession();
  const rateKey = session?.userId ?? `${tenantId}:${contactId ?? 'owner'}`;
  if (!limiter.allow(rateKey)) {
    return NextResponse.json({ error: 'Too many call attempts. Try again shortly.' }, { status: 429 });
  }

  const tenantRows = await adminSql`select slug, status, reception_mode from tenants where id = ${tenantId} limit 1`;
  const tenant = tenantRows[0] as { slug?: string; status?: string; reception_mode?: string } | undefined;
  if (tenant?.reception_mode === 'human_forward' && requestedRole === 'customer') {
    return NextResponse.json({ error: 'This workspace forwards phone calls to its team. Call the assigned phone number instead.' }, { status: 409 });
  }
  const contactRows = contactId
    ? await adminSql`select tenant_id, full_name from contacts where id = ${contactId} limit 1`
    : [];
  const contact = contactRows[0] as { tenant_id?: string; full_name?: string | null } | undefined;

  let isTenantOwner = false;
  if (session && !session.isAgency && requestedRole !== 'customer') {
    const ownerRows = await adminSql`
      select 1 from tenant_members
      where user_id = ${session.userId} and tenant_id = ${tenantId} and role = 'owner' limit 1
    `;
    isTenantOwner = ownerRows.length > 0;
  }

  const access = resolveLiveKitAccess({
    tenantId,
    tenantStatus: tenant?.status ?? 'missing',
    contactId,
    contactTenantId: contact?.tenant_id,
    requestedRole,
    session,
    isTenantOwner,
  });
  if (!access.ok || !tenant?.slug) {
    return NextResponse.json(
      { error: access.ok ? 'Tenant not found' : access.error },
      { status: access.ok ? 404 : access.status },
    );
  }

  const attemptId = randomUUID();
  const subjectId = access.role === 'customer' ? access.contactId! : session!.userId;

  /**
   * Joining a live bridge call.
   *
   * The room name is *not* minted here: the bridge already reserved one when the
   * call was dispatched, and a second naming scheme would put the human in a
   * different room from the caller. The binding is process-local, so a call this
   * worker did not answer is refused rather than guessed at — and the tenant check
   * compares against the binding's own grounding, never against the request body.
   */
  const binding = telephonySessionId ? liveCallBinding(telephonySessionId) : null;
  if (telephonySessionId && !binding) {
    return NextResponse.json(
      { error: 'That call is not live in this worker, so there is no room to join.' },
      { status: 409 },
    );
  }
  if (binding && binding.context.grounding.tenantId !== tenantId) {
    return NextResponse.json({ error: 'That call belongs to a different workspace.' }, { status: 403 });
  }
  if (binding && access.role === 'customer') {
    // The caller on a PSTN leg has no session; a browser customer joining a phone
    // call would be a second audio path into the same conversation, and the agent
    // would answer whichever one spoke last.
    return NextResponse.json(
      { error: 'Only a workspace member can join a live phone call.' },
      { status: 409 },
    );
  }

  const roomName = binding ? binding.context.roomName : buildRoomName(tenant.slug, subjectId, attemptId);
  const participantIdentity = binding
    ? ownerParticipantIdentity(subjectId, attemptId)
    : buildParticipantIdentity(access.role, subjectId, attemptId);
  const participantName = access.role === 'customer' ? contact?.full_name || 'Customer' : session!.fullName || 'Owner';

  // Track the attempt even if the browser never reaches the worker.
  if (access.role === 'customer') {
    await adminSql`
      insert into call_logs (id, tenant_id, contact_id, room_name, channel, status)
      values (${attemptId}, ${tenantId}, ${access.contactId!}, ${roomName}, 'voice_instant_webrtc', 'ringing')
    `;
  }

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: participantName,
    ttl: '15m',
    metadata: JSON.stringify({
      tenant_id: tenantId,
      role: access.role,
      contact_id: access.contactId ?? null,
      call_id: access.role === 'customer' ? attemptId : null,
    }),
  });
  // Data channel is opened only for a bridge join: that is how the human sends
  // `request_transfer` / `end_call` on `nordic.telephony.v1`. An ordinary customer
  // token keeps `canPublishData: false`, so nothing new can be injected into a
  // browser call that the orchestrator would have to trust.
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: Boolean(binding),
  });
  at.roomConfig = new RoomConfiguration({
    // Agents are dispatched only for a fresh room. A bridge call already has its
    // receptionist in the room; a second dispatch would give the caller two
    // agents answering each other.
    ...(binding ? {} : { agents: [new RoomAgentDispatch({ agentName: LIVEKIT_AGENT_NAME })] }),
    metadata: JSON.stringify(
      binding
        ? {
            tenant_id: tenantId,
            call_id: attemptId,
            telephony_session_id: telephonySessionId,
            dispatch_rule_id: binding.context.dispatchRuleId,
            data_topic: TELEPHONY_DATA_TOPIC,
          }
        : { tenant_id: tenantId, call_id: attemptId },
    ),
  });

  try {
    const token = await at.toJwt();
    return NextResponse.json({
      success: true,
      token,
      attemptId,
      roomName,
      participantIdentity,
      serverUrl: env.NEXT_PUBLIC_LIVEKIT_URL,
      role: access.role,
      // Echoed only when a live call was actually attached, so a client can tell
      // "joined the receptionist's room" from "started an instant call".
      ...(binding
        ? {
            telephonySessionId,
            dataTopic: TELEPHONY_DATA_TOPIC,
            bargeInBudgetMs: binding.context.grounding.bargeInBudgetMs,
            // Turns recorded so far, so a late joiner knows how much of the call it
            // missed. Not a transcript: the caller's words stay in the ledger.
            turnsRecorded: binding.context.projected,
          }
        : {}),
    });
  } catch (error) {
    if (access.role === 'customer') {
      await adminSql`
        update call_logs set status = 'missed', updated_at = now()
        where id = ${attemptId} and status not in ('completed', 'missed')
      `;
    }
    throw error;
  }
}
