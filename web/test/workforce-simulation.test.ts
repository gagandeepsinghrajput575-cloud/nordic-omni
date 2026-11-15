import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  HOOK_ANGLES,
  NEXT_DISPATCH_STATE,
  makeRng,
  probeCitations,
  rebalanceCbo,
  simulateCall,
  synthesizeAngles,
} from '../src/lib/workforce/simulation';
import { dispatchFeedEntries } from '../src/lib/workforce/roster';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const engine = read('src/lib/workforce/simulation.ts');
const console_ = read('src/components/workforce/DispatchSimulationConsole.tsx');
const board = read('src/components/workforce/FeatureSwitchboardSimulator.tsx');
const css = read('src/app/globals.css');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const block = css.slice(css.indexOf('Workforce simulation engine'), css.length);

// -----------------------------------------------------------------------------
// 1. Determinism — the property the whole engine rests on
// -----------------------------------------------------------------------------

test('the rng is seeded, so the same seed gives the same stream', () => {
  const a = Array.from({ length: 5 }, makeRng(42).bind(null)).map(() => 0); // shape check only
  assert.equal(a.length, 5);
  const streamA = Array.from({ length: 6 }, () => makeRng(42)());
  // Each call constructs a fresh generator at the same seed.
  assert.deepEqual(new Set(streamA).size, 1, 'a fresh generator must restart at the seed');

  const genA = makeRng(7);
  const genB = makeRng(7);
  for (let i = 0; i < 8; i += 1) {
    assert.equal(genA(), genB(), 'two generators with one seed must agree');
  }
  // And it produces numbers in [0, 1).
  const gen = makeRng(99);
  for (let i = 0; i < 50; i += 1) {
    const value = gen();
    assert.ok(value >= 0 && value < 1, `${value} out of range`);
  }
});

test('every runner is a pure function of its seed', () => {
  assert.deepEqual(synthesizeAngles('x', 5), synthesizeAngles('x', 5));
  assert.deepEqual(probeCitations('x', 5), probeCitations('x', 5));
  assert.deepEqual(simulateCall(5), simulateCall(5));
  assert.deepEqual(
    rebalanceCbo([{ channel: 'A', spend: 100 }], 500, 5),
    rebalanceCbo([{ channel: 'A', spend: 100 }], 500, 5),
  );
});

test('no runner reaches for a clock or a random source', () => {
  const source = code(engine);
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /Date\.now|new Date\(/);
  assert.doesNotMatch(source, /fetch\(|axios/);
});

// -----------------------------------------------------------------------------
// 2. Creative Director — angle synthesis
// -----------------------------------------------------------------------------

test('synthesis returns exactly one hook per angle, five in total', () => {
  const result = synthesizeAngles('facaderens');
  assert.equal(result.hooks.length, 5);
  assert.equal(HOOK_ANGLES.length, 5);
  assert.deepEqual(
    result.hooks.map((hook) => hook.angle),
    [...HOOK_ANGLES],
    'angles must appear once each, in order',
  );
  // Hook ids are stable and unique, so React keys are not index-derived.
  assert.deepEqual(result.hooks.map((hook) => hook.id), [
    'hook-0', 'hook-1', 'hook-2', 'hook-3', 'hook-4',
  ]);
});

test('every hook is formatted, non-empty and carries its subject', () => {
  const result = synthesizeAngles('  facaderens i København  ');
  assert.equal(result.subject, 'facaderens i København', 'subject is trimmed');
  for (const hook of result.hooks) {
    assert.ok(hook.text.length > 20, `hook too short: ${hook.text}`);
    assert.ok(hook.text.includes('facaderens i København'), 'hook must name the subject');
    assert.ok(hook.strength >= 0 && hook.strength <= 1);
  }
});

test('an empty subject still produces usable hooks', () => {
  const result = synthesizeAngles('   ');
  assert.equal(result.subject, 'AI-receptionen');
  assert.equal(result.hooks.length, 5);
  for (const hook of result.hooks) assert.ok(hook.text.length > 0);
});

test('the average strength matches the hooks it averages', () => {
  const result = synthesizeAngles('test');
  const manual =
    Math.round((result.hooks.reduce((sum, h) => sum + h.strength, 0) / result.hooks.length) * 100) /
    100;
  assert.equal(result.averageStrength, manual);
});

// -----------------------------------------------------------------------------
// 3. Paid media — CBO rebalance
// -----------------------------------------------------------------------------

test('the rebalance never exceeds the CBO ceiling', () => {
  const result = rebalanceCbo([
    { channel: 'Meta', spend: 1200 },
    { channel: 'Google', spend: 800 },
    { channel: 'Retarget', spend: 400 },
  ], 2400);
  assert.ok(result.withinCeiling);
  assert.ok(result.totalAfter <= result.ceiling);
  for (const line of result.lines) {
    assert.ok(line.after >= 0);
    assert.ok(Number.isInteger(line.after), 'rendered money must be whole kroner');
  }
});

test('the ceiling binds when the input spend exceeds it', () => {
  // 3 × 1000 = 3000 before, ceiling 2400.
  const result = rebalanceCbo(
    [
      { channel: 'A', spend: 1000 },
      { channel: 'B', spend: 1000 },
      { channel: 'C', spend: 1000 },
    ],
    2400,
  );
  assert.equal(result.totalBefore, 3000);
  assert.ok(result.totalAfter <= 2400);
  assert.ok(result.withinCeiling);
  // It trimmed rather than redistributing the extra.
  assert.ok(result.totalAfter < result.totalBefore);
});

test('the rounded bars add up to the displayed total', () => {
  // Rounding per line can lose a krone; the remainder is reallocated so the
  // bars and the total cannot disagree.
  for (const ceiling of [2400, 1000, 333]) {
    const result = rebalanceCbo(
      [
        { channel: 'A', spend: 700 },
        { channel: 'B', spend: 550 },
        { channel: 'C', spend: 300 },
      ],
      ceiling,
    );
    const sum = result.lines.reduce((total, line) => total + line.after, 0);
    assert.equal(result.totalAfter, sum, `bars must sum to the total at ceiling ${ceiling}`);
  }
});

test('before values are preserved untouched for the comparison bars', () => {
  const input = [
    { channel: 'Meta', spend: 1200 },
    { channel: 'Google', spend: 800 },
  ];
  const result = rebalanceCbo(input, 2400);
  assert.deepEqual(result.lines.map((line) => line.before), [1200, 800]);
  assert.equal(result.totalBefore, 2000);
});

// -----------------------------------------------------------------------------
// 4. SEO / GEO — citation probe
// -----------------------------------------------------------------------------

test('the citation score stays within 0..100 and matches its band', () => {
  for (let seed = 0; seed < 40; seed += 1) {
    const result = probeCitations('ai telefonreception', seed);
    assert.ok(result.score >= 0 && result.score <= 100, `score ${result.score} out of range`);
    assert.equal(result.sources.length, 3);
    const expected = result.score >= 70 ? 'stærk' : result.score >= 40 ? 'moderat' : 'svag';
    assert.equal(result.band, expected, `band must follow the score (${result.score})`);
  }
});

test('a cited source reports a position, an uncited one reports zero', () => {
  for (let seed = 0; seed < 25; seed += 1) {
    const result = probeCitations('x', seed);
    for (const source of result.sources) {
      if (source.cited) {
        assert.ok(source.position >= 1 && source.position <= 3, `bad position ${source.position}`);
      } else {
        assert.equal(source.position, 0);
      }
    }
  }
});

test('the probe always explains itself with at least one gap line', () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const result = probeCitations('x', seed);
    assert.ok(result.gaps.length >= 1, 'a score without an explanation is not actionable');
    for (const gap of result.gaps) assert.ok(gap.length > 10);
  }
});

test('full coverage scores higher than partial coverage', () => {
  const results = Array.from({ length: 60 }, (_, seed) => probeCitations('x', seed));
  const full = results.filter((r) => r.sources.every((s) => s.cited));
  const none = results.filter((r) => r.sources.every((s) => !s.cited));
  assert.ok(full.length > 0, 'the seed range should produce at least one full-coverage run');
  assert.ok(none.length > 0, 'and at least one empty run');
  assert.ok(Math.min(...full.map((r) => r.score)) > Math.max(...none.map((r) => r.score)));
});

// -----------------------------------------------------------------------------
// 5. Voice — call simulation
// -----------------------------------------------------------------------------

test('the call has a waveform, a transcript and a latency inside budget', () => {
  const result = simulateCall();
  assert.ok(result.waveform.length >= 32, 'the waveform needs enough bars to read');
  for (const amplitude of result.waveform) {
    assert.ok(amplitude >= 0 && amplitude <= 1, `amplitude ${amplitude} out of range`);
  }
  assert.ok(result.transcript.length >= 6, 'the transcript should read like a call');
  assert.ok(result.latencyMs < 300, 'the product budget is 300ms barge-in');
  assert.ok(['booket', 'viderestillet', 'taget notat'].includes(result.outcome));
});

test('turns alternate and are timestamped in order', () => {
  const result = simulateCall();
  let previous = -1;
  for (const turn of result.transcript) {
    assert.ok(turn.atMs > previous, 'timestamps must increase');
    assert.ok(turn.id.length > 0);
    assert.ok(turn.text.length > 0);
    assert.ok(turn.speaker === 'agent' || turn.speaker === 'kunde');
    previous = turn.atMs;
  }
  // It opens with the agent answering.
  assert.equal(result.transcript[0].speaker, 'agent');
  assert.equal(result.durationMs, result.transcript.length * 2400);
});

// -----------------------------------------------------------------------------
// 6. State machine
// -----------------------------------------------------------------------------

test('the dispatch state machine is a closed three-state loop', () => {
  assert.deepEqual(Object.keys(NEXT_DISPATCH_STATE), ['idle', 'running', 'done']);
  assert.equal(NEXT_DISPATCH_STATE.idle.next, 'running');
  assert.equal(NEXT_DISPATCH_STATE.running.next, 'done');
  assert.equal(NEXT_DISPATCH_STATE.done.next, 'idle');
  for (const entry of Object.values(NEXT_DISPATCH_STATE)) {
    assert.ok(entry.label.length > 0, 'every state needs a button label');
  }
});

// -----------------------------------------------------------------------------
// 7. The console component
// -----------------------------------------------------------------------------

test('the console has all four runners and no fifth', () => {
  const ids = [...code(console_).matchAll(/value: '(creative|paid-media|seo-geo|voice)'/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(ids, ['creative', 'paid-media', 'seo-geo', 'voice']);
});

test('the console timer is cleared on unmount and on re-dispatch', () => {
  const source = code(console_);
  assert.match(source, /clearTimeout\(timerRef\.current\)/);
  assert.match(source, /useEffect\(\(\) => clearTimer, \[clearTimer\]\)/);
  // Re-dispatch clears first, so two runs cannot overlap.
  const dispatchBody = source.slice(source.indexOf('const dispatch = useCallback'));
  assert.ok(dispatchBody.indexOf('clearTimer()') < dispatchBody.indexOf('setTimeout'));
});

test('nothing in the console polls or calls a real service', () => {
  const source = code(console_);
  assert.doesNotMatch(source, /setInterval|EventSource|WebSocket/);
  assert.doesNotMatch(source, /fetch\(|RTCPeerConnection|getUserMedia/);
  // The only RAF loop is the transcript playhead, and it is cancelled.
  assert.match(source, /cancelAnimationFrame\(frame\)/);
});

test('the console states plainly that it is a simulation', () => {
  assert.match(code(console_), /Simulering · ingen agent kaldes, ingen API-kald sendes, intet budget flyttes/);
});

// -----------------------------------------------------------------------------
// 8. Switchboard matrix
// -----------------------------------------------------------------------------

test('the matrix view is real tabular markup with both header axes', () => {
  const source = code(board);
  assert.match(source, /<table className="swm__grid">/);
  assert.match(source, /<caption className="sr-only">/);
  assert.match(source, /<th scope="col">Funktion<\/th>/);
  assert.match(source, /<th scope="row" className="swm__feature">/);
});

test('the matrix reflects state rather than restating it', () => {
  const source = code(board);
  assert.match(source, /const mode = modes\[feature\.id\] \?\? 'hidden';/);
  assert.match(source, /\{CLIENT_SEES\[mode\]\}/);
  // Counters are derived, not stored.
  assert.match(source, /const tally: Record<FeatureMode, number> = \{ active: 0, teaser: 0, hidden: 0 \}/);
});

test('the unified switchboard handles the all-hidden case explicitly', () => {
  const source = code(board);
  assert.match(source, /visible\.length === 0 \?/);
  // The copy wraps across lines in JSX, so match on the collapsed text.
  assert.match(source.replace(/\s+/g, ' '), /Alle funktioner er skjult/);
});

test('the three modes differ without colour alone', () => {
  assert.match(block, /\.swm__preview\[data-mode='teaser'\] \{ border-style: dashed; \}/);
  assert.match(block, /\.swm__preview\[data-mode='hidden'\] \{ color: var\(--muted\); background: transparent; \}/);
});

// -----------------------------------------------------------------------------
// 9. Theme hygiene
// -----------------------------------------------------------------------------

test('the simulation block is token-only and achromatic', () => {
  const literals = block.match(/#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g) ?? [];
  assert.deepEqual(literals, [], `literal colour: ${literals.join(', ')}`);
  assert.doesNotMatch(block, /purple|violet|indigo|magenta/i);
  for (const token of ['var(--panel)', 'var(--panel-2)', 'var(--border-control)', 'var(--line)']) {
    assert.ok(block.includes(token), `expected ${token}`);
  }
});

test('both components ship no colour literal, any, or suppression', () => {
  for (const [name, source] of [
    ['DispatchSimulationConsole.tsx', console_],
    ['FeatureSwitchboardSimulator.tsx', board],
    ['simulation.ts', engine],
  ] as const) {
    const body = code(source);
    assert.doesNotMatch(body, /#[0-9a-fA-F]{6}\b/, `${name} must carry no hex literal`);
    assert.doesNotMatch(body, /:\s*any\b/, `${name} must not declare any`);
    assert.doesNotMatch(body, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(body, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(body, /as unknown as/, `${name} must not use double casts`);
  }
});

test('the simulation honours reduced motion', () => {
  assert.match(code(console_), /useReducedMotion/);
  assert.match(code(console_), /springFor\(reduceMotion, SPRING\)/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
});

// -----------------------------------------------------------------------------
// 10. Milestone 2 — mount, unify, wire the feed
// -----------------------------------------------------------------------------

const roster = read('src/lib/workforce/roster.ts');
const shell = read('src/components/workforce/WorkforceConsole.tsx');

test('the dispatch console is mounted in the console shell', () => {
  assert.match(code(shell), /import \{ DispatchSimulationConsole \} from '\.\/DispatchSimulationConsole'/);
  assert.match(code(shell), /<DispatchSimulationConsole onDispatched=\{appendDispatch\} \/>/);
});

test('the switchboard is one component with two views, not two components', () => {
  const source = code(board);
  // One state object drives both renderings.
  const modeDeclarations = source.match(/useState<ModeByFeature>/g) ?? [];
  assert.equal(modeDeclarations.length, 1, 'the two views must share one state');
  assert.match(source, /const \[view, setView\] = useState<SwitchboardView>/);
  assert.match(source, /view === 'card' \?/);
  // The deleted duplicate must not be importable.
  assert.ok(!source.includes('SwitchboardMatrix'), 'no reference to the removed component');
});

test('both views share the same client portal preview', () => {
  // The preview sits outside the card/matrix conditional, so it cannot diverge.
  const source = code(board);
  const previewAt = source.indexOf('className="swb__preview"');
  const cardAt = source.indexOf("view === 'card' ?");
  assert.ok(previewAt > cardAt, 'the preview must render after the view branch, for both');
  assert.equal((source.match(/swb__preview-body/g) ?? []).length, 1, 'exactly one preview body');
});

test('toggling from either view writes the same state setter', () => {
  const source = code(board);
  const cardSetter = source.indexOf('onChange={(next) => setMode(feature.id, next)}');
  const matrixSetter = source.lastIndexOf('onChange={(next) => setMode(feature.id, next)}');
  assert.ok(cardSetter > 0 && matrixSetter > cardSetter, 'both views call setMode');
  assert.match(source, /const setMode = \(id: string, next: FeatureMode\) =>/);
});

test('a completed dispatch reports to the feed, not on click', () => {
  const source = code(console_);
  // The report fires inside the timeout, after the state flips to done.
  const body = source.slice(source.indexOf('timerRef.current = setTimeout'));
  assert.ok(
    body.indexOf('setState(\'done\')') < body.indexOf('onDispatched?.(runner)'),
    'the callback must fire after the run completes',
  );
  assert.match(source, /onDispatched\?\.\(runner\)/);
});

test('the shell is the single owner of the feed', () => {
  assert.match(code(shell), /const \[feed, setFeed\] = useState<ReadonlyArray<FeedEntry>>\(FEED_ENTRIES\)/);
  assert.match(code(shell), /<MissionActivityFeed entries=\{feed\} \/>/);
  // The dispatch console must not hold the log itself.
  assert.doesNotMatch(code(console_), /setFeed|useState<ReadonlyArray<FeedEntry>>/);
});

test('dispatch entries are prepended, capped, and cover all four runners', () => {
  const result = dispatchFeedEntries('creative', '12:00:00');
  assert.ok(result.length >= 2, 'a dispatch reports a dispatch line and an outcome');
  for (const entry of result) {
    assert.equal(entry.time, '12:00:00');
    assert.ok(entry.message.length > 20);
  }
  // Each runner has its own copy, so the log names the right specialist.
  for (const runner of ['creative', 'paid-media', 'seo-geo', 'voice'] as const) {
    const entries = dispatchFeedEntries(runner, '09:00:00');
    assert.ok(entries.length >= 2, `${runner} must report`);
    assert.ok(
      entries.some((entry) => entry.message.includes(runner)),
      `${runner} entries must name the runner`,
    );
  }
  // Cap and ordering are in the shell.
  assert.match(code(shell), /FEED_CAP = 40/);
  assert.match(code(shell), /\[...dispatchFeedEntries\(runner, at\), \.\.\.current\]\.slice\(0, FEED_CAP\)/);
});
