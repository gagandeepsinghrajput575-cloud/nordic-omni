import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Authentication for the Universal Inbound Gateway.
 *
 * Two credential types, both constant-time compared:
 *
 *   1. Bearer API key    — `Authorization: Bearer omni_live_<random>`
 *   2. HMAC signature    — `X-OMNI-Signature: sha256=<hmac of `timestamp.rawBody`>`
 *
 * The HMAC scheme is deliberately identical to the outbound one already in
 * `protocol.ts`, so a receiver that verifies our deliveries can verify our
 * inbound requests with the same code.
 *
 * Replay protection has two halves:
 *   - a timestamp window (default 300s), which bounds the attack to that window
 *   - a delivery-id receipt, which makes reuse impossible inside the window
 * Neither alone is sufficient: timestamps without receipts allow replay within
 * the window, receipts without timestamps allow unbounded storage growth.
 */

/** Seconds of clock skew tolerated on `X-OMNI-Timestamp`. */
export const REPLAY_WINDOW_SECONDS = 300;

const KEY_PREFIX = 'omni_live_';

export interface GeneratedApiKey {
  /** Returned to the operator exactly once. Never stored. */
  key: string;
  /** Stored and displayed so a key can be identified without being revealed. */
  prefix: string;
  /** Stored. A fast hash is correct here: the key is high-entropy, not a password. */
  hash: string;
}

/**
 * 32 random bytes = 256 bits of entropy. Because the secret is not
 * user-chosen, a plain SHA-256 is the right storage primitive — bcrypt on a
 * random 256-bit value only slows down the server, not an attacker.
 */
export function generateApiKey(): GeneratedApiKey {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { key, prefix: keyPrefixOf(key), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** The first 12 characters: enough to identify, useless to guess from. */
export function keyPrefixOf(key: string): string {
  return key.slice(0, 12);
}

/** Shape check before touching the database, so junk keys cost nothing. */
export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX) && value.length >= 40 && value.length <= 128;
}

/**
 * Constant-time comparison of two hex digests. Length is checked first because
 * `timingSafeEqual` throws on mismatched lengths, and a length leak on a
 * *hash* reveals nothing about the secret.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** Extract a bearer token, tolerating case and surrounding whitespace. */
export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// -----------------------------------------------------------------------------
// HMAC
// -----------------------------------------------------------------------------

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, hex encoded, `sha256=` prefixed. */
export function computeSignature(timestamp: string, rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

/**
 * Verify a signature against the exact bytes received.
 *
 * `now` is injected so the window is testable without sleeping, and so a
 * caller can pass a database-derived clock if it ever needs to.
 */
export function verifyInboundSignature(args: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  now?: number;
  windowSeconds?: number;
}): SignatureVerdict {
  const { rawBody, signature, timestamp, secret } = args;
  const now = args.now ?? Date.now();
  const window = args.windowSeconds ?? REPLAY_WINDOW_SECONDS;

  if (!signature || !timestamp) return { ok: false, reason: 'missing' };

  // Timestamps are integer seconds; anything else is not something we issued.
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'malformed' };

  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'malformed' };
  if (Math.abs(now - sentAt) > window * 1000) return { ok: false, reason: 'stale' };

  const expected = computeSignature(timestamp, rawBody, secret);
  // Compare the hex digests, not the prefixed strings, for a constant-time path.
  const given = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const wanted = expected.slice(7);
  if (!safeEqualHex(given.toLowerCase(), wanted)) return { ok: false, reason: 'mismatch' };

  return { ok: true };
}

/**
 * A delivery id is required for HMAC callers so the receipt table has a key.
 * Bearer callers get a server-minted id instead, because they are not
 * replay-sensitive in the same way (the key itself is the credential).
 */
export function readDeliveryId(header: string | null): string | null {
  if (!header) return null;
  const value = header.trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : null;
}

export function newDeliveryId(): string {
  return `dlv_${randomBytes(12).toString('hex')}`;
}
