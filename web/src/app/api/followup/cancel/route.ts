import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/guard';
import { jsonError, readJson } from '@/lib/api-utils';
import { cancelPendingFollowups } from '@/lib/followup/sequences';
import { getContactTenantIdRecord } from '@/lib/db/trusted-records';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const CancelSchema = z.object({
  contactId: z.string().uuid(),
  reason: z.string().min(1).max(250).default('manual_cancellation'),
});

export async function POST(request: Request): Promise<Response> {
  const session = await apiSession().catch(() => null);
  if (!session) {
    return jsonError('Unauthorized: please sign in', 401);
  }

  const parsed = CancelSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'Invalid payload', 400);
  }

  const { contactId, reason } = parsed.data;

  // Verify contact exists and belongs to the caller's tenant
  const contactTenantId = await getContactTenantIdRecord(contactId);
  if (!contactTenantId) {
    return jsonError('Contact not found', 404);
  }
  if (!session.isAgency && !session.tenantIds.includes(contactTenantId)) {
    return jsonError('Forbidden: contact belongs to another workspace', 403);
  }

  try {
    const cancelledCount = await cancelPendingFollowups(session.userId, contactId, reason);
    return NextResponse.json({
      ok: true,
      contactId,
      cancelledCount,
      reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cancellation failed';
    return jsonError(message, 500);
  }
}
