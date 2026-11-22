import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/guard';
import { jsonError, readJson } from '@/lib/api-utils';
import {
  BookingConfirmationSchema,
  type BookingConfirmationResponse,
  type BookingRecord,
} from '@/contracts/schemas';
import {
  DEFAULT_BOOKING_WINDOW,
  danishSlotLabel,
  validateRequestedSlot,
  zonedParts,
  type TimeInterval,
} from '@/lib/calendar/time';
import {
  buildCalendarLinks,
  danishBookingSms,
  type BookingEventDetails,
} from '@/lib/calendar/formatters';
import { SLOT_HOLDS } from '@/lib/calendar/holds';
import { cacheInvite, signBookingToken } from '@/lib/calendar/invites';
import {
  confirmAndInsertBookingAtomic,
  listBusyIntervals,
} from '@/lib/db/calendar';
import { getTenantFacts } from '@/lib/db/queries';
import { SMS_STORE, calculateSmsSegments, computeSmsMetrics } from '@/lib/sms';

export const dynamic = 'force-dynamic';

const SITE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/**
 * POST /api/calendar/book
 *
 * Confirms a held slot and returns every invitation surface at once: Google
 * Calendar, Outlook 365, an Apple/iCloud .ics data URI, a webcal:// feed and a
 * Cal.com link. The Danish confirmation SMS is queued unless the caller asked
 * for email-only.
 *
 * A booking never trusts a client-supplied time: the window is re-validated and
 * the hold (when present) is claimed atomically before anything is written.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError('Unauthorized', 401);

  const parsed = BookingConfirmationSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'Invalid booking request', 400);
  }
  const payload = parsed.data;

  const tenantId = session.isAgency
    ? payload.tenantId
    : session.tenantIds[0];
  if (!tenantId) return jsonError('No workspace in session', 403);
  if (!session.isAgency && payload.tenantId !== tenantId) {
    return jsonError('Forbidden: workspace mismatch', 403);
  }

  const start = new Date(payload.startIso);
  const end = new Date(payload.endIso);
  const now = new Date();

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

  // The caller's own hold must not count as a conflict with itself.
  const hold = payload.holdId ? SLOT_HOLDS.find(payload.holdId) : undefined;
  if (hold && hold.startIso === start.toISOString()) {
    busy = busy.filter(
      (interval) =>
        !(interval.startUtc.getTime() === start.getTime() && interval.endUtc.getTime() === end.getTime()),
    );
  }

  const refusal = validateRequestedSlot({
    start,
    end,
    now,
    config: DEFAULT_BOOKING_WINDOW,
    busy,
  });
  if (refusal) {
    const taken = /optaget/.test(refusal.message);
    return NextResponse.json(
      { error: refusal.message, reason: refusal.reason },
      { status: taken ? 409 : 422 },
    );
  }

  // Claim the hold. An expired hold is a hard refusal: the slot may already have
  // been offered to another caller, so the agent must re-query rather than win.
  if (payload.holdId && hold) {
    const claim = SLOT_HOLDS.confirm(payload.holdId);
    if (!claim.ok) {
      return NextResponse.json(
        { error: 'Holdet er udløbet. Vælg et nyt tidspunkt.', reason: claim.reason ?? 'hold_expired' },
        { status: 409 },
      );
    }
  } else if (!payload.holdId) {
    // Booking without a hold still has to pass the same atomic gate.
    const created = SLOT_HOLDS.create({
      tenantId,
      contactId: payload.contactId ?? null,
      callLogId: payload.callLogId ?? null,
      provider: payload.provider,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      topic: payload.topic,
      notes: payload.notes,
      label: '',
      holdSeconds: 60,
    });
    if (!created.ok) {
      return NextResponse.json(
        { error: 'Tidspunktet er lige blevet booket. Vælg et andet.', reason: created.reason },
        { status: 409 },
      );
    }
  }

  const wall = zonedParts(start, DEFAULT_BOOKING_WINDOW.timeZone);
  const endWall = zonedParts(end, DEFAULT_BOOKING_WINDOW.timeZone);
  const startMinutes = wall.hour * 60 + wall.minute;
  const endMinutes = endWall.hour * 60 + endWall.minute;
  const localDate = `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
  const label = danishSlotLabel(wall, startMinutes, endMinutes);

  const tenant = await getTenantFacts(session.userId, tenantId).catch(() => null);
  const venueName = tenant?.name ?? 'Nordic Omni';
  const organizerEmail = tenant?.owner_email ?? 'reception@nordic-omni.dk';
  const organizerName = tenant?.owner_name ?? venueName;
  const location = payload.location || venueName;

  const bookingId = `bk-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const icsUid = `${bookingId}@nordic-omni.dk`;

  const event: BookingEventDetails = {
    uid: icsUid,
    title: `${payload.topic} — ${venueName}`,
    description:
      `${label} (Europe/Copenhagen). Booket via den danske telefonreception.` +
      (payload.notes ? `\nNoter: ${payload.notes}` : ''),
    location,
    startUtc: start,
    endUtc: end,
    organizerName,
    organizerEmail,
    attendeeName: payload.attendeeName,
    attendeeEmail: payload.attendeeEmail ?? null,
    label,
    url: `${SITE_ORIGIN}/calendar/${bookingId}`,
  };

  const links = buildCalendarLinks({
    event,
    origin: SITE_ORIGIN,
    feedPath: `/api/calendar/ics?tenantId=${encodeURIComponent(tenantId)}`,
    calcomLink: payload.calcomLink ?? `https://cal.com/${tenant?.slug ?? 'nordic-omni'}`,
    calcomSlot: {
      localDate,
      localStart: `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`,
    },
    stamp: now,
  });

  const booking: BookingRecord = {
    id: bookingId,
    tenantId,
    contactId: payload.contactId ?? null,
    callLogId: payload.callLogId ?? null,
    provider: payload.provider,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    label,
    topic: payload.topic,
    attendeeName: payload.attendeeName,
    attendeeEmail: payload.attendeeEmail ?? null,
    attendeePhone: payload.attendeePhone ?? null,
    icsUid,
    createdAtIso: now.toISOString(),
  };

  SLOT_HOLDS.addBooking(booking);

  // Durable PostgreSQL persistence under RLS with pg_advisory_xact_lock.
  // Never swallow errors: if claiming hold or booking fails, return 409 or 503.
  const atomicResult = await confirmAndInsertBookingAtomic(session.userId, {
    id: booking.id,
    tenantId,
    holdId: payload.holdId,
    contactId: booking.contactId,
    callLogId: booking.callLogId,
    provider: booking.provider,
    startIso: booking.startIso,
    endIso: booking.endIso,
    label: booking.label,
    topic: booking.topic,
    notes: payload.notes,
    attendeeName: booking.attendeeName,
    attendeeEmail: booking.attendeeEmail,
    attendeePhone: booking.attendeePhone,
    icsUid: booking.icsUid,
  }).catch((err) => {
    console.error('Booking transaction failed:', err);
    return null;
  });

  if (!atomicResult) {
    return jsonError('Calendar persistence failed', 503);
  }
  if (!atomicResult.ok) {
    return NextResponse.json(
      {
        error:
          atomicResult.reason === 'hold_expired'
            ? 'Holdet er udløbet eller findes ikke i databasen.'
            : 'Tidspunktet er lige blevet booket. Vælg et andet.',
        reason: atomicResult.reason,
      },
      { status: 409 },
    );
  }

  // The Danish post-call SMS. The link must work on a phone with no session, so
  // it points at the signed public invitation rather than the webcal:// feed.
  cacheInvite(bookingId, {
    ics: links.ics,
    title: `${payload.topic}-${wall.day}`,
  });
  const inviteUrl = `${SITE_ORIGIN}/api/calendar/invite/${signBookingToken(bookingId)}`;
  const smsBody = danishBookingSms({
    venueName,
    localDateLabel: label.split(' ').slice(0, 3).join(' '),
    timeLabel: `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`,
    link: inviteUrl,
  });

  let sms: BookingConfirmationResponse['sms'];
  if (payload.sendSms && payload.attendeePhone) {
    SMS_STORE.unshift({
      id: `sms-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      recipient: payload.attendeePhone,
      messageType: 'booking_confirm',
      body: smsBody,
      callLogId: payload.callLogId ?? null,
      contactId: payload.contactId ?? null,
      workspaceId: tenantId,
      workspaceName: venueName,
      status: 'delivered',
      carrier: 'FlyNumber SMS Trunk',
      segments: calculateSmsSegments(smsBody),
      deliveryLatencyMs: 250 + Math.round(Math.random() * 150),
      createdAt: now.toISOString(),
    });
    if (SMS_STORE.length > 100) SMS_STORE.pop();
    sms = { queued: true, recipient: payload.attendeePhone, body: smsBody };
  } else {
    sms = { queued: false, recipient: null, body: smsBody };
  }

  const body: BookingConfirmationResponse = {
    ok: true,
    booking,
    links,
    sms,
  };

  return NextResponse.json(
    {
      ...body,
      persisted: true,
      inviteUrl,
      metrics: computeSmsMetrics(SMS_STORE),
    },
    { status: 201 },
  );
}
