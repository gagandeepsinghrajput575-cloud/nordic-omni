import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

export interface MediaUploadTokenPayload {
  tenantId: string;
  contactId: string;
  exp: number; // unix timestamp in seconds
}

function getSecret(): string {
  return process.env.SESSION_SECRET || env.SESSION_SECRET;
}

function computeSignature(data: string): string {
  return createHmac('sha256', getSecret()).update(data).digest('hex').slice(0, 32);
}

/**
 * Mint a signed upload token: `base64url(payload).signature`
 * Default expiry: 7 days.
 */
export function signMediaUploadToken(
  tenantId: string,
  contactId: string,
  ttlSeconds: number = 7 * 24 * 3600,
): string {
  const payload: MediaUploadTokenPayload = {
    tenantId,
    contactId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = computeSignature(encoded);
  return `${encoded}.${sig}`;
}

export function verifyMediaUploadToken(token: string): MediaUploadTokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const encoded = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  if (!/^[a-zA-Z0-9_-]+$/.test(encoded)) return null;
  if (!/^[0-9a-f]{32}$/.test(providedSig)) return null;

  const expectedSig = computeSignature(encoded);
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const providedBuf = Buffer.from(providedSig, 'utf8');

  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MediaUploadTokenPayload;
    if (!payload.tenantId || !payload.contactId || typeof payload.exp !== 'number') {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
