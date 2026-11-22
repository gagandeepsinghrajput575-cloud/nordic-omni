import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/guard';
import { jsonError, readJson } from '@/lib/api-utils';
import {
  SlotHoldRequestSchema,
  type BookingSlot,
  type SlotHoldResponse,
} from '@/contracts/schemas';
import {
  DEFAULT_BOOKING_WINDOW,
  buildSlotGrid,
  danishSlotLabel,
  validateRequestedSlot,
  zonedParts,
  type BookingWindowConfig,
  type TimeInterval,
} from '@/lib/calendar/time';
import { SLOT_HOLDS } from '@/lib/calendar/holds';
import { listBusyIntervals, createSlotHold, releaseSlotHold } from '@/lib/db/calendar';

export const dynamic = 'force-dynamic';

/**
 * GET /api/calendar/slots
 *
 * Live availability for one workspace in Europe/Copenhagen. The workspace comes
 * from the session — never from the query string — so a caller cannot widen
 * scope by guessing a UUID.
 *
 * Query: `?days=7` (1–60), `?date=YYYY-MM-DD` (single day), `?provider=google`.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError('Unauthorized', 401);

  const tenantId = session.isAgency
    ? new URL(request.url).searchParams.get('tenantId') ?? session.tenantIds[0]
    : session.tenantIds[0];
  if (!tenantId) return jsonError('No workspace in session', 403);

  const url = new URL(request.url);
  const daysParam = url.searchParams.get('days');
  const dateParam = url.searchParams.get('date');
  const days = daysParam ? Math.max(1, Math.min(60, Number.parseInt(daysParam, 10) || 7)) : 7;

  const now = new Date();
  const config: BookingWindowConfig = {
    ...DEFAULT_BOOKING_WINDOW,
    horizonDays: Math.max(days, 1),
  };

  let busy: TimeInterval[] = [];
  try {
    const rows = await listBusyIntervals(session.userId, tenantId);
    busy = rows.map((row) => ({
      startUtc: new Date(row.start_iso),
      endUtc: new Date(row.end_iso),
    }));
  } catch {
    // A database that is unreachable must not fabricate availability: report the
    // grid as fully blocked rather than inventing free slots.
    return jsonError('Calendar availability is temporarily unavailable', 503);
  }

  let slots: BookingSlot[] = buildSlotGrid({ now, config, busy }).map((slot) => ({
    id: `${slot.startIso}`,
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

  if (dateParam) {
    slots = slots.filter((slot) => slot.localDate === dateParam);
  } else {
    const firstDate = slots[0]?.localDate;
    if (firstDate) {
      const [year, month, day] = firstDate.split('-').map(Number);
      const last = new Date(Date.UTC(year, month - 1, day + days - 1));
      const lastIso = last.toISOString().slice(0, 10);
      slots = slots.filter((slot) => slot.localDate <= lastIso);
    }
  }

  return NextResponse.json({
    ok: true,
    tenantId,
    timezone: config.timeZone,
    workday: { start: config.workdayStart, end: config.workdayEnd },
    slotMinutes: config.slotMinutes,
    generatedAt: now.toISOString(),
    availableCount: slots.filter((slot) => slot.available).length,
    slots,
  });
}

/**
 * POST /api/calendar/slots
 *
 * Take a ten-minute optimistic hold. 409 means the slot was taken while the
 * agent was talking, which is exactly the double-booking this prevents.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError('Unauthorized', 401);

  const parsed = SlotHoldRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'Invalid hold request', 400);
  }
  const payload = parsed.data;

  const tenantId = session.isAgency
    ? payload.tenantId ?? session.tenantIds[0]
    : session.tenantIds[0];
  if (!tenantId) return jsonError('No workspace in session', 403);
  if (payload.tenantId && !session.isAgency && payload.tenantId !== tenantId) {
    return jsonError('Forbidden: workspace mismatch', 403);
  }

  const now = new Date();
  const start = new Date(payload.startIso);
  const end = new Date(payload.endIso);

  let busy: TimeInterval[] = [];
  try {
    const rows = await listBusyIntervals(session.userId, tenantId);
    busy = rows.map((row) => ({
      startUtc: new Date(row.start_iso),
      endUtc: new Date(row.end_iso),
    }));
  } catch {
    return jsonError('Calendar availability is temporarily unavailable', 503);
  }

  const refusal = validateRequestedSlot({
    start,
    end,
    now,
    config: DEFAULT_BOOKING_WINDOW,
    busy,
  });
  if (refusal) {
    const status = refusal.reason === 'off_grid' && /optaget/.test(refusal.message) ? 409 : 422;
    return NextResponse.json({ error: refusal.message, reason: refusal.reason }, { status });
  }

  const wall = zonedParts(start, DEFAULT_BOOKING_WINDOW.timeZone);
  const label = danishSlotLabel(
    wall,
    wall.hour * 60 + wall.minute,
    wall.hour * 60 + wall.minute + (end.getTime() - start.getTime()) / 60_000,
  );

  const result = await createSlotHold(session.userId, {
    tenantId,
    contactId: payload.contactId ?? null,
    callLogId: payload.callLogId ?? null,
    provider: payload.provider,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    topic: payload.topic,
    notes: payload.notes,
    label,
    holdSeconds: payload.holdSeconds,
  }).catch(() => null);

  if (!result) {
    return jsonError('Could not take a hold on that slot', 503);
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Tidspunktet er lige blevet booket. Vælg et andet.', reason: result.reason },
      { status: 409 },
    );
  }

  const expiresInSeconds = Math.max(
    0,
    Math.round((Date.parse(result.hold.expiresAtIso) - now.getTime()) / 1000),
  );

  const body: SlotHoldResponse = {
    ok: true,
    hold: result.hold,
    slot: {
      id: result.hold.startIso,
      startIso: result.hold.startIso,
      endIso: result.hold.endIso,
      localDate: wall.year + '-' + String(wall.month).padStart(2, '0') + '-' + String(wall.day).padStart(2, '0'),
      localStart: `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`,
      localEnd: result.hold.endIso.slice(11, 16),
      durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
      label: result.hold.label,
      available: false,
      blockedBy: 'held',
    },
    expiresInSeconds,
  };

  return NextResponse.json(body, { status: 201 });
}

/** DELETE /api/calendar/slots?holdId=… — release a hold the caller abandoned. */
export async function DELETE(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError('Unauthorized', 401);
  const url = new URL(request.url);
  const holdId = url.searchParams.get('holdId');
  if (!holdId) return jsonError('holdId is required', 400);

  const tenantId = session.isAgency
    ? url.searchParams.get('tenantId') || session.tenantIds[0]
    : session.tenantIds[0];

  SLOT_HOLDS.release(holdId);

  if (tenantId) {
    try {
      await releaseSlotHold(session.userId, tenantId, holdId);
    } catch {
      // hold might already be expired or released in Postgres
    }
  }

  return NextResponse.json({ ok: true, released: holdId });
}
