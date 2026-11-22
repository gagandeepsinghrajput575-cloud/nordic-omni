import { cacheInvite, readInvite, verifyBookingToken } from '@/lib/calendar/invites';
import { getPublicBookingInvite } from '@/lib/db/trusted-records';
import { buildIcs } from '@/lib/calendar/formatters';

export const dynamic = 'force-dynamic';

/**
 * GET /api/calendar/invite/[token]
 *
 * The public invitation link that is texted to the caller. No session is
 * required — the HMAC-signed token in the path is the capability, and it only
 * ever resolves to the .ics the server generated for that booking id.
 *
 * Backed by durable PostgreSQL lookup when not present in memory cache.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const bookingId = verifyBookingToken(token);
  if (!bookingId) {
    return Response.json({ error: 'Invalid or expired invitation' }, { status: 404 });
  }

  let invite = readInvite(bookingId);

  // If memory cache is empty (e.g. after process restart), reconstitute from PostgreSQL
  if (!invite) {
    const row = (await getPublicBookingInvite(bookingId)) as {
      id: string;
      tenant_id: string;
      topic: string;
      start_iso: string;
      end_iso: string;
      attendee_name: string;
      attendee_email: string | null;
      ics_uid: string;
      tenant_name: string;
    } | null;

    if (!row) {
      return Response.json({ error: 'Invitation is no longer available' }, { status: 404 });
    }

    const start = new Date(row.start_iso);
    const end = new Date(row.end_iso);
    const organizerName = row.tenant_name;
    const organizerEmail = 'noreply@nordic-omni.local';

    const icsContent = buildIcs(
      {
        uid: row.ics_uid || `omni-${row.id}`,
        title: `${row.topic} — ${organizerName}`,
        description: `Bekræftet aftale hos ${organizerName}.`,
        location: organizerName,
        startUtc: start,
        endUtc: end,
        organizerName,
        organizerEmail,
        attendeeName: row.attendee_name,
        attendeeEmail: row.attendee_email,
        label: row.topic,
        url: `https://nordic-omni.local/calendar/${row.id}`,
      },
      {
        organizerName,
        organizerEmail,
        attendeeName: row.attendee_name,
        attendeeEmail: row.attendee_email,
        method: 'PUBLISH',
      },
    );

    invite = {
      ics: icsContent,
      title: row.topic,
      createdAt: Date.now(),
    };
    cacheInvite(bookingId, { ics: invite.ics, title: invite.title });
  }

  const filename = invite.title
    .replace(/[^\w\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'aftale';

  return new Response(invite.ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.ics"`,
      // The capability is in the URL, so intermediaries must not store it.
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
