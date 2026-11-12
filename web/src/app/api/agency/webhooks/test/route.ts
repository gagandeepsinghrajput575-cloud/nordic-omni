import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiRequireAgency } from '@/lib/auth/guard';
import { testWebhook } from '@/lib/webhooks/dispatcher';
import { FixedWindowRateLimiter } from '@/lib/livekit/policy';

export const dynamic = 'force-dynamic';
const limiter = new FixedWindowRateLimiter(10, 60_000);

export async function POST(request: NextRequest) {
  const session = await apiRequireAgency();
  if (!session) return NextResponse.json({ error: 'Agency access required.' }, { status: 403 });
  if (!limiter.allow(session.userId)) return NextResponse.json({ error: 'Please wait before sending another test.' }, { status: 429 });
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid endpoint.' }, { status: 400 });
  const result = await testWebhook(session.userId, parsed.data.id);
  return NextResponse.json(result, { status: result.ok ? 200 : result.error === 'Endpoint not found or agency access required.' ? 404 : 502 });
}
