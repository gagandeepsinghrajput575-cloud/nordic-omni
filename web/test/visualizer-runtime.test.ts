import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnalyserRuntime,
  createMotionPreference,
  createPacedFrameLoop,
} from '../src/lib/audio/visualizer-runtime';

function stubGlobal(t: TestContext, name: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  });
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static failAtSource = false;
  state = 'suspended';
  resumeCalls = 0;
  closeCalls = 0;
  sourceDisconnects = 0;
  analyserDisconnects = 0;
  readonly listeners = new Set<() => void>();
  readonly analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 32,
    disconnect: () => { this.analyserDisconnects += 1; },
  };
  readonly source = {
    connect: () => undefined,
    disconnect: () => { this.sourceDisconnects += 1; },
  };

  constructor() { FakeAudioContext.instances.push(this); }
  createAnalyser() { return this.analyser; }
  createMediaStreamSource() {
    if (FakeAudioContext.failAtSource) throw new Error('unsupported stream');
    return this.source;
  }
  addEventListener(_type: string, listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: () => void) { this.listeners.delete(listener); }
  async resume() { this.resumeCalls += 1; this.state = 'running'; }
  async close() { this.closeCalls += 1; this.state = 'closed'; }
}

function audioGlobals(t: TestContext) {
  const documentListeners = new Set<() => void>();
  const fakeDocument = {
    addEventListener: (_type: string, listener: () => void) => documentListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => documentListeners.delete(listener),
  };
  stubGlobal(t, 'document', fakeDocument);
  stubGlobal(t, 'window', { AudioContext: FakeAudioContext });
  FakeAudioContext.instances = [];
  FakeAudioContext.failAtSource = false;
  return documentListeners;
}

const stream = { getAudioTracks: () => [{ id: 'audio' }] } as unknown as MediaStream;

test('analyser teardown removes all listeners/nodes and is idempotent', (t) => {
  const documentListeners = audioGlobals(t);
  const runtime = createAnalyserRuntime(stream);
  assert.ok(runtime);
  const context = FakeAudioContext.instances[0];
  assert.equal(context.analyser.fftSize, 64);
  assert.equal(context.analyser.smoothingTimeConstant, 0.78);
  assert.equal(context.resumeCalls, 1);
  assert.equal(documentListeners.size, 1);

  context.state = 'suspended';
  for (const listener of documentListeners) listener();
  assert.equal(context.resumeCalls, 2);
  runtime.dispose();
  runtime.dispose();
  assert.equal(documentListeners.size, 0);
  assert.equal(context.listeners.size, 0);
  assert.equal(context.sourceDisconnects, 1);
  assert.equal(context.analyserDisconnects, 1);
  assert.equal(context.closeCalls, 1);
});

test('partial AudioContext construction failures close and disconnect partial resources', (t) => {
  const documentListeners = audioGlobals(t);
  FakeAudioContext.failAtSource = true;
  assert.equal(createAnalyserRuntime(stream), null);
  const context = FakeAudioContext.instances[0];
  assert.equal(context.analyserDisconnects, 1);
  assert.equal(context.closeCalls, 1);
  assert.equal(documentListeners.size, 0);

  FakeAudioContext.instances = [];
  assert.equal(createAnalyserRuntime({ getAudioTracks: () => [] } as unknown as MediaStream), null);
  assert.equal(FakeAudioContext.instances.length, 0);
});

test('RAF loop paces frames, switches to static mode, and cancels on disposal', (t) => {
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  let nextId = 0;
  stubGlobal(t, 'requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  stubGlobal(t, 'cancelAnimationFrame', (id: number) => {
    cancelled.push(id);
    callbacks.delete(id);
  });

  let animate = true;
  const drawn: number[] = [];
  const loop = createPacedFrameLoop((now) => drawn.push(now), () => animate);
  assert.deepEqual(drawn, [0]);
  assert.equal(callbacks.size, 1);
  const fire = (now: number) => {
    const pending = Array.from(callbacks.entries());
    callbacks.clear();
    for (const [, callback] of pending) callback(now);
  };
  fire(16);
  assert.equal(drawn.length, 1);
  fire(34);
  assert.equal(drawn.length, 2);

  animate = false;
  loop.refresh();
  assert.equal(drawn.length, 3);
  assert.equal(callbacks.size, 0);
  loop.refresh();
  assert.equal(drawn.length, 4);
  assert.equal(callbacks.size, 0);

  animate = true;
  loop.refresh();
  assert.equal(callbacks.size, 1);
  loop.dispose();
  assert.equal(callbacks.size, 0);
  assert.ok(cancelled.length >= 2);
  const count = drawn.length;
  loop.refresh();
  assert.equal(drawn.length, count);
});

test('reduced-motion preference emits changes and always unsubscribes', (t) => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: false,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };
  stubGlobal(t, 'window', { matchMedia: () => query });
  let changes = 0;
  const preference = createMotionPreference(() => { changes += 1; });
  assert.equal(preference.reduced, false);
  assert.equal(listeners.size, 1);
  query.matches = true;
  for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
  assert.equal(preference.reduced, true);
  assert.equal(changes, 1);
  preference.dispose();
  preference.dispose();
  assert.equal(listeners.size, 0);
});
