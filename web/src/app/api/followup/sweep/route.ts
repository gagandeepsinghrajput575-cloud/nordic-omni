import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/guard';
import { jsonError } from '@/lib/api-utils';
import { sweepPendingFollowups } from '@/lib/followup/sequences';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const session = await apiSession().catch(() => null);

  // Allow either signed-in session or system cron bearer token
  const authHeader = request.headers.get('Authorization') || '';
  const cronSecret = process.env.CRON_SECRET || process.env.SESSION_SECRET;
  const isBearerAuthorized =
    !!cronSecret && authHeader.startsWith('Bearer ') && authHeader.slice(7) === cronSecret;

  if (!session && !isBearerAuthorized) {
    return jsonError('Unauthorized: valid session or Bearer token required', 401);
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
