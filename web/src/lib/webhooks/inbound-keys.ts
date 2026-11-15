import 'server-only';

import { randomBytes } from 'node:crypto';
import { withUser } from '@/lib/db/client';
import { generateApiKey, type GeneratedApiKey } from './inbound-auth';

/**
 * Agency-side management of inbound gateway credentials.
 *
 * Every function runs through `withUser`, so the agency RLS policy on
 * `webhook_api_keys` is what authorises the operation — not a check in this
 * file. That matters because a server action is reachable by anyone with a
 * session; RLS is the part that cannot be forgotten.
 */

export interface ApiKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  tenant_id: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  has_hmac: boolean;
}

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  return withUser(userId, async (tx) => {
    return await tx`
      select id, name, key_prefix, tenant_id, created_at, last_used_at, revoked_at,
             (hmac_secret is not null) as has_hmac
      from webhook_api_keys
      order by created_at desc
      limit 50
    ` as unknown as ApiKeySummary[];
  });
}

/**
 * Mint a key. Returns the plaintext exactly once — it is never stored and can
 * never be recovered, so the UI must show it immediately and clearly.
 */
export async function mintApiKey(
  userId: string,
  input: { name: string; tenantId: string | null },
): Promise<{ id: string; key: string; prefix: string }> {
  const generated: GeneratedApiKey = generateApiKey();
  // A separate HMAC secret: the bearer key and the signing secret are different
  // credentials, so losing one does not compromise the other.
  const hmacSecret = randomBytes(32).toString('hex');

  const rows = await withUser(userId, async (tx) => {
    return await tx`
      insert into webhook_api_keys
        (agency_user_id, tenant_id, name, key_prefix, key_hash, hmac_secret, created_by)
      values
        (${userId}, ${input.tenantId}, ${input.name}, ${generated.prefix},
         ${generated.hash}, ${hmacSecret}, ${userId})
      returning id
    `;
  });

  const id = rows[0]?.id as string | undefined;
  if (!id) throw new Error('The key could not be created.');
  return { id, key: generated.key, prefix: generated.prefix };
}

/** Revoke rather than delete, so the audit trail survives. */
export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const rows = await withUser(userId, async (tx) => {
    return await tx`
      update webhook_api_keys set revoked_at = now()
      where id = ${id} and revoked_at is null
      returning id
    `;
  });
  return Boolean(rows[0]);
}

/** Rotate: revoke the old key and mint a replacement with the same name. */
export async function rotateApiKey(
  userId: string,
  id: string,
): Promise<{ key: string; prefix: string } | null> {
  const existing = await withUser(userId, async (tx) => {
    return await tx`
      select name, tenant_id from webhook_api_keys where id = ${id} limit 1
    `;
  });
  const row = existing[0];
  if (!row) return null;

  const revoked = await revokeApiKey(userId, id);
  if (!revoked) return null;

  const minted = await mintApiKey(userId, {
    name: `${String(row.name)} (rotated)`,
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
  });
  return { key: minted.key, prefix: minted.prefix };
}
