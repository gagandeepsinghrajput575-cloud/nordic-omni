import postgres from 'postgres';
import { env } from '@/lib/env';

/**
 * Two database connections, deliberately different:
 *
 *   sql       -> connects as `omni_app` (NOT the table owner) so Row Level
 *                Security is enforced on every statement. Every query must run
 *                inside `withUser()` so identity is known.
 *
 *   adminSql  -> connects as the owner and therefore bypasses RLS. Its narrow
 *                allowlist is pre-auth identity, health, server-minted LiveKit
 *                attempts, and validated server-owned estimate/inspection writes.
 *                Never use it for ordinary user-initiated reads or mutations.
 */

const g = globalThis as unknown as {
  __omniSql?: ReturnType<typeof postgres>;
  __omniAdminSql?: ReturnType<typeof postgres>;
};

export const sql =
  g.__omniSql ??
  postgres(env.DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });

export const adminSql =
  g.__omniAdminSql ??
  postgres(env.DATABASE_ADMIN_URL, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });

if (env.NODE_ENV !== 'production') {
  g.__omniSql = sql;
  g.__omniAdminSql = adminSql;
}

export type Tx = postgres.TransactionSql<Record<string, unknown>>;

/** postgres.js v4 no longer infers objects as JSON. Explicit OID 3802 prevents
 * double-encoding JSON strings into JSONB scalar strings (hours/catalog/prompts). */
export function jsonb(value: postgres.JSONValue) { return sql.json(value); }

/**
 * Runs `fn` inside a transaction with `app.user_id` set, which is what the RLS
 * policies read via `current_setting('app.user_id', true)`.
 *
 * Passing `null` sets no identity, so RLS returns nothing — that is the safe
 * default, not an error case.
 */
export async function withUser<T>(
  userId: string | null,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    // Never combine a portal identity with a public-contact capability.
    await tx`select set_config('app.public_contact_id', '', true)`;
    if (userId) {
      // set_config(name, value, is_local=true) is the parameterised form of
      // SET LOCAL, and is scoped to this transaction only.
      await tx`select set_config('app.user_id', ${userId}, true)`;
    }
    return fn(tx as unknown as Tx);
  });

  return result as unknown as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public chat/call access is a single-contact capability, enforced by RLS.
 * The UUID is a capability in the same way as the public URL; policies never
 * trust a separately supplied tenant ID. No owner connection is involved.
 */
export async function withPublicContact<T>(
  contactId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  if (!UUID.test(contactId)) throw new Error('Invalid public contact');
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', '', true)`;
    await tx`select set_config('app.public_contact_id', ${contactId}, true)`;
    return fn(tx as unknown as Tx);
  });
  return result as unknown as T;
}

/** Cheap liveness probe used by /api/health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await adminSql`select 1`;
    return true;
  } catch {
    return false;
  }
}
