import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export { WEBHOOK_EVENTS, type WebhookEventType } from './events';

export function newWebhookSecret(): string { return randomBytes(32).toString('hex'); }

/** Verify against the exact bytes received, never a reserialized JSON object. */
export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signedHeaders(rawBody: string, secret: string, deliveryId: string, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'Nordic-Omni-Webhooks/1.0',
    'X-OMNI-Delivery': deliveryId,
    'X-OMNI-Timestamp': timestamp,
    'X-OMNI-Signature': `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`,
  };
}

export function envelope(eventType: string, tenantId: string | null, data: unknown, eventId = randomUUID()) {
  return { id: eventId, type: eventType, tenantId, createdAt: new Date().toISOString(), data };
}

export function retryDelay(attempt: number): number {
  return Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}
