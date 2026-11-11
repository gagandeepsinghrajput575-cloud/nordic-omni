import { NextResponse } from 'next/server';
import { adminSql } from '@/lib/db/client';
import { LIVEKIT_AGENT_NAME } from '@/lib/livekit/policy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, boolean> = {
    database: false,
    livekit: Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL && process.env.LIVEKIT_API_KEY),
    agent: Boolean(LIVEKIT_AGENT_NAME),
  };

  try {
    await adminSql`select 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  const ok = Object.values(checks).every(Boolean);
  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      checks,
      agent: LIVEKIT_AGENT_NAME,
      at: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
