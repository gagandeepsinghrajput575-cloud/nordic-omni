import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminSql } from '@/lib/db/client';

const BodySchema = z.object({ attemptId: z.string().uuid() });

/**
 * Marks a browser-side connection failure as missed. The attempt UUID is an
 * unguessable capability returned only to the caller that minted it, and the
 * update cannot touch an attempt that already reached a terminal status.
 */
export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid attempt' }, { status: 400 });
  }

  await adminSql`
    update call_logs
       set status = 'missed', updated_at = now()
     where id = ${parsed.data.attemptId}
       and status in ('ringing', 'in_progress')
  `;
  return NextResponse.json({ success: true });
}
