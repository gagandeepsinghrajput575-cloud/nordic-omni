import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_FEATURE_MODES,
  FEATURE_MODES,
  FEED_ENTRIES,
  ORCHESTRATOR_METRICS,
  PODS,
  PORTAL_FEATURES,
} from '../src/lib/workforce/roster';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const header = read('src/components/workforce/WorkforceHeader.tsx');
const pod = read('src/components/workforce/EmployeePodCard.tsx');
const board = read('src/components/workforce/FeatureSwitchboardSimulator.tsx');
const feed = read('src/components/workforce/MissionActivityFeed.tsx');
const console_ = read('src/components/workforce/WorkforceConsole.tsx');
const page = read('src/app/(agency)/agency/workforce/page.tsx');
const layout = read('src/app/(agency)/agency/layout.tsx');
const css = read('src/app/globals.css');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const block = css.slice(css.indexOf('Agency workforce console'), css.length);

// -----------------------------------------------------------------------------
// 1. The roster
// -----------------------------------------------------------------------------

test('there are exactly four specialised pods, each distinct', () => {
  assert.equal(PODS.length, 4);
  const ids = PODS.map((entry) => entry.id);
  assert.deepEqual(ids, ['creative', 'paid-media', 'seo-geo', 'voice']);
  assert.equal(new Set(ids).size, 4, 'pod ids must be unique');
  for (const entry of PODS) {
    assert.ok(entry.role.length > 0, `${entry.id} needs a role`);
    assert.ok(entry.charter.length > 0, `${entry.id} needs a charter`);
    assert.equal(entry.metrics.length, 3, `${entry.id} renders a three-cell metric row`);
    assert.ok(entry.capabilities.length >= 3, `${entry.id} needs capability tags`);
    assert.equal(entry.drawer.length, 4, `${entry.id} drawer pre-renders four rows`);
  }
});

test('each pod carries the capabilities the brief specifies', () => {
  const creative = PODS[0];
  assert.ok(creative.capabilities.some((c) => /hook/i.test(c)));
  assert.ok(creative.capabilities.some((c) => /rag/i.test(c)));
  assert.ok(creative.capabilities.some((c) => /prompt/i.test(c)));

  const paid = PODS[1];
  assert.ok(paid.capabilities.some((c) => /meta|google/i.test(c)));
  assert.ok(paid.capabilities.some((c) => /cbo/i.test(c)));

  const seo = PODS[2];
  assert.ok(seo.capabilities.some((c) => /citation/i.test(c)));
  assert.ok(seo.capabilities.some((c) => /schema/i.test(c)));

  const voice = PODS[3];
  assert.ok(voice.capabilities.some((c) => /150\s?ms/i.test(c)));
  assert.ok(voice.capabilities.some((c) => /dansk/i.test(c)));
});

test('the orchestrator metric row is four cells', () => {
  assert.equal(ORCHESTRATOR_METRICS.length, 4);
  for (const metric of ORCHESTRATOR_METRICS) {
    assert.ok(metric.label.length > 0);
    assert.ok(metric.value.length > 0);
  }
});

// -----------------------------------------------------------------------------
// 2. The prototype is labelled as one
// -----------------------------------------------------------------------------

test('the HUD says the numbers are a sample, not a live feed', () => {
  const source = code(header);
  assert.match(source, /Prototype · alle tal er faste eksempelværdier/);
  assert.match(page, /Prototype/);
});

test('nothing in the console pretends to poll or stream', () => {
  for (const [name, source] of [
    ['WorkforceHeader.tsx', header],
    ['EmployeePodCard.tsx', pod],
    ['FeatureSwitchboardSimulator.tsx', board],
    ['MissionActivityFeed.tsx', feed],
    ['WorkforceConsole.tsx', console_],
  ] as const) {
    // Comments stripped: MissionActivityFeed's doc comment names setInterval to
    // explain why it is not used.
    assert.doesNotMatch(
      code(source),
      /setInterval|EventSource|WebSocket|requestAnimationFrame/i,
      `${name} must not fake a live feed`,
    );
  }
});

test('the feed states that it is a sample', () => {
  assert.match(code(feed), /sample/);
  // And its timestamps are authored, not generated.
  for (const entry of FEED_ENTRIES) {
    assert.match(entry.time, /^\d{2}:\d{2}:\d{2}$/);
  }
});

// -----------------------------------------------------------------------------
// 3. Pod card interaction
// -----------------------------------------------------------------------------

test('the drawer is a real disclosure button', () => {
  const source = code(pod);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{drawerId\}/);
  assert.match(source, /const drawerId = useId\(\)/);
  assert.match(source, /onClick=\{\(\) => setOpen\(\(current\) => !current\)\}/);
});

test('the drawer animates through the shared spring, and collapses under reduced motion', () => {
  const source = code(pod);
  assert.match(source, /from '@\/lib\/motion\/springs'/);
  assert.match(source, /springFor\(reduceMotion, SPRING\)/);
  assert.doesNotMatch(source, /stiffness:\s*\d+/);
  // Reduced motion still opens, just without travelling.
  assert.match(source, /initial=\{reduceMotion \? false : \{ height: 0, opacity: 0 \}\}/);
  assert.match(source, /<AnimatePresence initial=\{false\}>/);
});

test('status is carried by a badge with a dot and a label', () => {
  const source = code(pod);
  assert.match(source, /<Badge tone=\{STATUS_TONE\[pod\.status\]\} dot>/);
  assert.match(source, /const STATUS_TONE: Record<PodStatus, /);
  assert.match(source, /\{pod\.statusLabel\}/);
});

// -----------------------------------------------------------------------------
// 4. Three-way switchboard
// -----------------------------------------------------------------------------

test('the three modes are exactly active, teaser and hidden', () => {
  assert.deepEqual(
    FEATURE_MODES.map((mode) => mode.value),
    ['active', 'teaser', 'hidden'],
  );
  assert.deepEqual(
    FEATURE_MODES.map((mode) => mode.label),
    ['Aktiv', 'Teaser', 'Skjult'],
  );
});

test('the default state exercises all three modes', () => {
  const values = Object.values(DEFAULT_FEATURE_MODES);
  assert.ok(values.includes('active'));
  assert.ok(values.includes('teaser'));
  assert.ok(values.includes('hidden'));
  // Every feature has a default, so no row starts undefined.
  for (const feature of PORTAL_FEATURES) {
    assert.ok(DEFAULT_FEATURE_MODES[feature.id], `${feature.id} needs a default`);
  }
});

test('the preview reflects the switch state rather than restating it', () => {
  const source = code(board);
  // Hidden features are filtered out of the preview entirely.
  assert.match(source, /PORTAL_FEATURES\.filter\(\(feature\) => \(modes\[feature\.id\] \?\? 'hidden'\) !== 'hidden'\)/);
  // Teaser rows are marked as such.
  assert.match(source, /data-mode=\{mode\}/);
  assert.match(source, /\{mode === 'teaser' \? \(/);
  // And the empty case is handled explicitly.
  assert.match(source, /visible\.length === 0 \?/);
});

test('the three states differ without colour alone', () => {
  // Teaser is dashed, not merely tinted.
  assert.match(block, /\.swb__item\[data-mode='teaser'\] \{[\s\S]*?border-style: dashed;/);
  // Hidden is absent from the DOM, and the empty state is described in words.
  assert.match(code(board), /Alle funktioner er skjult/);
});

test('the switchboard reuses the shared segmented pill', () => {
  const source = code(board);
  assert.match(source, /<SegmentedControl/);
  assert.doesNotMatch(source, /layoutId/, 'the thumb belongs to SegmentedControl');
});

// -----------------------------------------------------------------------------
// 5. Theme and tokens
// -----------------------------------------------------------------------------

test('the console block is token-only and introduces no chromatic value', () => {
  const literals = block.match(/#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g) ?? [];
  assert.deepEqual(literals, [], `literal colour in the block: ${literals.join(', ')}`);
  assert.doesNotMatch(block, /purple|violet|indigo|magenta/i);
  // The brief's three elevations are all in play.
  for (const token of ['var(--panel)', 'var(--panel-2)', 'var(--border-control)']) {
    assert.ok(block.includes(token), `expected ${token}`);
  }
});

test('the components ship no colour literal and no synthetic purple', () => {
  for (const [name, source] of [
    ['WorkforceHeader.tsx', header],
    ['EmployeePodCard.tsx', pod],
    ['FeatureSwitchboardSimulator.tsx', board],
    ['MissionActivityFeed.tsx', feed],
    ['WorkforceConsole.tsx', console_],
  ] as const) {
    const body = code(source);
    assert.doesNotMatch(body, /#[0-9a-fA-F]{6}\b/, `${name} must carry no hex literal`);
    assert.doesNotMatch(body, /purple|violet|indigo/i, `${name} must not name a hue`);
    assert.doesNotMatch(body, /:\s*any\b/, `${name} must not declare any`);
    assert.doesNotMatch(body, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(body, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(body, /as unknown as/, `${name} must not use double casts`);
  }
});

test('verified feed lines read brighter, not tinted', () => {
  assert.match(block, /\.feed__line\[data-verified='true'\] \.feed__msg \{ color: var\(--text\); \}/);
  // The unverified default is the secondary ink, so the delta is brightness.
  assert.match(block, /\.feed__msg \{ color: var\(--text-secondary\)/);
});

test('the live dot is always paired with a word and stops under reduced motion', () => {
  assert.match(code(header), /<span className="wf-dot" data-state="live" aria-hidden="true" \/>/);
  assert.match(code(header), /Orkestrator/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(block, /\.wf-dot\[data-state='live'\] \{ animation: none; \}/);
  assert.match(block, /\.pod:hover \{ transform: none; \}/);
});

// -----------------------------------------------------------------------------
// 6. Route, navigation and landmarks
// -----------------------------------------------------------------------------

test('the route is agency-gated and adds no second main landmark', () => {
  assert.match(page, /await requireAgency\(\)/);
  // The shell owns the main landmark.
  assert.doesNotMatch(code(page), /<main/);
  assert.match(page, /export const dynamic = 'force-dynamic'/);
});

test('the route is reachable from the agency navigation', () => {
  assert.match(layout, /\{ href: '\/agency\/workforce', label: 'AI workforce', icon: 'users' \}/);
});

test('the console composes all four required surfaces', () => {
  const source = code(console_);
  for (const component of [
    '<WorkforceHeader',
    '<EmployeePodCard',
    '<FeatureSwitchboardSimulator />',
    '<MissionActivityFeed',
  ]) {
    assert.ok(source.includes(component), `missing ${component}`);
  }
  // And renders one card per pod.
  assert.match(source, /PODS\.map\(\(pod, index\) => \(/);
});

test('the heading sections use their own label rather than a mismatched id', () => {
  // SectionTitle already renders the <h2>; an id-bearing span inside it would
  // have produced a heading containing only a span.
  assert.doesNotMatch(code(console_), /aria-labelledby="pods-heading"/);
  assert.match(code(console_), /aria-label="Specialister"/);
});
