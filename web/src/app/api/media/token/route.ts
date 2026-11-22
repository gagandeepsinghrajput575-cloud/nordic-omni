import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/guard';
import { jsonError, readJson } from '@/lib/api-utils';
import { signMediaUploadToken } from '@/lib/media/tokens';
import { getContactTenantIdRecord } from '@/lib/db/trusted-records';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TokenRequestSchema = z.object({
  tenantId: z.string().uuid(),
  contactId: z.string().uuid(),
  ttlSeconds: z.number().int().positive().max(30 * 24 * 3600).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError('Unauthorized', 401);

  const parsed = TokenRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'Invalid request', 400);
  }

  const { tenantId, contactId, ttlSeconds } = parsed.data;

  if (!session.isAgency && !session.tenantIds.includes(tenantId)) {
    return jsonError('Forbidden: workspace mismatch', 403);
  }

  // Verify the contact actually belongs to the target tenant before minting.
  const contactTenantId = await getContactTenantIdRecord(contactId);
  if (!contactTenantId || contactTenantId !== tenantId) {
    return jsonError('Forbidden: contact does not belong to this workspace', 403);
  }

  const token = signMediaUploadToken(tenantId, contactId, ttlSeconds || 7 * 24 * 3600);
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const uploadUrl = `${origin}/media/upload?token=${token}`;

  return NextResponse.json({
    ok: true,
    token,
    uploadUrl,
  });
}
