import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { apiSession } from '@/lib/auth/guard';
import { withUser } from '@/lib/db/client';

/**
 * Streams a call recording.
 *
 * Authorization is RLS, not a path check: the SELECT below runs with
 * `app.user_id` set, so a caller outside the tenant gets zero rows and receives
 * a 404. We deliberately return the same 404 for "not found" and "not yours",
 * so the endpoint cannot be used to probe whether a recording exists.
 *
 * The stored `recording_path` is never exposed — the URL is derived from the
 * call log id in SQL, so nobody can traverse into another tenant's folder.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> }
) {
  const session = await apiSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { callId } = await params;

  // A malformed id would reach Postgres as an invalid uuid cast and surface as a
  // 500. Treat it as "not found" instead — same response as a recording that
  // exists but is not yours, so nothing leaks either way.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(callId)) {
    return new Response('Not found', { status: 404 });
  }

  const rows = await withUser(session.userId, async (tx) => {
    return tx`
      select recording_path, recording_status, recording_bytes
      from call_logs
      where id = ${callId}
      limit 1
    `;
  });

  const row = rows[0] as
    | { recording_path: string | null; recording_status: string | null; recording_bytes: number | null }
    | undefined;

  // Same answer for missing / not-yours / failed. No existence leak.
  if (!row || row.recording_status !== 'ok' || !row.recording_path) {
    return new Response('Not found', { status: 404 });
  }

  let size: number;
  try {
    size = statSync(row.recording_path).size;
  } catch {
    return new Response('Recording file is missing from disk', { status: 410 });
  }

  const nodeStream = createReadStream(row.recording_path);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'audio/ogg',
      'Content-Length': String(size),
      'Content-Disposition': `inline; filename="samtale-${callId}.ogg"`,
      // Private: a recording is customer data, never cacheable by a shared proxy.
      'Cache-Control': 'private, no-store',
    },
  });
}
