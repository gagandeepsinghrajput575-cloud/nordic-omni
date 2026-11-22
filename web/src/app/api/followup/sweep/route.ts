import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/guard';
import { jsonError } from '@/lib/api-utils';
import { sweepPendingFollowups } from '@/lib/followup/sequences';

export const dynamic = 'force-dynamic';

function verifyCronBearer(authHeader: string, cronSecret: string | undefined): boolean {
  if (!cronSecret || !authHeader.startsWith('Bearer ')) return false;
  const provided = authHeader.slice(7).trim();
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(cronSecret, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const authHeader = request.headers.get('Authorization') || '';
  const isCronAuthorized = verifyCronBearer(authHeader, process.env.CRON_SECRET?.trim());

  if (!isCronAuthorized) {
    const session = await apiSession().catch(() => null);
    if (!session) {
      return jsonError('Unauthorized: valid agency session or CRON_SECRET required', 401);
    }
    if (!session.isAgency) {
      return jsonError('Forbidden: agency administrator access required', 403);
    }
  }

  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10) || 50), 200) : 50;

    const processed = await sweepPendingFollowups(limit);
    return NextResponse.json({
      ok: true,
      processedCount: processed.length,
      items: processed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sweep failed';
    return jsonError(message, 500);
  }
}
