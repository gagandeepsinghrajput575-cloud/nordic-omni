import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  abandonCallAttempt,
  combineAudioTracks,
  disposeAudioElement,
} from '../src/lib/livekit/attempt';

test('abandonment is idempotent and active attempts never become missed', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.equal(abandonCallAttempt('attempt-race'), true);
  assert.equal(abandonCallAttempt('attempt-race'), false);
  assert.equal(abandonCallAttempt('attempt-active', true), false);
  assert.equal(abandonCallAttempt(null), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/livekit/abandon');
  assert.equal(calls[0].init?.keepalive, true);
  assert.equal(JSON.parse(String(calls[0].init?.body)).attemptId, 'attempt-race');
});

test('audio disposal stops playback and remaining tracks rebuild the stream', (t) => {
  const originalMediaStream = globalThis.MediaStream;
  class FakeMediaStream {
    constructor(readonly tracks: MediaStreamTrack[]) {}
  }
  globalThis.MediaStream = FakeMediaStream as unknown as typeof MediaStream;
  t.after(() => { globalThis.MediaStream = originalMediaStream; });

  const first = { id: 'first' } as MediaStreamTrack;
  const second = { id: 'second' } as MediaStreamTrack;
  const remaining = combineAudioTracks([first, second, null]) as unknown as FakeMediaStream;
  assert.deepEqual(remaining.tracks, [first, second]);
  const afterUnsubscribe = combineAudioTracks([second]) as unknown as FakeMediaStream;
  assert.deepEqual(afterUnsubscribe.tracks, [second]);
  assert.equal(combineAudioTracks([null, undefined]), null);

  let paused = 0;
  let removed = 0;
  const element = {
    pause: () => { paused += 1; },
    remove: () => { removed += 1; },
    srcObject: {},
  } as unknown as HTMLAudioElement;
  disposeAudioElement(element);
  assert.equal(paused, 1);
  assert.equal(removed, 1);
  assert.equal(element.srcObject, null);
});

test('call state uses generation guards, cancellable waits, and actual microphone state', () => {
  const call = readFileSync(
    new URL('../src/app/call/[contactId]/CallClientView.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(call, /if \(!agentStream\) setStage/);
  assert.match(call, /runRef\.current === runId/);
  assert.match(call, /cancelAgentWaitRef\.current\?\.\(\)/);
  assert.match(call, /audioTracksRef\.current\.delete\(track\)/);
  assert.match(call, /combineAudioTracks\(mediaTracks\)/);
  assert.match(call, /attemptIdRef\.current = null/);
  assert.match(call, /participant\.isMicrophoneEnabled/);
  assert.match(call, /muteInFlightRef\.current/);

  const abandonRoute = readFileSync(
    new URL('../src/app/api/livekit/abandon/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(abandonRoute, /status in \('ringing', 'in_progress'\)/);
  assert.doesNotMatch(abandonRoute, /status\s*=\s*'completed'/);
});
