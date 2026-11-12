import { closeSync, createReadStream, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

export interface ByteRange {
  start: number;
  end: number;
}

/** Parse one RFC 9110 byte range. Unsupported/multi/malformed ranges return null. */
export function parseByteRange(header: string, size: number): ByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export interface RecordingFile {
  path: string;
  size: number;
}

/**
 * Resolve both the configured root and candidate to defeat '../' and symlink
 * escapes. Any filesystem error is intentionally indistinguishable from 404.
 */
export function resolveRecordingFile(
  storedPath: string,
  configuredRoot = process.env.RECORDINGS_DIR ?? `${homedir()}/nordic-omni-recordings`,
): RecordingFile | null {
  try {
    const root = realpathSync(resolve(configuredRoot));
    const candidate = realpathSync(resolve(storedPath));
    const fromRoot = relative(root, candidate);
    if (
      !fromRoot ||
      fromRoot === '..' ||
      fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot)
    ) {
      return null;
    }
    const stat = statSync(candidate);
    if (!stat.isFile() || stat.size <= 0) return null;
    return { path: candidate, size: stat.size };
  } catch {
    return null;
  }
}

export function closeRecordingFd(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // Already closed by the descriptor-backed stream.
  }
}

export interface RecordingResponseOptions {
  request: Request;
  path: string;
  fd: number;
  status: 200 | 206;
  headers: Record<string, string>;
  start?: number;
  end?: number;
}

/** Create a descriptor-backed response and guarantee close on client abort. */
export function recordingFileResponse(args: RecordingResponseOptions): Response {
  const { request, path, fd, status, headers, start, end } = args;
  let stream: ReturnType<typeof createReadStream> | null = null;
  try {
    stream = createReadStream(path, { fd, autoClose: true, start, end });
    const abort = () => stream?.destroy();
    if (request.signal.aborted) abort();
    else request.signal.addEventListener('abort', abort, { once: true });
    stream.once('close', () => request.signal.removeEventListener('abort', abort));

    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status,
      headers,
    });
  } catch (error) {
    stream?.destroy();
    if (!stream) closeRecordingFd(fd);
    throw error;
  }
}
