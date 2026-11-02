import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminSql } from '@/lib/db/client';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';

const BodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid login payload' }, { status: 400 });
  }

  const { email, password } = parsed.data;

  // adminSql: must read `users` before any identity exists (RLS needs app.user_id).
  const rows = await adminSql`
    select id, password_hash, is_active
    from users
    where lower(email) = lower(${email})
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

  await createSession(user.id as string, req.headers.get('user-agent') ?? undefined);

  return NextResponse.json({ success: true });
}
