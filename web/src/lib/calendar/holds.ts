/**
 * Slot-hold state machine.
 *
 * While a caller is on the phone the agent offers a time and takes a ten-minute
 * optimistic hold on it. That hold is the only thing standing between two
 * simultaneous calls and a double booking, so the transition rules are explicit:
 *
 *   (new) ──hold──▶ held ──confirm──▶ confirmed
 *                     │                  │
 *                     ├──release──▶ released
 *                     └──expire───▶ expired        (clock, not a caller)
 *
 * Invariants:
 *   1. A hold only blocks its slot while `status === 'held'` AND `expiresAt > now`.
 *      Expiry is derived, never assumed: an unexpired hold whose wall clock has
 *      passed is treated as expired by every read, even if no job has swept it.
 *   2. `confirmed` is terminal and permanent. A confirmed slot blocks forever.
 *   3. `expired` and `released` are terminal and never block.
 *   4. Claiming or releasing an expired hold fails; the caller must re-query.
 *
 * The in-memory implementation below is the reference behaviour. The SQL
 * implementation in `lib/db/calendar.ts` reproduces it inside a transaction with
 * `pg_advisory_xact_lock`, and `web/test/calendar.test.ts` exercises both the
 * synchronous store and the concurrency contract.
 */

import type {
  BookingHoldRecord,
  BookingRecord,
  BookingStatus,
  CalendarProvider,
} from '@/contracts/schemas';

export const SLOT_HOLD_MS = 10 * 60 * 1000;

export interface CreateHoldInput {
  tenantId: string;
  contactId: string | null;
  callLogId: string | null;
  provider: CalendarProvider;
  startIso: string;
  endIso: string;
  topic: string;
  notes: string;
  label: string;
  holdSeconds?: number;
}

export interface HoldOutcome {
  ok: boolean;
  hold?: BookingHoldRecord;
  /** Machine-readable refusal so the route can pick a status code and copy. */
  reason?: 'slot_taken' | 'hold_expired' | 'hold_not_found' | 'already_confirmed';
}

/** Status as the world should see it, accounting for the clock. */
export function effectiveStatus(hold: BookingHoldRecord, now: Date): BookingStatus {
  if (hold.status !== 'held') return hold.status;
  return Date.parse(hold.expiresAtIso) <= now.getTime() ? 'expired' : 'held';
}

/**
 * Does this hold still occupy its slot?
 *
 * A live hold blocks for its ten minutes. A *confirmed* hold blocks forever: it
 * is the durable evidence that this tenant booked that time, and it stays
 * occupied even after the hold window would have lapsed.
 */
export function holdBlocksSlot(hold: BookingHoldRecord, now: Date): boolean {
  const status = effectiveStatus(hold, now);
  return status === 'held' || status === 'confirmed';
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

/**
 * The in-memory ring store used by the studio preview and by tests.
 *
 * It is intentionally the same shape as the database table so that behaviour
 * proven here is behaviour the routes rely on.
 */
export class SlotHoldStore {
  private holds = new Map<string, BookingHoldRecord>();

  private bookings = new Map<string, BookingRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Live occupancy for one tenant, already filtered by expiry.
   *
   * A confirmed hold and the booking created from it describe the same window,
   * so identical intervals collapse: callers can assert on the count and trust
   * it means "distinct occupied windows".
   */
  busyIntervals(tenantId: string): Array<{ startUtc: Date; endUtc: Date }> {
    const now = this.now();
    const seen = new Set<string>();
    const intervals: Array<{ startUtc: Date; endUtc: Date }> = [];
    const push = (startIso: string, endIso: string) => {
      const key = `${startIso}|${endIso}`;
      if (seen.has(key)) return;
      seen.add(key);
      intervals.push({ startUtc: new Date(startIso), endUtc: new Date(endIso) });
    };
    for (const hold of this.holds.values()) {
      if (hold.tenantId !== tenantId) continue;
      if (!holdBlocksSlot(hold, now)) continue;
      push(hold.startIso, hold.endIso);
    }
    for (const booking of this.bookings.values()) {
      if (booking.tenantId !== tenantId) continue;
      push(booking.startIso, booking.endIso);
    }
    return intervals;
  }

  list(tenantId: string, at: Date = this.now()): BookingHoldRecord[] {
    return Array.from(this.holds.values())
      .filter((hold) => hold.tenantId === tenantId)
      .map((hold) => ({ ...hold, status: effectiveStatus(hold, at) }))
      .sort((left, right) => left.startIso.localeCompare(right.startIso));
  }

  find(id: string): BookingHoldRecord | undefined {
    const hold = this.holds.get(id);
    return hold ? { ...hold } : undefined;
  }

  /**
   * Take a hold if and only if the slot is still free.
   *
   * The overlap scan and the insert happen in one synchronous block, which is
   * what makes this atomic in a single-process runtime; the SQL twin uses an
   * advisory transaction lock for the same guarantee across connections.
   */
  create(input: CreateHoldInput): HoldOutcome {
    const now = this.now();
    const start = Date.parse(input.startIso);
    const end = Date.parse(input.endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { ok: false, reason: 'slot_taken' };
    }
    for (const interval of this.busyIntervals(input.tenantId)) {
      if (overlaps(start, end, interval.startUtc.getTime(), interval.endUtc.getTime())) {
        return { ok: false, reason: 'slot_taken' };
      }
    }
    const holdSeconds = input.holdSeconds ?? SLOT_HOLD_MS / 1000;
    const hold: BookingHoldRecord = {
      id: `hold-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      contactId: input.contactId,
      callLogId: input.callLogId,
      provider: input.provider,
      status: 'held',
      startIso: new Date(start).toISOString(),
      endIso: new Date(end).toISOString(),
      topic: input.topic,
      notes: input.notes,
      expiresAtIso: new Date(now.getTime() + holdSeconds * 1000).toISOString(),
      label: input.label,
      createdAtIso: now.toISOString(),
    };
    this.holds.set(hold.id, hold);
    return { ok: true, hold: { ...hold } };
  }

  release(id: string): HoldOutcome {
    const now = this.now();
    const hold = this.holds.get(id);
    if (!hold) return { ok: false, reason: 'hold_not_found' };
    const status = effectiveStatus(hold, now);
    if (status === 'confirmed') return { ok: false, reason: 'already_confirmed' };
    if (status === 'expired') return { ok: false, reason: 'hold_expired' };
    const released: BookingHoldRecord = { ...hold, status: 'released' };
    this.holds.set(id, released);
    return { ok: true, hold: { ...released } };
  }

  /**
   * Claim a live hold. An expired hold is rejected rather than silently
   * extended, because the caller may already have been offered a new time.
   */
  confirm(id: string): HoldOutcome {
    const now = this.now();
    const hold = this.holds.get(id);
    if (!hold) return { ok: false, reason: 'hold_not_found' };
    const status = effectiveStatus(hold, now);
    if (status === 'confirmed') return { ok: true, hold: { ...hold } };
    if (status !== 'held') return { ok: false, reason: 'hold_expired' };
    const confirmed: BookingHoldRecord = { ...hold, status: 'confirmed' };
    this.holds.set(id, confirmed);
    return { ok: true, hold: { ...confirmed } };
  }

  /** Record the durable booking produced from a hold. */
  addBooking(booking: BookingRecord): void {
    this.bookings.set(booking.id, booking);
  }

  listBookings(tenantId: string): BookingRecord[] {
    return Array.from(this.bookings.values())
      .filter((booking) => booking.tenantId === tenantId)
      .sort((left, right) => left.startIso.localeCompare(right.startIso));
  }

  /** Sweep lapsed holds. Reads already ignore them; this keeps records tidy. */
  expireStale(): number {
    const now = this.now();
    let changed = 0;
    for (const [id, hold] of this.holds) {
      if (hold.status === 'held' && Date.parse(hold.expiresAtIso) <= now.getTime()) {
        this.holds.set(id, { ...hold, status: 'expired' });
        changed += 1;
      }
    }
    return changed;
  }

  reset(): void {
    this.holds.clear();
    this.bookings.clear();
  }
}

/** Process-wide store, replaced by the SQL implementation in production. */
const globalStore = globalThis as unknown as { __omniSlotHolds?: SlotHoldStore };
export const SLOT_HOLDS = globalStore.__omniSlotHolds ?? new SlotHoldStore();
if (process.env.NODE_ENV !== 'production') globalStore.__omniSlotHolds = SLOT_HOLDS;
