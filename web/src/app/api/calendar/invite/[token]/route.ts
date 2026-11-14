import { readInvite, verifyBookingToken } from '@/lib/calendar/invites';

export const dynamic = 'force-dynamic';

/**
 * GET /api/calendar/invite/[token]
 *
 * The public invitation link that is texted to the caller. No session is
 * required — the HMAC-signed token in the path is the capability, and it only
 * ever resolves to the .ics the server generated for that booking id.
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

  const invite = readInvite(bookingId);
  if (!invite) {
    return Response.json({ error: 'Invitation is no longer available' }, { status: 404 });
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
