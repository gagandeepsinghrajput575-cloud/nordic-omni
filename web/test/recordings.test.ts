import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeRecordingFd,
  parseByteRange,
  recordingFileResponse,
  resolveRecordingFile,
} from '../src/lib/recordings';

const route = readFileSync(
  new URL('../src/app/api/recordings/[callId]/route.ts', import.meta.url),
  'utf8',
);
const recordingLibrary = readFileSync(
  new URL('../src/lib/recordings.ts', import.meta.url),
  'utf8',
);

test('single, suffix and clamped ranges have exact RFC byte semantics', () => {
  assert.deepEqual(parseByteRange('bytes=0-0', 1000), { start: 0, end: 0 });
  assert.deepEqual(parseByteRange('bytes=-500', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-5000', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseByteRange('bytes=10-999999', 1000), { start: 10, end: 999 });
  assert.deepEqual(parseByteRange('bytes=999-', 1000), { start: 999, end: 999 });
});

test('unsatisfiable, malformed and multi-ranges never produce a partial stream', () => {
  for (const header of [
    'bytes=99999999-',
    'bytes=-0',
    'bytes=-',
    'bytes=10-2',
    'bytes=0-0,2-2',
    'bytes=abc-def',
    'items=0-1',
  ]) {
    assert.equal(parseByteRange(header, 1000), null, header);
  }
});

test('recording path canonicalization permits only real files beneath the root', () => {
  const base = mkdtempSync(join(tmpdir(), 'omni-recording-test-'));
  try {
    const root = join(base, 'library');
    const outside = join(base, 'outside');
    const tenant = join(root, 'tenant');
    const external = join(outside, 'external.ogg');
    const internal = join(tenant, 'call.ogg');
    mkdirSync(tenant, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(internal, Buffer.alloc(4096, 1));
    writeFileSync(external, Buffer.alloc(4096, 2));

    assert.equal(resolveRecordingFile(internal, root)?.size, 4096);
    assert.equal(resolveRecordingFile(external, root), null);
    assert.equal(resolveRecordingFile(join(root, '..', 'outside', 'external.ogg'), root), null);
    assert.equal(resolveRecordingFile(join(tenant, 'missing.ogg'), root), null);

    const link = join(tenant, 'linked.ogg');
    symlinkSync(external, link);
    assert.equal(resolveRecordingFile(link, root), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('client abort closes the descriptor-backed recording stream', async () => {
  const base = mkdtempSync(join(tmpdir(), 'omni-abort-test-'));
  let fd: number | null = null;
  try {
    const path = join(base, 'call.ogg');
    writeFileSync(path, Buffer.alloc(1024 * 1024, 7));
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const controller = new AbortController();
    const request = new Request('http://localhost/api/recordings/call', {
      signal: controller.signal,
    });
    const response = recordingFileResponse({
      request,
      path,
      fd,
      status: 200,
      headers: {},
    });
    assert.ok(response.body);
    const reader = response.body.getReader();
    const pending = reader.read().catch(() => undefined);
    controller.abort();
    await pending;

    let closed = false;
    for (let attempt = 0; attempt < 50 && !closed; attempt += 1) {
      try {
        fstatSync(fd);
        await new Promise((resolve) => setTimeout(resolve, 5));
      } catch {
        closed = true;
      }
    }
    assert.equal(closed, true, 'file descriptor remained open after abort');
    if (closed) fd = null;
  } finally {
    if (fd !== null) closeRecordingFd(fd);
    rmSync(base, { recursive: true, force: true });
  }
});

test('route uses descriptor-backed nofollow streams, abort cleanup and uniform 404s', () => {
  assert.match(route, /O_NOFOLLOW/);
  assert.match(route, /fstatSync\(fd\)/);
  assert.match(recordingLibrary, /request\.signal/);
  assert.match(recordingLibrary, /stream\?\.destroy\(\)/);
  assert.match(route, /if \(!session\) return notFound\(\)/);
  assert.doesNotMatch(route, /status:\s*410|Unauthorized|missing from disk/);
});
