import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  createBloom,
  css,
  drawOrbFrame,
  mix,
  parseColor,
  rampAt,
  resolvePalette,
  STATE_PALETTES,
  TAU,
  type OrbFrame,
  type RGB,
  type VisualizerState,
} from '../src/lib/audio/orb-shader';

const TOKENS = {
  accent: [124, 58, 237] as RGB,
  secondary: [189, 154, 255] as RGB,
  danger: [237, 162, 154] as RGB,
  warning: [222, 192, 138] as RGB,
  muted: [183, 167, 155] as RGB,
};

/** A recording mock of the 2D context: enough surface to prove every call. */
function mockContext() {
  const calls: string[] = [];
  const gradients = { created: 0, stops: 0 };
  const state = { alpha: 1, transform: [] as number[] };
  const record = (name: string) => (..._args: unknown[]) => {
    calls.push(name);
  };
  const gradient = () => {
    gradients.created += 1;
    return {
      addColorStop: () => {
        gradients.stops += 1;
      },
    };
  };
  const ctx = {
    calls,
    gradients,
    state,
    setTransform: (...args: number[]) => {
      state.transform = args;
      calls.push('setTransform');
    },
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    ellipse: record('ellipse'),
    fill: record('fill'),
    stroke: record('stroke'),
    drawImage: record('drawImage'),
    fillRect: record('fillRect'),
    setLineDash: record('setLineDash'),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    calls: string[];
    gradients: { created: number; stops: number };
    state: { alpha: number; transform: number[] };
  };
}

function makeFrame(overrides: Partial<OrbFrame> = {}): OrbFrame {
  return {
    size: 180,
    dpr: 2,
    state: 'speaking',
    palette: resolvePalette('speaking', TOKENS),
    amplitude: 0.5,
    phase: 1.2,
    spin: 0.4,
    animate: true,
    ring: new Float32Array(48),
    bands: null,
    bloom: null,
    smoothing: 0.2,
    ...overrides,
  };
}

test('color parsing handles hex, rgb(), and hostile input without throwing', () => {
  assert.deepEqual(parseColor('#7C3AED', [0, 0, 0]), [124, 58, 237]);
  assert.deepEqual(parseColor('#fff', [0, 0, 0]), [255, 255, 255]);
  assert.deepEqual(parseColor('rgb(12, 34, 56)', [0, 0, 0]), [12, 34, 56]);
  assert.deepEqual(parseColor('rgba(9, 8, 7, 0.4)', [1, 2, 3]), [9, 8, 7]);
  // Empty, malformed, and partial values must never leak NaN into a gradient.
  for (const bad of ['', '  ', '#12', '#zzzzzz', 'var(--nope)', 'color(display-p3 1 0 0)']) {
    assert.deepEqual(parseColor(bad, [1, 2, 3]), [1, 2, 3]);
  }
});

test('css() always emits a finite rgb()/rgba() string', () => {
  assert.equal(css([1, 2, 3]), 'rgb(1, 2, 3)');
  assert.equal(css([1, 2, 3], 0.5), 'rgba(1, 2, 3, 0.500)');
  for (const alpha of [0, 0.13, 1]) {
    assert.doesNotMatch(css([255, 0, 128], alpha), /NaN|Infinity|undefined/);
  }
});

test('palette ramps are seamless and never contain NaN', () => {
  const palette = resolvePalette('speaking', TOKENS);
  assert.ok(palette.ramp.length >= 3);
  assert.deepEqual(rampAt(palette.ramp, 0), rampAt(palette.ramp, 1));
  assert.deepEqual(rampAt(palette.ramp, -0.25), rampAt(palette.ramp, 0.75));
  for (let t = 0; t <= 1; t += 0.05) {
    for (const channel of rampAt(palette.ramp, t)) {
      assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 255);
    }
  }
  assert.deepEqual(mix([0, 0, 0], [255, 255, 255], 0.5), [128, 128, 128]);
  assert.deepEqual(mix([0, 0, 0], [10, 10, 10], -4), [0, 0, 0]);
  assert.deepEqual(mix([0, 0, 0], [10, 10, 10], 9), [10, 10, 10]);
});

test('every visualizer state resolves an AA-visible palette with a rest level', () => {
  const states: VisualizerState[] = ['idle', 'listening', 'speaking', 'consulting', 'dire_hold'];
  for (const state of states) {
    const palette = resolvePalette(state, TOKENS);
    assert.equal(palette.ramp.length, STATE_PALETTES[state].ramp.length);
    assert.ok(palette.rest > 0 && palette.rest <= 1);
    for (const colour of [palette.core, palette.halo, palette.rim]) {
      assert.ok(colour.every((channel) => Number.isInteger(channel)));
    }
    // dire_hold must read as an alarm, not as ordinary speech.
    if (state === 'dire_hold') assert.deepEqual(palette.core, TOKENS.danger);
  }
  // Idle is deliberately the quietest state.
  assert.ok(STATE_PALETTES.idle.rest < STATE_PALETTES.speaking.rest);
});

test('clamp keeps the orb inside its canvas for pathological inputs', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(Number.NaN, 0, 1), 0);
});

test('a full frame issues closed paths and finite transforms', () => {
  const ctx = mockContext();
  const frame = makeFrame();
  drawOrbFrame(ctx, frame);

  assert.deepEqual(ctx.state.transform, [2, 0, 0, 2, 0, 0]);
  assert.equal(ctx.calls[0], 'setTransform');
  assert.equal(ctx.calls[1], 'clearRect');
  assert.ok(ctx.calls.includes('fill'));
  assert.ok(ctx.calls.includes('stroke'));
  // save/restore must be balanced: an unbalanced pair leaks globalAlpha and
  // shadowBlur into whatever draws next.
  const saves = ctx.calls.filter((call) => call === 'save').length;
  const restores = ctx.calls.filter((call) => call === 'restore').length;
  assert.equal(saves, restores);
  // Ring ticks: one stroke per band.
  assert.ok(ctx.calls.filter((call) => call === 'stroke').length >= frame.ring.length);

  // Every band value stays a normalized strength.
  for (const band of frame.ring) assert.ok(band >= 0 && band <= 1);
});

test('the ring smooths toward live bands instead of snapping', () => {
  const ctx = mockContext();
  const bands = new Uint8Array(32).fill(255);
  const ring = new Float32Array(48);
  const frame = makeFrame({ bands, ring, smoothing: 0.25, palette: resolvePalette('speaking', TOKENS) });
  drawOrbFrame(ctx, frame);
  const first = Array.from(ring);
  assert.ok(first.every((value) => value > 0), 'silent ring should rise on the first loud frame');
  assert.ok(first.every((value) => value <= 1), 'smoothed bands stay normalized');
  const peak = Math.max(...first);
  assert.ok(peak < 1, 'smoothing must not snap straight to the peak');

  drawOrbFrame(ctx, frame);
  assert.ok(Math.max(...Array.from(ring)) > peak, 'a second frame should approach the peak');
});

test('reduced motion omits the travelling needle but still paints a complete orb', () => {
  const animated = mockContext();
  drawOrbFrame(animated, makeFrame({ animate: true }));
  const staticCtx = mockContext();
  drawOrbFrame(staticCtx, makeFrame({ animate: false }));
  assert.ok(staticCtx.calls.length > 0);
  assert.ok(
    animated.calls.length > staticCtx.calls.length,
    'the static frame should do strictly less work',
  );
  assert.ok(staticCtx.calls.includes('fill'));
  assert.ok(staticCtx.calls.includes('stroke'));
});

test('dire_hold adds a dashed containment ring and dire states never throw', () => {
  const ctx = mockContext();
  drawOrbFrame(ctx, makeFrame({ state: 'dire_hold', palette: resolvePalette('dire_hold', TOKENS) }));
  assert.ok(ctx.calls.includes('setLineDash'));
  const plain = mockContext();
  drawOrbFrame(plain, makeFrame({ state: 'speaking' }));
  assert.ok(!plain.calls.includes('setLineDash'));

  for (const state of ['idle', 'listening', 'consulting'] as VisualizerState[]) {
    assert.doesNotThrow(() =>
      drawOrbFrame(mockContext(), makeFrame({ state, palette: resolvePalette(state, TOKENS) })),
    );
  }
});

test('a missing bloom sprite degrades to a pure-gradient orb', () => {
  const ctx = mockContext();
  drawOrbFrame(ctx, makeFrame({ bloom: null }));
  assert.ok(!ctx.calls.includes('drawImage'));
  assert.ok(ctx.calls.includes('fill'));
});

test('createBloom returns null outside a DOM instead of throwing', () => {
  assert.equal(createBloom([1, 2, 3]), null);
  assert.equal(TAU, Math.PI * 2);
});
