import { NextRequest, NextResponse } from 'next/server';
import { adminSql } from '@/lib/db/client';
import { FixedWindowRateLimiter } from '@/lib/livekit/policy';
import {
  describeIssues,
  InboundWebhookPayloadSchema,
  type GatewayFailure,
  type GatewaySuccess,
} from '@/lib/webhooks/inbound-contract';
import {
  hashApiKey,
  looksLikeApiKey,
  newDeliveryId,
  readBearer,
  readDeliveryId,
  safeEqualHex,
  verifyInboundSignature,
} from '@/lib/webhooks/inbound-auth';
import { dispatchAgencyAction, resolveActingUser } from '@/lib/webhooks/inbound-dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/v1/agency/webhook — the Universal Agency Inbound & Action Gateway.
 *
 * Order of checks, deliberately:
 *
 *   1. rate limit        (cheapest, and protects everything below it)
 *   2. authenticate      (key or HMAC; both constant-time)
 *   3. replay protection (timestamp window already enforced by the HMAC check,
 *                         plus a delivery-id receipt for HMAC callers)
 *   4. validate          (Zod discriminated union)
 *   5. dispatch          (RLS-scoped handlers)
 *
 * Authentication is checked before validation so an unauthenticated caller
 * cannot use error messages to probe which actions exist.
 */

const limiter = new FixedWindowRateLimiter(120, 60_000);

interface Credential {
  keyUserId: string;
  keyTenantId: string | null;
}

function failure(
  status: number,
  code: GatewayFailure['code'],
  error: string,
  action: GatewayFailure['action'] = null,
  deliveryId?: string,
): NextResponse<GatewayFailure> {
  return NextResponse.json(
    {
      ok: false,
      action,
      code,
      error,
      deliveryId: deliveryId ?? newDeliveryId(),
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

/** Resolve a bearer key against the key table. Owner connection: pre-identity. */
async function authenticateBearer(key: string): Promise<Credential | null> {
  if (!looksLikeApiKey(key)) return null;
  const hash = hashApiKey(key);
  const rows = await adminSql`
    select agency_user_id, tenant_id, key_hash
    from webhook_api_keys
    where key_prefix = ${key.slice(0, 12)}
      and revoked_at is null
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (!safeEqualHex(String(row.key_hash), hash)) return null;

  // Last-used is telemetry, not correctness: a failure here must not deny a
  // valid request.
  adminSql`update webhook_api_keys set last_used_at = now() where key_prefix = ${key.slice(0, 12)}`
    .catch(() => undefined);

  return {
    keyUserId: String(row.agency_user_id),
    keyTenantId: row.tenant_id ? String(row.tenant_id) : null,
  };
}

/**
 * HMAC callers are identified by the key whose secret signed the request.
 * Secrets live per key row, so we look up candidates by the signing key id the
 * caller advertises, then verify. Without a key id we cannot know which secret
 * to use, and trying every secret would be a timing oracle.
 */
async function authenticateSignature(args: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  keyId: string | null;
  now: number;
}): Promise<{ credential: Credential; deliveryId: string | null } | { error: string }> {
  if (!args.keyId) return { error: 'HMAC requests must send X-OMNI-Key-Id.' };

  const rows = await adminSql`
    select agency_user_id, tenant_id, key_hash, hmac_secret
    from webhook_api_keys
    where key_prefix = ${args.keyId}
      and revoked_at is null
    limit 1
  `;
  const row = rows[0];
  if (!row || !row.hmac_secret) return { error: 'Unknown or revoked key.' };

  const verdict = verifyInboundSignature({
    rawBody: args.rawBody,
    signature: args.signature,
    timestamp: args.timestamp,
    secret: String(row.hmac_secret),
    now: args.now,
  });
  if (!verdict.ok) {
    return {
      error:
        verdict.reason === 'stale'
          ? 'Timestamp is outside the five-minute replay window.'
          : verdict.reason === 'missing'
            ? 'X-OMNI-Signature and X-OMNI-Timestamp are required.'
            : 'Signature does not match the request body.',
    };
  }

  return {
    credential: {
      keyUserId: String(row.agency_user_id),
      keyTenantId: row.tenant_id ? String(row.tenant_id) : null,
    },
    deliveryId: args.keyId,
  };
}

/** Returns true when this delivery id has already been seen inside the window. */
async function claimDelivery(deliveryId: string, action: string, keyPrefix: string): Promise<boolean> {
  const rows = await adminSql`
    insert into webhook_inbound_receipts (delivery_id, key_prefix, action)
    values (${deliveryId}, ${keyPrefix}, ${action})
    on conflict (delivery_id) do nothing
    returning delivery_id
  `;
  return Boolean(rows[0]);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const now = Date.now();

  // 1. Rate limit. Keyed on the credential when known, else on the peer address,
  //    so one noisy integration cannot starve another.
  const claimed = readBearer(request.headers.get('authorization'));
  const limiterKey = claimed
    ? `key:${claimed.slice(0, 16)}`
    : `ip:${request.headers.get('x-forwarded-for') ?? 'unknown'}`;
  if (!limiter.allow(limiterKey, now)) {
    return failure(429, 'rate_limited', 'Too many requests. Try again shortly.');
  }

  // The raw body must be read once and verified byte-for-byte.
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return failure(400, 'invalid_payload', 'The request body could not be read.');
  }

  // 2. Authenticate.
  let credential: Credential | null = null;
  let signerKeyId: string | null = null;

  if (claimed) {
    credential = await authenticateBearer(claimed).catch(() => null);
    if (!credential) {
      return failure(401, 'unauthorized', 'Invalid or revoked API key.');
    }
  } else {
    const signature = request.headers.get('x-omni-signature');
    const timestamp = request.headers.get('x-omni-timestamp');
    signerKeyId = request.headers.get('x-omni-key-id');
    const result = await authenticateSignature({
      rawBody,
      signature,
      timestamp,
      keyId: signerKeyId,
      now,
    }).catch(() => ({ error: 'Authentication failed.' }));

    if ('error' in result) {
      return failure(401, 'unauthorized', result.error);
    }
    credential = result.credential;
  }

  // 3. Parse and validate. Parsing before validation so the envelope can be
  //    echoed back on a schema error.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return failure(400, 'invalid_payload', 'Body must be valid JSON.');
  }

  const parsed = InboundWebhookPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const rawAction =
      typeof parsedJson === 'object' && parsedJson !== null && 'action' in parsedJson
        ? String((parsedJson as { action: unknown }).action)
        : null;
    const knownAction = rawAction && rawAction.length < 40 ? (rawAction as never) : null;
    return failure(
      422,
      rawAction ? 'invalid_payload' : 'invalid_payload',
      describeIssues(parsed.error.issues) || 'The payload did not match any known action.',
      knownAction,
    );
  }

  const action = parsed.data.action;

  // 4. Replay protection for HMAC callers: a signed delivery id may be used once
  //    inside the timestamp window.
  if (signerKeyId) {
    const deliveryId = readDeliveryId(request.headers.get('x-omni-delivery')) ?? newDeliveryId();
    const fresh = await claimDelivery(deliveryId, action, signerKeyId).catch(() => false);
    if (!fresh) {
      return failure(409, 'replay', 'This delivery id has already been processed.', action, deliveryId);
    }
  }

  // 5. Resolve the acting identity and dispatch.
  const requestedTenantId =
    'tenantId' in parsed.data && typeof parsed.data.tenantId === 'string' ? parsed.data.tenantId : null;

  const resolved = await resolveActingUser({
    keyUserId: credential.keyUserId,
    keyTenantId: credential.keyTenantId,
    requestedTenantId,
  }).catch(() => ({ ok: false as const, code: 'internal' as const, error: 'Workspace lookup failed.' }));

  if (!resolved.ok) {
    const status = resolved.code === 'not_found' ? 404 : resolved.code === 'conflict' ? 409 : 500;
    return failure(status, resolved.code, resolved.error, action);
  }

  const outcome = await dispatchAgencyAction(parsed.data, resolved.context);

  const deliveryId = newDeliveryId();
  if (!outcome.ok) {
    const status =
      outcome.code === 'not_found' ? 404 : outcome.code === 'conflict' ? 409 : outcome.code === 'upstream' ? 502 : 500;
    return failure(status, outcome.code, outcome.error, action, deliveryId);
  }

  const body: GatewaySuccess = {
    ok: true,
    action,
    deliveryId,
    timestamp: new Date().toISOString(),
    data: outcome.data,
  };
  return NextResponse.json(body, { status: 200 });
}

/** A GET is a documentation probe, not a data endpoint. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/v1/agency/webhook',
    method: 'POST',
    authentication: [
      'Authorization: Bearer <api-key>',
      'X-OMNI-Key-Id + X-OMNI-Timestamp + X-OMNI-Signature: sha256=<HMAC of `timestamp.rawBody`>',
    ],
    actions: [
      'fetch_leads', 'fetch_calls', 'fetch_clients', 'fetch_client_detail',
      'fetch_calendar_slots', 'fetch_metrics', 'create_lead', 'dispatch_call',
      'send_sms', 'book_appointment', 'update_client', 'ask_copilot',
    ],
  });
}
