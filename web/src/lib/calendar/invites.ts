import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Public, signed calendar invites.
 *
 * A confirmation SMS is read on a phone that has no session, so the invitation
 * link cannot be an authenticated route. Instead the server mints a short
 * HMAC-signed token and keeps the generated .ics in a bounded in-process cache.
 *
 * Security properties:
 *   - The signature covers the booking id, so a guessed or edited id is rejected
 *     before any lookup happens.
 *   - Comparison is constant-time (`timingSafeEqual`), so the token cannot be
 *     brute-forced by timing.
 *   - The cache is bounded and expires entries, so a leaked link stops working
 *     after the booking plus a grace window.
 *   - Nothing here is authority for data access: the cache only ever returns the
 *     ICS the server itself generated for that id.
 */

const MAX_ENTRIES = 500;
/** Links stay valid for a month after creation: long enough to add the event. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string {
  return process.env.SESSION_SECRET || env.SESSION_SECRET;
}

function sign(bookingId: string): string {
  return createHmac('sha256', secret()).update(bookingId).digest('hex').slice(0, 16);
}

/** `bookingId.sig` — short enough to sit inside one GSM SMS segment. */
export function signBookingToken(bookingId: string): string {
  return `${bookingId}.${sign(bookingId)}`;
}

export function verifyBookingToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const bookingId = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  if (!/^[a-z0-9-]{1,64}$/i.test(bookingId)) return null;
  if (!/^[0-9a-f]{16}$/.test(provided)) return null;
  const expectedBuffer = Buffer.from(sign(bookingId), 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return null;
  return timingSafeEqual(expectedBuffer, providedBuffer) ? bookingId : null;
}

export interface CachedInvite {
  ics: string;
  title: string;
  createdAt: number;
}

interface InviteRegistry {
  entries: Map<string, CachedInvite>;
}

const registry = globalThis as unknown as { __omniCalendarInvites?: InviteRegistry };
const store: InviteRegistry = registry.__omniCalendarInvites ?? { entries: new Map() };
if (process.env.NODE_ENV !== 'production') registry.__omniCalendarInvites = store;

function sweep(now: number): void {
  for (const [id, invite] of store.entries) {
    if (now - invite.createdAt > TTL_MS) store.entries.delete(id);
  }
}

export function cacheInvite(bookingId: string, invite: Omit<CachedInvite, 'createdAt'>): void {
  const now = Date.now();
  sweep(now);
  // Bounded: oldest entry is evicted rather than growing without limit.
  if (store.entries.size >= MAX_ENTRIES) {
    const oldest = Array.from(store.entries.entries()).sort(
      (left, right) => left[1].createdAt - right[1].createdAt,
    )[0];
    if (oldest) store.entries.delete(oldest[0]);
  }
  store.entries.set(bookingId, { ...invite, createdAt: now });
}

export function readInvite(bookingId: string): CachedInvite | null {
  const invite = store.entries.get(bookingId);
  if (!invite) return null;
  if (Date.now() - invite.createdAt > TTL_MS) {
    store.entries.delete(bookingId);
    return null;
  }
  return invite;
}

/** Test seam: clears the cache without touching the signing secret. */
export function clearInvites(): void {
  store.entries.clear();
}
