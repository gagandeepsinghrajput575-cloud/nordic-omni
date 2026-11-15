import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const orb = read('src/components/welcome/ConversationalOrb.tsx');
const hud = read('src/components/welcome/TelemetryHud.tsx');
const section = read('src/components/welcome/ConversationalPlatformSection.tsx');
const css = read('src/app/globals.css');
const page = read('src/app/welcome/page.tsx');

/** Comments removed, so negative assertions test behaviour rather than prose. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const convBlock = css.slice(css.indexOf('Piece 3 — Conversational'), css.length);

// -----------------------------------------------------------------------------
// 1. The orb never stops being an orb
// -----------------------------------------------------------------------------

test('the orb has a real static SVG path under reduced motion', () => {
  assert.match(code(orb), /if \(reduceMotion\) \{/);
  // An actual second render, not a CSS throttle of the animated one.
  const staticPath = code(orb).slice(code(orb).indexOf('if (reduceMotion)'), code(orb).indexOf('return (\n    <div', code(orb).indexOf('if (reduceMotion)')));
  assert.match(staticPath, /<svg/);
  assert.match(staticPath, /role="img"/);
  assert.match(staticPath, /aria-label=\{`\$\{label\}: \$\{copy\}/);
  // The static path must contain no motion component at all.
  assert.doesNotMatch(staticPath, /motion\./);
});

test('the breathing loop is CSS, not a spring', () => {
  // A spring settles; a continuous breath must not be modelled as one.
  assert.match(convBlock, /@keyframes conv-breathe-ring/);
  assert.match(code(orb), /animation: `conv-breathe-ring/);
  // And no RAF loop is introduced for the orb.
  assert.doesNotMatch(code(orb), /requestAnimationFrame/);
});

test('orb state changes ride the shared spring', () => {
  const source = code(orb);
  assert.match(source, /from '@\/lib\/motion\/springs'/);
  assert.match(source, /springFor\(reduceMotion, SPRING\)/);
  assert.doesNotMatch(source, /stiffness:\s*\d+/);
  assert.doesNotMatch(source, /damping:\s*\d+/);
  // Only compositor-friendly properties are animated.
  for (const prop of ['opacity', 'scale']) {
    assert.ok(source.includes(prop), `the orb should animate ${prop}`);
  }
  assert.doesNotMatch(source, /animate=\{\{[^}]*(width|height|top|left):/, 'no layout animation');
});

test('the orb state is also announced in text', () => {
  // Motion must not be the only channel carrying the state.
  assert.match(code(orb), /className="conv-orb__label"/);
  assert.match(code(orb), /aria-live="polite"/);
  assert.match(code(orb), /const STATE_COPY: Record<OrbState, string>/);
});

test('the orb is monochrome: gradients derive from tokens, not hues', () => {
  const source = code(orb);
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, 'the orb must carry no hex literal');
  assert.doesNotMatch(source, /hsl\(/);
  assert.doesNotMatch(source, /linear-gradient\([^)]*(149|rebeccapurple|violet|purple)/i);
  // The gradient stops in CSS are keyword or token derived.
  assert.match(convBlock, /--studio-panel/);
  assert.match(convBlock, /color-mix\(in srgb, white/);
});

// -----------------------------------------------------------------------------
// 2. Telemetry HUD
// -----------------------------------------------------------------------------

test('the latency pill derives its own tone from the measurement', () => {
  const source = code(hud);
  assert.match(source, /const LATENCY_TARGET_MS = 150;/);
  assert.match(source, /const withinTarget = measured < LATENCY_TARGET_MS;/);
  // The copy is computed, so a slow number cannot be labelled fast.
  assert.match(source, /\{withinTarget \? '<' : ''\}/);
  assert.match(source, /\{measured\} ms latenstid/);
});

test('telemetry figures are tabular so a live value cannot shift the column', () => {
  assert.match(convBlock, /\.conv-stat__value \{[\s\S]*?font-variant-numeric: tabular-nums;/);
  assert.match(convBlock, /font-feature-settings: 'tnum' 1;/);
  assert.match(convBlock, /\.conv-pill \{[\s\S]*?font-variant-numeric: tabular-nums;/);
});

test('the duplex and turn indicators use the shared status dot', () => {
  // Exactly one chromatic pixel in the band, and it is the documented token.
  assert.match(convBlock, /\.conv-dot \{[\s\S]*?background: var\(--dot-online\);/);
  assert.match(convBlock, /\.conv-dot\[data-state='idle'\]/);
  // Green is paired with text, so colour is never the only signal.
  assert.match(code(hud), /duplexing \? 'Fuld duplex' : 'Halv duplex'/);
  assert.match(code(hud), /TURN_COPY\[turn\]/);
});

test('every stat renders its own label and unit', () => {
  const source = code(hud);
  assert.match(source, /export interface TelemetryStat/);
  assert.match(source, /\{stat\.label\}/);
  assert.match(source, /\{stat\.unit \? <span className="conv-stat__unit">\{stat\.unit\}<\/span> : null\}/);
});

// -----------------------------------------------------------------------------
// 3. Demo bar
// -----------------------------------------------------------------------------

test('the call trigger is a scripted state machine, labelled a simulation', () => {
  const source = code(section);
  assert.match(source, /type Phase = 'idle' \| 'ringing' \| 'listening' \| 'speaking' \| 'ended'/);
  assert.match(source, /const PHASE_MS/);
  assert.match(source, /Simuleret WebRTC · intet opkald oprettes/);
  // No real transport is created.
  assert.doesNotMatch(source, /RTCPeerConnection|getUserMedia|new WebSocket/);
});

test('the call timer is cleared on unmount', () => {
  const source = code(section);
  assert.match(source, /clearTimeout\(timerRef\.current\)/);
  assert.match(source, /useEffect\(\(\) => clearTimer, \[clearTimer\]\)/);
});

test('the persona selector is the shared gliding pill', () => {
  const source = code(section);
  assert.match(source, /<GlidingTabSwitcher/);
  assert.match(source, /label="Vælg stemmepersona"/);
  assert.doesNotMatch(source, /layoutId/, 'the thumb belongs to SegmentedControl');
});

test('the orb and the HUD read from one state machine', () => {
  const source = code(section);
  // Both receive their state from the same `phase`, so they cannot disagree.
  assert.match(source, /const ORB_FOR_PHASE: Record<Phase, OrbState>/);
  assert.match(source, /state=\{ORB_FOR_PHASE\[phase\]\}/);
  assert.match(source, /const turn =\s*phase === 'listening'/);
  assert.match(source, /duplexing=\{duplexing\}/);
});

// -----------------------------------------------------------------------------
// 4. Theme invariants
// -----------------------------------------------------------------------------

test('the band sits on the studio ground, which does not flip with the theme', () => {
  // Deliberate exception to the page ground: the orb needs obsidian to read as
  // luminous. Asserted so a future sweep does not "fix" it to --bg.
  assert.match(convBlock, /\.conv-section \{[\s\S]*?background: var\(--studio-black\);/);
  assert.match(css, /--studio-black: #08090c;/);
});

test('the band references only tokens that are declared', () => {
  // A misspelled token falls back silently and loses the plate entirely. These
  // three were caught during construction: they do not exist.
  for (const phantom of ['--studio-bg', '--studio-elevated', '--studio-mesh-a', '--studio-mesh-b']) {
    assert.ok(
      !convBlock.includes(`var(${phantom}`),
      `${phantom} is not declared and must not be referenced`,
    );
  }
  for (const real of ['--studio-black', '--studio-panel', '--studio-ink', '--studio-line-strong']) {
    assert.ok(convBlock.includes(`var(${real}`), `the band should use ${real}`);
  }
});

test('the brief-named tokens are still in use', () => {
  const all = convBlock + code(hud) + code(section);
  for (const token of ['--border-control', '--text-primary', '--text-secondary', '--dot-online']) {
    assert.ok(all.includes(token), `expected ${token}`);
  }
});

test('the block introduces no synthetic purple', () => {
  assert.doesNotMatch(convBlock, /purple|violet|magenta|indigo|#7c3aed|#8b5cf6/i);
  for (const source of [code(orb), code(hud), code(section)]) {
    assert.doesNotMatch(source, /purple|violet|indigo/i);
  }
});

test('the chromatic surface is only the two documented dots', () => {
  const literals = convBlock.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  // The band declares no hex of its own; the dots come through --dot-online.
  assert.deepEqual(literals, [], `chromatic hex leaked: ${literals.join(', ')}`);
});

test('reduced motion disables the breathing dot and the button transform', () => {
  assert.match(convBlock, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(convBlock, /\.conv-dot\[data-state='live'\] \{ animation: none; \}/);
  assert.match(convBlock, /\.conv-call:hover:not\(:disabled\),\s*\.conv-call:active:not\(:disabled\) \{ transform: none; \}/);
});

// -----------------------------------------------------------------------------
// 5. Mounting and hygiene
// -----------------------------------------------------------------------------

test('the section mounts directly beneath the bento grid', () => {
  assert.match(page, /<BentoGrid \/>\s*<ConversationalPlatformSection \/>/);
  assert.match(
    page,
    /import \{ ConversationalPlatformSection \} from '@\/components\/welcome\/ConversationalPlatformSection';/,
  );
});

test('the conversational surface ships no any, casts or suppressions', () => {
  for (const [name, source] of [
    ['ConversationalOrb.tsx', orb],
    ['TelemetryHud.tsx', hud],
    ['ConversationalPlatformSection.tsx', section],
  ] as const) {
    assert.doesNotMatch(source, /:\s*any\b/, `${name} must not declare any`);
    assert.doesNotMatch(source, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(source, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(source, /as unknown as/, `${name} must not use double casts`);
  }
});

test('the props contracts are exported and narrow', () => {
  assert.match(orb, /export type OrbState = 'idle' \| 'listening' \| 'speaking';/);
  assert.match(orb, /export interface ConversationalOrbProps/);
  assert.match(hud, /export interface TelemetryStat/);
  assert.match(hud, /export interface TelemetryHudProps/);
  assert.match(section, /export type PersonaId/);
});
