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

/** Legacy identity/room fields are accepted but ignored; the server owns them. */
const BodySchema = z.object({
  tenantId: z.string().uuid(),
  roomName: z.string().min(1).max(200).optional(),
  participantIdentity: z.string().min(1).max(200).optional(),
  participantName: z.string().min(1).max(200).optional(),
  role: z.enum(['customer', 'owner_consult', 'owner_merged']).default('customer'),
  contactId: z.string().uuid().optional(),
});
const limiter = new FixedWindowRateLimiter(10, 60_000);

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid token request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { tenantId, role: requestedRole, contactId } = parsed.data;
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
  const roomName = buildRoomName(tenant.slug, subjectId, attemptId);
  const participantIdentity = buildParticipantIdentity(access.role, subjectId, attemptId);
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
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: false });
  at.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: LIVEKIT_AGENT_NAME })],
    metadata: JSON.stringify({ tenant_id: tenantId, call_id: attemptId }),
  });

  try {
    const token = await at.toJwt();
    return NextResponse.json({ success: true, token, attemptId, roomName, participantIdentity, serverUrl: env.NEXT_PUBLIC_LIVEKIT_URL, role: access.role });
  } catch (error) {
    if (access.role === 'customer') {
      await adminSql`update call_logs set status = 'missed', updated_at = now() where id = ${attemptId}`;
    }
    throw error;
  }
}
