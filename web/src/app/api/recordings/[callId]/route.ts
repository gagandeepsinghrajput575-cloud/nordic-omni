import { constants, fstatSync, openSync } from 'node:fs';
import { apiSession } from '@/lib/auth/guard';
import { withUser } from '@/lib/db/client';
import {
  closeRecordingFd,
  parseByteRange,
  recordingFileResponse,
  resolveRecordingFile,
} from '@/lib/recordings';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };

function notFound(): Response {
  // Identical for anonymous, cross-tenant, malformed, unrecorded and missing.
  return new Response('Not found', { status: 404, headers: PRIVATE_HEADERS });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ callId: string }> }
) {
  const session = await apiSession();
  if (!session) return notFound();

  const { callId } = await params;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(callId)) return notFound();

  const rows = await withUser(session.userId, async (tx) => {
    return tx`
      select recording_path, recording_status
      from call_logs
      where id = ${callId}
      limit 1
    `;
  });
  const row = rows[0] as
    | { recording_path: string | null; recording_status: string | null }
    | undefined;
  if (!row || row.recording_status !== 'ok' || !row.recording_path) return notFound();

  const file = resolveRecordingFile(row.recording_path);
  if (!file) return notFound();

  let fd: number | null = null;
  let size: number;
  try {
    // The canonical path is opened without following a replacement symlink;
    // ranges are calculated from this exact descriptor, not a second stat.
    fd = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0) {
      closeRecordingFd(fd);
      return notFound();
    }
    size = stat.size;
  } catch {
    if (fd !== null) closeRecordingFd(fd);
    return notFound();
  }
  if (fd === null) return notFound();

  const baseHeaders = {
    ...PRIVATE_HEADERS,
    'Content-Type': 'audio/ogg',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `inline; filename="samtale-${callId}.ogg"`,
  };
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, size);
    if (!range) {
      closeRecordingFd(fd);
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
      });
    }
    return recordingFileResponse({
      request,
      path: file.path,
      fd,
      status: 206,
      start: range.start,
      end: range.end,
      headers: {
        ...baseHeaders,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  }

  return recordingFileResponse({
    request,
    path: file.path,
    fd,
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) },
  });
}
