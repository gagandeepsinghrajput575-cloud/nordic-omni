import type { TelephonyLanguage } from './types';
import { isDanish } from './types';

/**
 * Cal.com slot synchronisation.
 *
 * Two clocks have to agree before a receptionist may promise a time: Cal.com,
 * which owns the practitioner's real availability, and the tenant's own hold
 * ledger, which knows about slots a *concurrent call* grabbed in the last few
 * milliseconds. Cal.com cannot see those — its own event type has not changed — so
 * the bridge treats the remote grid as the candidate set and the local holds as a
 * subtraction. Never the other way round: promising a slot the owner already
 * booked is worse than being conservative about one they freed a minute ago.
 *
 * **API.** Cal.com v2 (`https://api.cal.com/v2`), `Authorization: Bearer …` plus
 * the `cal-api-version` date header, which the API requires: without it a request
 * is interpreted against whatever the current default is, and a slot shape change
 * on their side silently becomes a bug in this build.
 *
 *   GET  /v2/slots?startTime&endTime&eventTypeId[&timeZone][&slotCount]
 *   POST /v2/bookings            { start, eventTypeId, attendee: {…} }
 *
 * A database or provider that is unreachable reports itself as unavailable. An
 * empty availability grid would read as "totally free" to the model and produce
 * bookings nobody can honour, so every failure path here returns `ok: false` with
 * an empty list rather than a plausible-looking schedule.
 */

export const CALCOM_DEFAULT_BASE_URL = 'https://api.cal.com/v2';
export const CALCOM_API_VERSION_HEADER = 'cal-api-version';
export const CALCOM_API_VERSION = '2024-08-13';

/** How far ahead the bridge may promise a slot, and how soon "soon" means. */
export const DEFAULT_HORIZON_DAYS = 14;
export const DEFAULT_LEAD_MS = 30 * 60 * 1000;
export const DEFAULT_SLOT_MINUTES = 30;

/** A slot is stale after this long: re-sync before offering it on a live call. */
export const SLOT_TTL_MS = 90_000;

export interface CalComEnvironment {
  readonly CALCOM_API_URL?: string;
  readonly CALCOM_API_KEY?: string;
  readonly CALCOM_EVENT_TYPE_ID?: string;
  readonly CALCOM_EVENT_SLUG?: string;
  readonly CALCOM_TIMEZONE?: string;
}

export type CalComConfig =
  | {
      readonly configured: false;
      readonly reason: 'missing_api_key' | 'missing_event_type';
      readonly message: string;
      readonly baseUrl: string;
    }
  | {
      readonly configured: true;
      readonly baseUrl: string;
      readonly apiKey: string;
      readonly eventTypeId: number;
      readonly eventSlug: string | null;
      readonly timeZone: string;
      readonly slotMinutes: number;
    };

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveCalComConfig(
  environment: CalComEnvironment,
  tenant: { readonly calcomEventTypeId?: string | null; readonly timeZone?: string | null } = {},
): CalComConfig {
  const baseUrl = (trimmed(environment.CALCOM_API_URL) || CALCOM_DEFAULT_BASE_URL).replace(/\/+$/u, '');
  const apiKey = trimmed(environment.CALCOM_API_KEY);
  if (!apiKey) {
    return {
      configured: false,
      reason: 'missing_api_key',
      baseUrl,
      message:
        'CALCOM_API_KEY is not set. Availability is served from the tenant hold ledger only, and the receptionist never promises a time it cannot verify.',
    };
  }
  const rawEvent = trimmed(tenant.calcomEventTypeId) || trimmed(environment.CALCOM_EVENT_TYPE_ID);
  const eventTypeId = Number.parseInt(rawEvent, 10);
  if (!rawEvent || !Number.isFinite(eventTypeId) || eventTypeId <= 0) {
    return {
      configured: false,
      reason: 'missing_event_type',
      baseUrl,
      message:
        'No Cal.com event type is pinned to this workspace. Set CALCOM_EVENT_TYPE_ID (or the workspace override) before slot synchronisation is enabled.',
    };
  }
  return {
    configured: true,
    baseUrl,
    apiKey,
    eventTypeId,
    eventSlug: trimmed(environment.CALCOM_EVENT_SLUG) || null,
    timeZone: trimmed(tenant.timeZone) || trimmed(environment.CALCOM_TIMEZONE) || 'Europe/Copenhagen',
    slotMinutes: DEFAULT_SLOT_MINUTES,
  };
}

// -----------------------------------------------------------------------------
// Slots
// -----------------------------------------------------------------------------

export interface TimeInterval {
  readonly startIso: string;
  readonly endIso: string;
}

export interface CalComSlot extends TimeInterval {
  readonly startMs: number;
  readonly endMs: number;
  /** The day key Cal.com grouped this slot under, in the requested time zone. */
  readonly dayKey: string;
  readonly durationMinutes: number;
}

export interface SlotQuery {
  readonly fromIso: string;
  readonly toIso: string;
  readonly timeZone?: string;
  readonly slotCount?: number;
}

export function buildSlotsUrl(config: Extract<CalComConfig, { configured: true }>, query: SlotQuery): string {
  const url = new URL(`${config.baseUrl}/slots`);
  url.searchParams.set('startTime', query.fromIso);
  url.searchParams.set('endTime', query.toIso);
  url.searchParams.set('eventTypeId', String(config.eventTypeId));
  url.searchParams.set('timeZone', query.timeZone ?? config.timeZone);
  if (query.slotCount && query.slotCount > 0) url.searchParams.set('slotCount', String(query.slotCount));
  return url.toString();
}

export function calComHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    [CALCOM_API_VERSION_HEADER]: CALCOM_API_VERSION,
  };
}

export function defaultQueryWindow(
  nowMs: number = Date.now(),
  horizonDays: number = DEFAULT_HORIZON_DAYS,
): SlotQuery {
  const from = new Date(nowMs);
  const to = new Date(nowMs + Math.max(1, Math.min(60, horizonDays)) * 86_400_000);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isoOf(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = typeof value === 'number' ? new Date(value * (value > 1e11 ? 1 : 1000)) : new Date(value);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? parsed.toISOString() : null;
}

/**
 * Accept both documented shapes and nothing else.
 *
 * `GET /v2/slots` groups by day (`{ "2024-01-15": [{ time }] }`); the availability
 * endpoint returns a flat `[{ start, end }]`. Cal.com's own `duration` field is
 * honoured when present, because a 15-minute consult and a 45-minute survey are
 * different events on the same slug.
 */
export function parseSlotsPayload(payload: unknown, fallbackDurationMinutes: number): CalComSlot[] {
  const out: CalComSlot[] = [];

  const push = (
    startIso: string | null,
    endIso: string | null,
    dayKey: string,
    durationMinutes: number,
  ): void => {
    if (!startIso) return;
    const startMs = Date.parse(startIso);
    if (!Number.isFinite(startMs)) return;
    const end = endIso ?? new Date(startMs + Math.max(5, durationMinutes) * 60_000).toISOString();
    const endMs = Date.parse(end);
    // A zero-length or backwards slot is a provider bug, and booking one is how a
    // tenant ends up with a calendar entry the desk cannot honour.
    if (!Number.isFinite(endMs) || endMs <= startMs) return;
    out.push({
      startIso,
      endIso: end,
      startMs,
      endMs,
      dayKey,
      durationMinutes: Math.max(5, Math.round((endMs - startMs) / 60_000)),
    });
  };

  const readFlat = (entries: readonly unknown[], dayKey: string): void => {
    for (const entry of entries) {
      if (typeof entry === 'string') {
        push(isoOf(entry), null, dayKey, fallbackDurationMinutes);
        continue;
      }
      const row = asRecord(entry);
      if (!row) continue;
      push(
        isoOf(row.start ?? row.time),
        isoOf(row.end),
        dayKey,
        typeof row.duration === 'number' ? row.duration : fallbackDurationMinutes,
      );
    }
  };

  // Three shapes are in the wild. `GET /v2/slots` groups by day
  // (`{ slots: { '2026-02-03': [{ time }] } }`), the availability endpoint returns a
  // flat `[{ start, end }]`, and both may arrive wrapped in `{ data: … }`. Anything
  // else produces an empty grid, which the caller reports as "no answer" rather than
  // "no availability".
  const root = Array.isArray(payload) ? { data: payload } : asRecord(payload);
  if (!root) return [];
  const data = asRecord(root.data) ?? root;
  const slots = data.slots;

  if (Array.isArray(root.data) && slots === undefined) {
    readFlat(root.data, '');
    return out.sort((a, b) => a.startMs - b.startMs);
  }

  if (Array.isArray(slots)) {
    readFlat(slots, '');
  } else {
    const grouped = asRecord(slots);
    if (grouped) {
      for (const [dayKey, entries] of Object.entries(grouped)) {
        if (!Array.isArray(entries)) continue;
        readFlat(entries, dayKey);
      }
    }
  }

  return out.sort((a, b) => a.startMs - b.startMs);
}

export interface SubtractOptions {
  readonly nowMs: number;
  readonly minLeadMs?: number;
  readonly limit?: number;
}

/**
 * Remove anything the tenant already holds, plus anything too soon to promise.
 *
 * `slotsOverlap` uses half-open intervals: a hold ending at 10:00 and a slot
 * starting at 10:00 do not collide, and treating them as a collision is how a
 * receptionist ends up saying "that time is taken" about a free quarter hour.
 */
export function subtractBusy(
  slots: readonly CalComSlot[],
  busy: readonly TimeInterval[],
  options: SubtractOptions,
): CalComSlot[] {
  const minLeadMs = Math.max(0, options.minLeadMs ?? DEFAULT_LEAD_MS);
  const earliest = options.nowMs + minLeadMs;
  const limit = Math.max(1, Math.min(500, options.limit ?? 96));
  const ranges = busy
    .map((interval) => ({ start: Date.parse(interval.startIso), end: Date.parse(interval.endIso) }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start);

  const free: CalComSlot[] = [];
  for (const slot of slots) {
    if (slot.startMs < earliest) continue;
    if (ranges.some((range) => slot.startMs < range.end && range.start < slot.endMs)) continue;
    free.push(slot);
    if (free.length >= limit) break;
  }
  return free;
}

export function chooseEarliest(slots: readonly CalComSlot[]): CalComSlot | null {
  return slots.length > 0 ? slots[0] ?? null : null;
}

/**
 * Offer text, in the language the caller is hearing.
 *
 * A number the caller cannot read back is a mis-booked appointment, so the
 * formatter keeps the weekday and the 24-hour time the Danes use, and always
 * names the zone — "kl. 9" across a DST boundary is a different meeting.
 */
export function formatSlotOffer(slot: CalComSlot, language: TelephonyLanguage, timeZone: string): string {
  const locale = isDanish(language) ? 'da-DK' : 'en-GB';
  const when = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(slot.startMs));
  const suffix = isDanish(language) ? ` (${timeZone})` : ` (${timeZone})`;
  return `${when}${suffix}`;
}

// -----------------------------------------------------------------------------
// Synchronisation
// -----------------------------------------------------------------------------

export type SlotSyncSource = 'calcom' | 'unconfigured' | 'provider_error' | 'invalid_response';

export interface SlotSyncResult {
  readonly ok: boolean;
  readonly source: SlotSyncSource;
  readonly slots: readonly CalComSlot[];
  readonly fetchedAtIso: string;
  readonly staleAfterMs: number;
  readonly error: string | null;
  /** True when the provider answered but the local ledger emptied the grid. */
  readonly allHeldLocally: boolean;
}

export interface HttpRequestInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export interface SyncDeps {
  readonly fetchImpl: (url: string, init: HttpRequestInit) => Promise<Response>;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}

function syncFailure(source: SlotSyncSource, message: string, nowMs: number): SlotSyncResult {
  return {
    ok: false,
    source,
    slots: [],
    fetchedAtIso: new Date(nowMs).toISOString(),
    // Fail fast and retry: a stalled provider must not freeze availability for a
    // whole call, but hammering it while it is down is how a tenant gets rate
    // limited out of the window the next caller needs.
    staleAfterMs: 15_000,
    error: message,
    allHeldLocally: false,
  };
}

/**
 * One availability sync.
 *
 * `busy` is the tenant ledger (live holds + confirmed bookings) supplied by the
 * caller, because reading it needs an RLS-scoped transaction and this module must
 * stay usable from a test with no database at all.
 */
export async function syncSlots(
  config: CalComConfig,
  deps: SyncDeps,
  query: SlotQuery,
  busy: readonly TimeInterval[],
): Promise<SlotSyncResult> {
  const nowMs = deps.now?.() ?? Date.now();
  if (!config.configured) return syncFailure('unconfigured', config.message, nowMs);

  let response: Response;
  try {
    response = await deps.fetchImpl(buildSlotsUrl(config, query), {
      method: 'GET',
      headers: calComHeaders(config.apiKey),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch {
    return syncFailure('provider_error', 'Cal.com is unreachable', nowMs);
  }

  if (!response.ok) {
    return syncFailure(
      'provider_error',
      response.status === 401 || response.status === 403
        ? 'Cal.com rejected the API key'
        : `Cal.com availability request failed (${response.status})`,
      nowMs,
    );
  }

  const remote = parseSlotsPayload(await response.json().catch(() => null), config.slotMinutes);
  if (remote.length === 0) {
    return syncFailure('invalid_response', 'Cal.com returned no slot grid', nowMs);
  }

  const free = subtractBusy(remote, busy, { nowMs, minLeadMs: DEFAULT_LEAD_MS });
  return {
    ok: true,
    source: 'calcom',
    slots: free,
    fetchedAtIso: new Date(nowMs).toISOString(),
    staleAfterMs: SLOT_TTL_MS,
    error: null,
    allHeldLocally: free.length === 0,
  };
}

// -----------------------------------------------------------------------------
// Booking
// -----------------------------------------------------------------------------

export interface Attendee {
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly language: TelephonyLanguage;
}

export interface BookingMetadata {
  readonly tenantId: string;
  readonly callId: string;
  readonly contactId: string | null;
  readonly source: 'voice_receptionist';
  readonly recordedBy: string;
}

export interface BookingPayload {
  readonly start: string;
  readonly end?: string;
  readonly eventTypeId: number;
  readonly attendee: {
    readonly name: string;
    readonly email: string;
    readonly timeZone: string;
    readonly locale: string;
    readonly phoneNumber?: string;
  };
  readonly metadata: Record<string, string>;
}

/**
 * Cal.com requires a valid email on `attendee.email` (a blank one is a 400), but a
 * PSTN caller rarely gives one to a receptionist. A deterministic reply-to address
 * derived from the caller's number keeps the booking legal and traceable without
 * inventing an identity for the person.
 */
export function attendeeEmail(attendee: Attendee): string {
  const explicit = (attendee.email ?? '').trim();
  if (explicit) return explicit;
  const digits = (attendee.phone ?? '').replace(/\D/g, '');
  const local = digits.length >= 4 ? `caller-${digits.slice(-4)}` : `caller-${digits.length || 'unknown'}`;
  return `${local}@phone.caller.invalid`;
}

/**
 * Stable per (call, slot) key.
 *
 * A caller who asks "wait, can we do the next slot instead?" gets a different key
 * and therefore a different booking; a retried request after a 500 gets the same
 * key, which is the whole point — the bridge never books the same promise twice.
 */
export function bookingIdempotencyKey(tenantId: string, callId: string, startIso: string): string {
  const compact = startIso.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return `omni:${tenantId.slice(0, 8)}:${callId.slice(0, 12)}:${compact}`;
}

export function buildBookingPayload(
  config: Extract<CalComConfig, { configured: true }>,
  slot: CalComSlot,
  attendee: Attendee,
  metadata: BookingMetadata,
): BookingPayload {
  const digits = (attendee.phone ?? '').replace(/\D/g, '');
  return {
    start: slot.startIso,
    end: slot.endIso,
    eventTypeId: config.eventTypeId,
    attendee: {
      name: attendee.name.trim() || (isDanish(attendee.language) ? 'Opkald fra kunde' : 'Caller'),
      email: attendeeEmail(attendee),
      timeZone: config.timeZone,
      locale: isDanish(attendee.language) ? 'da' : 'en',
      ...(digits ? { phoneNumber: `+${digits.replace(/^0+/, '')}` } : {}),
    },
    metadata: {
      source: metadata.source,
      tenant_id: metadata.tenantId,
      call_id: metadata.callId,
      ...(metadata.contactId ? { contact_id: metadata.contactId } : {}),
      recorded_by: metadata.recordedBy,
      idempotency_key: bookingIdempotencyKey(metadata.tenantId, metadata.callId, slot.startIso),
    },
  };
}

export type BookingResult =
  | {
      readonly ok: true;
      readonly bookingUid: string;
      readonly status: string;
      readonly needsConfirmation: boolean;
      readonly meetingUrl: string | null;
      readonly startIso: string | null;
      readonly endIso: string | null;
    }
  | { readonly ok: false; readonly status: number | null; readonly error: string };

const PENDING_STATUSES = new Set(['pending', 'unconfirmed', 'awaiting']);

/**
 * Book, or fail honestly.
 *
 * `needsConfirmation` is not an error and must not be presented as a confirmed
 * appointment: an event type with a confirmation policy answers `PENDING`, and a
 * receptionist that told the caller "you're booked" at that moment is the bug.
 */
export async function createBooking(
  config: CalComConfig,
  payload: BookingPayload,
  deps: SyncDeps,
): Promise<BookingResult> {
  if (!config.configured) {
    return { ok: false, status: null, error: config.message };
  }
  let response: Response;
  try {
    response = await deps.fetchImpl(`${config.baseUrl}/bookings`, {
      method: 'POST',
      headers: calComHeaders(config.apiKey),
      body: JSON.stringify(payload),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch {
    return { ok: false, status: null, error: 'Cal.com is unreachable — no booking was made' };
  }

  const body = asRecord(await response.json().catch(() => null));
  if (!response.ok) {
    const detail = body ? (typeof body.message === 'string' ? body.message : null) : null;
    const code = body && typeof body.error_code === 'string' ? ` (${body.error_code})` : '';
    return {
      ok: false,
      status: response.status,
      error: detail ? `${detail}${code}` : `Cal.com booking request failed (${response.status})`,
    };
  }

  const data = asRecord(body?.data) ?? body;
  const uid = data && typeof data.uid === 'string' ? data.uid : null;
  if (!uid) return { ok: false, status: response.status, error: 'Cal.com accepted the booking but returned no uid' };

  const status = data && typeof data.status === 'string' ? data.status : 'ACCEPTED';
  return {
    ok: true,
    bookingUid: uid,
    status,
    needsConfirmation: PENDING_STATUSES.has(status.toLowerCase()),
    meetingUrl: data && typeof data.meetingUrl === 'string' ? data.meetingUrl : null,
    startIso: isoOf(data?.start),
    endIso: isoOf(data?.end),
  };
}

/** The booking needs a body; kept separate so the POST is testable without fetch. */
export function bookingRequestInit(config: Extract<CalComConfig, { configured: true }>, payload: BookingPayload) {
  return {
    method: 'POST',
    headers: calComHeaders(config.apiKey),
    body: JSON.stringify(payload),
  } as const;
}

export function isSlotFresh(sync: SlotSyncResult, nowMs: number): boolean {
  if (!sync.ok) return false;
  return nowMs - Date.parse(sync.fetchedAtIso) <= sync.staleAfterMs;
}
