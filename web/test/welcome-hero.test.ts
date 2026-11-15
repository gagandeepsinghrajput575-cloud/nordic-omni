import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const hero = read('src/components/welcome/HeroHeadline.tsx');
const tabs = read('src/components/welcome/GlidingTabSwitcher.tsx');
const wave = read('src/components/welcome/WaveformVisualizer.tsx');
const card = read('src/components/welcome/StudioPlaygroundCard.tsx');
const section = read('src/components/welcome/HeroSection.tsx');
const page = read('src/app/welcome/page.tsx');
const css = read('src/app/globals.css');
const glass = read('src/components/ui/glass.tsx');

/**
 * Source with comments removed.
 *
 * Several assertions below are negative ("must not contain X"). Without this,
 * a doc comment that *names* the thing being forbidden trips the test — which
 * is a bug in the assertion, not in the component.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const WELCOME_FILES = [
  ['HeroHeadline.tsx', hero],
  ['GlidingTabSwitcher.tsx', tabs],
  ['WaveformVisualizer.tsx', wave],
  ['StudioPlaygroundCard.tsx', card],
  ['HeroSection.tsx', section],
] as const;

// -----------------------------------------------------------------------------
// 1. One spring vocabulary
// -----------------------------------------------------------------------------

test('the glass primitives no longer redeclare the spring', () => {
  // Previously glass.tsx restated the literals, creating a second source of
  // truth that could drift from lib/motion/springs.ts.
  assert.doesNotMatch(glass, /export const SPRING\b\s*=/);
  assert.match(glass, /import \{[^}]*\bSPRING\b[^}]*\} from '@\/lib\/motion\/springs'/);
  assert.match(glass, /export \{ SPRING, SPRING_SOFT \};/);
});

test('every welcome component resolves motion from the shared vocabulary', () => {
  for (const [name, source] of WELCOME_FILES) {
    if (!/motion\.|requestAnimationFrame/.test(source)) continue;
    assert.match(
      source,
      /from '@\/lib\/motion\/springs'/,
      `${name} must import its motion from the shared vocabulary`,
    );
  }
  // No component may restate a spring curve inline.
  for (const [name, source] of WELCOME_FILES) {
    assert.doesNotMatch(source, /stiffness:\s*\d+/, `${name} must not declare a stiffness`);
    assert.doesNotMatch(source, /damping:\s*\d+/, `${name} must not declare a damping`);
  }
});

// -----------------------------------------------------------------------------
// 2. Reduced motion
// -----------------------------------------------------------------------------

test('the waveform has an explicit static SVG fallback', () => {
  assert.match(wave, /useReducedMotion/);
  // A real second render path, not a CSS opacity trick.
  assert.match(wave, /reduceMotion \? \(\s*<svg/);
  assert.match(wave, /className="wf-static"/);
  assert.match(wave, /<path/);
});

test('the stylesheet disables every welcome transition under reduced motion', () => {
  const block = css.slice(css.indexOf('Piece 1 — Welcome hero'),
    css.indexOf('Piece 2 — Bento'));
  assert.ok(block.length > 0, 'the welcome block must exist');
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(block, /\.wf-bar \{ transition: none; \}/);
  assert.match(block, /\.studio-play \{ transition: none; \}/);
});

test('the studio card snaps its thumb rather than gliding under reduced motion', () => {
  // SegmentedControl already routes through springFor-equivalent logic; the
  // card must pass the reduceMotion-aware transition, not a raw SPRING.
  assert.match(card, /springFor\(reduceMotion, SPRING\)/);
  assert.match(card, /useReducedMotion/);
});

// -----------------------------------------------------------------------------
// 3. The card owns the clock, the waveform owns none
// -----------------------------------------------------------------------------

test('exactly one requestAnimationFrame loop exists in the welcome surface', () => {
  const total = WELCOME_FILES.reduce(
    (sum, [, source]) => sum + (code(source).match(/requestAnimationFrame/g)?.length ?? 0),
    0,
  );
  // Two occurrences in the card: the call and the re-schedule. Zero elsewhere.
  assert.equal(total, 2, 'the clock must live only in StudioPlaygroundCard');
  assert.doesNotMatch(wave, /requestAnimationFrame/);
  assert.match(card, /cancelAnimationFrame/);
  // And it is cancelled on unmount, so no frame leaks after navigation.
  assert.match(card, /useEffect\(\(\) => stopClock, \[stopClock\]\)/);
});

test('the playground is labelled a simulation, never presented as real audio', () => {
  assert.match(card, /Simulated preview · no audio/);
  assert.doesNotMatch(card, /new Audio\(|<audio/);
  assert.doesNotMatch(section, /new Audio\(|<audio/);
});

// -----------------------------------------------------------------------------
// 4. Accessibility
// -----------------------------------------------------------------------------

test('the scrub affordance is a real slider with keyboard seeking', () => {
  assert.match(wave, /role="slider"/);
  assert.match(wave, /aria-valuenow=\{Math\.round\(position \* 100\)\}/);
  assert.match(wave, /aria-valuetext/);
  assert.match(wave, /tabIndex=\{0\}/);
  assert.match(wave, /event\.key/);
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End'] as const) {
    assert.ok(wave.includes(key), `the slider must support ${key}`);
  }
});

test('the tab switcher is a tablist of real buttons', () => {
  // Delegation, not reimplementation: the glide must be the one shared thumb.
  assert.match(tabs, /SegmentedControl/);
  assert.doesNotMatch(code(tabs), /layoutId=/, 'the thumb is owned by SegmentedControl');
  assert.match(tabs, /label=\{label\}/);
});

test('decorative geometry is hidden from the accessibility tree', () => {
  assert.match(wave, /aria-hidden="true"/);
  assert.match(card, /aria-hidden="true"/);
  // The transport button carries a real accessible name.
  assert.match(card, /aria-label=\{state === 'playing' \? 'Pause preview' : 'Play preview'\}/);
});

// -----------------------------------------------------------------------------
// 5. Theme tokens, not literals
// -----------------------------------------------------------------------------

test('the welcome surface reads its colours from tokens', () => {
  const block = css.slice(css.indexOf('Piece 1 — Welcome hero'),
    css.indexOf('Piece 2 — Bento'));
  // Every surface, border and ink in the new block resolves from a variable.
  for (const token of [
    'var(--bg)',
    'var(--glass)',
    'var(--border-control)',
    'var(--el-elevated)',
    'var(--el-ink-muted)',
    'var(--el-ink-secondary)',
    'var(--primary-bg)',
    'var(--primary-ink)',
    'var(--shadow-button)',
    'var(--hl)',
    'var(--blur)',
    'var(--focus-ring)',
    'var(--r-xl)',
  ]) {
    assert.ok(block.includes(token), `the welcome block must use ${token}`);
  }
});

test('the welcome block declares no hard-coded colour', () => {
  const block = css.slice(css.indexOf('Piece 1 — Welcome hero'),
    css.indexOf('Piece 2 — Bento'));
  const literals = block.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
  assert.deepEqual(literals, [], 'the welcome block must be token-only');
});

test('the orbs are achromatic by construction', () => {
  // Silver -> zinc: the lift is derived from --text, never from a hue.
  assert.match(css, /\.studio-tile-orb \{[\s\S]*?color-mix\(in srgb, var\(--text\)/);
  assert.doesNotMatch(css.slice(css.indexOf('Piece 1 — Welcome hero'),
    css.indexOf('Piece 2 — Bento')), /hsl\(/);

  // And no component ships a chromatic literal of its own.
  const offenders: string[] = [];
  const dir = new URL('../src/components/welcome/', import.meta.url);
  for (const entry of readdirSync(dir)) {
    if (!/\.tsx$/.test(entry)) continue;
    const source = readFileSync(new URL(entry, dir), 'utf8');
    for (const match of source.matchAll(/#[0-9a-fA-F]{6}\b|rgba?\(\s*\d+[,\s]+\d+[,\s]+\d+/g)) {
      const numbers = match[0].match(/\d+/g);
      if (!numbers) continue;
      const [r, g, b] = numbers.map(Number);
      if (Math.max(r, g, b) - Math.min(r, g, b) <= 12) continue;
      offenders.push(`${entry}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `chromatic literals in welcome components: ${offenders.join(', ')}`);
});

test('the light theme overrides the segment thumb rather than reusing a white wash', () => {
  assert.match(
    css,
    /:root\[data-theme='light'\] \.el-segment-track \{[\s\S]*?rgba\(9, 9, 11/,
  );
});

// -----------------------------------------------------------------------------
// 6. Route shape
// -----------------------------------------------------------------------------

test('the welcome route is public and does not read a session', () => {
  assert.doesNotMatch(page, /getSession|redirect\(|requireUser/);
  assert.match(page, /export default function WelcomePage/);
  assert.match(page, /<HeroSection \/>/);
  assert.match(page, /className="welcome-shell"/);
});

test('scope stays headline and canvas: no marketing nav or announcement bar', () => {
  // Decision D2: deliberately excluded so the route never branches on auth.
  const markup = code(section);
  assert.doesNotMatch(markup, /<nav|<header/i);
  assert.doesNotMatch(markup, />\s*(Log in|Sign up)\s*</);
  assert.doesNotMatch(markup, /announcement/i);
});

// -----------------------------------------------------------------------------
// 7. Type hygiene
// -----------------------------------------------------------------------------

test('the welcome surface ships no any, casts or suppressions', () => {
  for (const [name, source] of WELCOME_FILES) {
    assert.doesNotMatch(source, /:\s*any\b/, `${name} must not declare any`);
    assert.doesNotMatch(source, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(source, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(source, /as unknown as/, `${name} must not use double casts`);
  }
});

test('the props contracts are exported and narrow', () => {
  assert.match(hero, /export interface HeroHeadlineProps/);
  assert.match(tabs, /export interface GlidingTabSwitcherProps<T extends string>/);
  assert.match(wave, /export interface WaveformVisualizerProps/);
  assert.match(card, /export interface StudioPlaygroundCardProps/);
  assert.match(card, /export type StudioMode/);
  // The mode union is closed rather than a bare string.
  assert.match(card, /export type StudioMode = 'speech' \| 'agent' \| 'studio';/);
});
