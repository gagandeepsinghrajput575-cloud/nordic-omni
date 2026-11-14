import { apiSession } from '@/lib/auth/guard';
import { jsonError } from '@/lib/api-utils';
import {
  buildIcs,
  copenhagenVtimezone,
  foldContentLine,
} from '@/lib/calendar/formatters';
import { listBookings } from '@/lib/db/calendar';

export const dynamic = 'force-dynamic';

/**
 * GET /api/calendar/ics?tenantId=…
 *
 * The `.ics` feed behind the `webcal://` subscription link and the Apple
 * download fallback. Served as `text/calendar` with CRLF endings and folded
 * content lines, which is what iOS Calendar and Outlook both require.
 *
 * Scope comes from the session; `tenantId` may only select among workspaces the
 * caller already owns.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError('Unauthorized', 401);

  const url = new URL(request.url);
  const requested = url.searchParams.get('tenantId');
  const tenantId = session.isAgency
    ? requested ?? session.tenantIds[0]
    : session.tenantIds[0];

  if (!tenantId) return jsonError('No workspace in session', 403);
  if (requested && !session.isAgency && requested !== tenantId) {
    return jsonError('Forbidden: workspace mismatch', 403);
  }

  const bookings = await listBookings(session.userId, tenantId).catch(() => null);
  if (bookings === null) {
    return jsonError('Calendar feed is temporarily unavailable', 503);
  }

  const org = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nordic Omni//Danish Voice Receptionist//DA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Nordic Omni reception',
    'X-WR-TIMEZONE:Europe/Copenhagen',
    ...copenhagenVtimezone(),
  ];

  for (const booking of bookings) {
    const ics = buildIcs(
      {
        uid: booking.icsUid,
        title: `${booking.topic}`,
        description: `${booking.label} · ${booking.attendeeName}`,
        location: '',
        startUtc: new Date(booking.startIso),
        endUtc: new Date(booking.endIso),
        organizerName: 'Nordic Omni',
        organizerEmail: 'reception@nordic-omni.dk',
        attendeeName: booking.attendeeName,
        attendeeEmail: booking.attendeeEmail,
        label: booking.label,
        url: `${org}/calendar/${booking.id}`,
      },
      {
        method: 'PUBLISH',
        stamp: new Date(booking.createdAtIso),
        organizerEmail: 'reception@nordic-omni.dk',
        organizerName: 'Nordic Omni',
        attendeeEmail: booking.attendeeEmail,
        attendeeName: booking.attendeeName,
      },
    );
    // Splice the VEVENT out of each single-event calendar into the feed, so the
    // feed has exactly one VTIMEZONE block.
    const eventStart = ics.indexOf('BEGIN:VEVENT');
    const eventEnd = ics.indexOf('END:VEVENT');
    if (eventStart === -1 || eventEnd === -1) continue;
    lines.push(ics.slice(eventStart, eventEnd + 'END:VEVENT'.length));
  }

  lines.push('END:VCALENDAR');
  const body = `${lines.map(foldContentLine).join('\r\n')}\r\n`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="nordic-omni-reception.ics"',
      // A subscription feed must never be cached by an intermediary.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
