import 'server-only';

import { listBusyIntervals } from '@/lib/db/calendar';
import {
  DEFAULT_BOOKING_WINDOW,
  buildSlotGrid,
  type TimeInterval,
} from '@/lib/calendar/time';
import type { BookingSlot } from '@/contracts/schemas';

/**
 * Server-side slot projection for the initial paint.
 *
 * The studio panel receives a fully rendered grid so availability is correct
 * before any JavaScript runs; the client refreshes afterwards to stay live.
 *
 * Failure is explicit: when the database cannot answer, every slot is returned
 * marked unavailable rather than the grid being invented. A receptionist must
 * never promise a time the system could not verify.
 */
export async function generateServerSlots({
  userId,
  tenantId,
  now = new Date(),
  days = 7,
}: {
  userId: string;
  tenantId: string;
  now?: Date;
  days?: number;
}): Promise<{ slots: BookingSlot[]; timezone: string; degraded: boolean }> {
  const config = { ...DEFAULT_BOOKING_WINDOW, horizonDays: Math.max(1, Math.min(60, days)) };

  let busy: TimeInterval[] = [];
  let degraded = false;
  try {
    const rows = await listBusyIntervals(userId, tenantId);
    busy = rows.map((row) => ({
      startUtc: new Date(row.start_iso),
      endUtc: new Date(row.end_iso),
    }));
  } catch {
    degraded = true;
  }

  // When occupancy could not be read, return NO slots rather than a grid marked
  // "booked": telling a receptionist that every time is taken when the calendar
  // merely failed is a false statement they would repeat to a caller.
  if (degraded) return { slots: [], timezone: config.timeZone, degraded: true };

  const slots = buildSlotGrid({ now, config, busy }).map<BookingSlot>((slot) => ({
    id: slot.startIso,
    startIso: slot.startIso,
    endIso: slot.endIso,
    localDate: slot.localDate,
    localStart: slot.localStart,
    localEnd: slot.localEnd,
    durationMinutes: slot.durationMinutes,
    label: slot.label,
    available: slot.available,
    ...(slot.blockedBy ? { blockedBy: slot.blockedBy } : {}),
  }));

  return { slots, timezone: config.timeZone, degraded: false };
}
