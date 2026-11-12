import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import { adminSql } from '@/lib/db/client';
import { env } from '@/lib/env';
import { verifyPassword } from '@/lib/auth/password';

/**
 * Server-side session cookies.
 *
 * Replaces the old client-side "passkey" modal, which was pure theatre: it
 * validated in the browser, accepted the hardcoded backdoors 'MASTER-AGENCY-KEY'
 * and '8899', and the server had already shipped the whole CRM in the RSC
 * payload before the modal rendered.
 *
 * Sessions are rows in `sessions`, so they can be revoked instantly.
 * The cookie holds `<sessionId>.<hmac>` — tamper-evident, and never a secret.
 */

export const SESSION_COOKIE = 'omni_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string | null;
  isAgency: boolean;
  tenantIds: string[];
  mustChangePassword: boolean;
}

function sign(value: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex');
}

function encodeCookie(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

function decodeCookie(raw: string): string | null {
  const idx = raw.lastIndexOf('.');
  if (idx < 1) return null;

  const sessionId = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  if (mac.length !== 64) return null;

  const expected = sign(sessionId);
  try {
    const a = Buffer.from(mac, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return sessionId;
}

export async function createSession(userId: string, userAgent?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000);

  const rows = await adminSql`
    insert into sessions (user_id, expires_at, user_agent, session_version)
    select ${userId}, ${expiresAt}, ${userAgent ?? null}, coalesce(us.session_version, 0)
    from users u left join user_security us on us.user_id = u.id
    where u.id = ${userId} and u.is_active
      and (exists (select 1 from agency_members where user_id = u.id)
        or coalesce(us.must_change_password, false)
        or exists (select 1 from tenant_members tm join tenants t on t.id = tm.tenant_id
                   where tm.user_id = u.id and t.status = 'active'))
    returning id
  `;
  if (!rows[0]) throw new Error('This account cannot sign in.');

  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeCookie(rows[0].id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const sessionId = decodeCookie(raw);
  if (!sessionId) return null;

  // adminSql is required here: we must read `users` before any identity exists.
  const rows = await adminSql`
    select
      u.id            as user_id,
      u.email,
      u.full_name,
      u.is_active,
      s.expires_at,
      s.session_version,
      coalesce(us.session_version, 0) as current_version,
      coalesce(us.must_change_password, false) as must_change_password,
      exists (select 1 from agency_members am where am.user_id = u.id) as is_agency
    from sessions s
    join users u on u.id = s.user_id
    left join user_security us on us.user_id = u.id
    where s.id = ${sessionId}
    limit 1
  `;

  const row = rows[0];
  if (!row) return null;

  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    await adminSql`delete from sessions where id = ${sessionId}`;
    return null;
  }
  if (!row.is_active || row.session_version !== row.current_version) return null;

  const memberships = await adminSql`
    select tm.tenant_id from tenant_members tm join tenants t on t.id = tm.tenant_id
    where tm.user_id = ${row.user_id} and t.status = 'active'
  `;

  return {
    userId: row.user_id as string,
    email: row.email as string,
    fullName: (row.full_name as string | null) ?? null,
    isAgency: Boolean(row.is_agency),
    tenantIds: row.must_change_password ? [] : memberships.map((m) => m.tenant_id as string),
    mustChangePassword: Boolean(row.must_change_password) && !row.is_agency,
  };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;

  if (raw) {
    const sessionId = decodeCookie(raw);
    if (sessionId) {
      await adminSql`delete from sessions where id = ${sessionId}`;
    }
  }

  jar.delete(SESSION_COOKIE);
}

export async function verifyUserPassword(userId: string, candidate: string): Promise<boolean> {
  const rows = await adminSql`select password_hash from users where id = ${userId}`;
  if (!rows[0]?.password_hash) return false;
  return verifyPassword(candidate, rows[0].password_hash as string);
}

