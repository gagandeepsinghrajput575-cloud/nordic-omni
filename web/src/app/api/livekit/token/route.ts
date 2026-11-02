import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import { env } from '@/lib/env';
import { apiSession } from '@/lib/auth/guard';
import { adminSql } from '@/lib/db/client';

/**
 * Mints a LiveKit access token.
 *
 * Previously this endpoint was completely open: anyone could mint a token for
 * any room name. It now requires EITHER
 *   (a) a signed-in user who belongs to the requested tenant, or
 *   (b) a contactId that actually exists for that tenant (the public call link).
 */

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  roomName: z.string().min(1).max(200),
  participantIdentity: z.string().min(1).max(200),
  participantName: z.string().min(1).max(200),
  role: z.enum(['customer', 'owner_consult', 'owner_merged']),
  contactId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid token request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { tenantId, roomName, participantIdentity, participantName, role, contactId } =
    parsed.data;

  // --- Authorization ---------------------------------------------------------
  // A session takes precedence. The contactId fallback exists ONLY for the
  // anonymous public call link, so that a signed-in user cannot bypass tenant
  // membership by passing someone else's contact id.
  const session = await apiSession();
  let authorized = false;

  if (session) {
    authorized = session.isAgency || session.tenantIds.includes(tenantId);
  } else if (contactId) {
    const rows = await adminSql`
      select 1 from contacts
      where id = ${contactId} and tenant_id = ${tenantId}
      limit 1
    `;
    authorized = rows.length > 0;
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Not authorized for this tenant' }, { status: 403 });
  }

  // --- Room must belong to the tenant ---------------------------------------
  const tenantRows = await adminSql`
    select slug from tenants where id = ${tenantId} limit 1
  `;
  const slug = tenantRows[0]?.slug as string | undefined;

  if (!slug || !roomName.startsWith(`${slug}_`)) {
    return NextResponse.json(
      { error: 'Room name does not belong to this tenant' },
      { status: 400 }
    );
  }

  // --- Mint ------------------------------------------------------------------
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: participantName,
    ttl: '2h',
    metadata: JSON.stringify({
      tenant_id: tenantId,
      tenantId,
      role,
      contact_id: contactId ?? null,
      contactId: contactId ?? null,
    }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return NextResponse.json({
    success: true,
    token: await at.toJwt(),
    roomName,
    participantIdentity,
    serverUrl: env.NEXT_PUBLIC_LIVEKIT_URL,
    role,
  });
}
