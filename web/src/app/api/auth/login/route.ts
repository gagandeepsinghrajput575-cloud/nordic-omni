import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminSql } from '@/lib/db/client';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { FixedWindowRateLimiter } from '@/lib/livekit/policy';

const BodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

// Per-process brute-force budgets. The edge/proxy should add a second layer.
const ipLimiter = new FixedWindowRateLimiter(30, 15 * 60_000);
const emailLimiter = new FixedWindowRateLimiter(10, 15 * 60_000);

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid login payload' }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  if (!ipLimiter.allow(clientIp(req)) || !emailLimiter.allow(normalizedEmail)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': '900' } }
    );
  }

  // adminSql: must read `users` before any identity exists (RLS needs app.user_id).
  const rows = await adminSql`
    select u.id, u.password_hash, u.is_active,
      exists (select 1 from agency_members am where am.user_id = u.id) as is_agency,
      coalesce(us.must_change_password, false) as must_change_password
    from users u left join user_security us on us.user_id = u.id
    where lower(u.email) = lower(${email})
    limit 1
  `;

  const user = rows[0];

  // Always perform a scrypt comparison, even when the user is missing, so that
  // response timing does not reveal whether an email exists.
  const storedHash =
    (user?.password_hash as string | undefined) ??
    `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
  const passwordOk = verifyPassword(password, storedHash);

  if (!user || !passwordOk || !user.is_active) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  if (!user.is_agency) {
    const active = await adminSql`
      select 1 from tenant_members tm join tenants t on t.id = tm.tenant_id
      where tm.user_id = ${user.id} and t.status = 'active' limit 1
    `;
    if (!active[0]) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }
  await createSession(user.id as string, req.headers.get('user-agent') ?? undefined);
  return NextResponse.json({ success: true, mustChangePassword: Boolean(user.must_change_password) && !user.is_agency });
}
