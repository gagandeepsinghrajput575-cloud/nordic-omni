import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const waveform = read('src/components/audio/Waveform.tsx');
const css = read('src/app/globals.css');
const orb = read('src/components/audio/OrbVisualizer.tsx');

/** WCAG 2.2 relative luminance + contrast ratio. */
function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Pull a custom property out of its declaration block. */
function token(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  assert.ok(match, `token ${name} must be declared as a hex colour`);
  return match[1];
}

test('obsidian studio ink clears WCAG AA against the black glass canvas', () => {
  const canvas = '#08090C';
  const pairs: [string, string, number][] = [
    ['--studio-ink', canvas, 4.5],
    ['--studio-ink-secondary', canvas, 4.5],
    ['--studio-ink-muted', canvas, 4.5],
    ['--studio-panel', '#08090C', 0],
  ];
  for (const [name, background] of pairs) {
    if (background === '#08090C' && name === '--studio-panel') continue;
    const ratio = contrast(token(name), background);
    assert.ok(ratio >= 4.5, `${name} must reach AA on obsidian (got ${ratio.toFixed(2)}:1)`);
  }
});

test('status pigments stay AA as ink, and iridescent pigments are never used as text', () => {
  const canvas = '#08090C';
  for (const name of ['--studio-mint', '--studio-amber', '--studio-rose', '--studio-cyan', '--studio-violet']) {
    const ratio = contrast(token(name), canvas);
    assert.ok(ratio >= 4.5, `${name} must reach AA on obsidian (got ${ratio.toFixed(2)}:1)`);
  }
  // Iridescent gradients are decorative: they may fill bars and orbs but the
  // stylesheet must never hand them to a text-bearing property.
  assert.doesNotMatch(css, /--studio-iri[^;]*;[\s\S]{0,80}?color:\s*var\(--studio-iri/);
  assert.match(css, /Iridescent pigments are decorative/);
});

test('the light shell pill inks keep AA on their own tinted surfaces', () => {
  const pairs: [string, string, number][] = [
    ['#4c1d95', '#f0e8fc', 4.5], // accent pill
    ['#2c6647', '#eaf4ec', 4.5], // live pill
    ['#8a5a16', '#faf4e7', 4.5], // warn pill
    ['#a13a35', '#fbefed', 4.5], // danger pill
    ['#1c1512', '#faf7f2', 4.5], // body text
    ['#75675e', '#faf7f2', 4.5], // muted text
  ];
  for (const [ink, surface, minimum] of pairs) {
    const ratio = contrast(ink, surface);
    assert.ok(ratio >= minimum, `${ink} on ${surface} must reach AA (got ${ratio.toFixed(2)}:1)`);
  }
  // Those exact inks must be the ones the light theme actually ships.
  for (const value of ['#4c1d95', '#2c6647', '#8a5a16', '#a13a35']) {
    assert.ok(css.toLowerCase().includes(value), `globals.css must ship ${value}`);
  }
});

test('reduced motion has an explicit static fallback for every animated studio element', () => {
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('OBSIDIAN STUDIO LAYER')));
  assert.ok(block.length > 0, 'the studio layer needs its own reduced-motion block');
  for (const selector of ['.wave-bar', '.dot-live', '.dot-thinking', '.latency-budget']) {
    assert.ok(block.includes(selector), `${selector} must be stilled under reduced motion`);
  }
  assert.match(css, /\.wave-bar\.is-live[^{]*\{\s*animation: none !important/);
});

test('the waveform and orb never claim motion they do not have', () => {
  // Waveform is CSS-driven: no RAF loop of its own, so it cannot leak a frame id.
  assert.doesNotMatch(waveform, /requestAnimationFrame/);
  assert.match(waveform, /aria-hidden="true"/);
  // Real analyser data must be opt-in and must not break the legacy call sites.
  assert.match(waveform, /levels\?: readonly number\[\]/);
  assert.match(waveform, /audioStream\?: MediaStream \| null/);
  // The orb owns exactly one RAF chain and cancels it on unmount.
  assert.equal((orb.match(/requestAnimationFrame/g) ?? []).length, 2);
  assert.match(orb, /cancelAnimationFrame/);
  assert.match(orb, /return \(\) => \{\s*stop\(\)/);
});

test('the spectrum sweeps hue across the sequence instead of repeating per bar', () => {
  // A gradient that repeats inside every bar reads as candy; the hue must travel.
  assert.match(waveform, /function barGradient\(progress: number\)/);
  assert.match(waveform, /rampAt\(STUDIO_RAMP, 0\.04 \+ progress \* 0\.9\)/);
  assert.match(waveform, /barGradient\(index \/ Math\.max\(1, count - 1\)\)/);
  // Muted and danger must stay flat so they cannot be mistaken for energy.
  assert.match(waveform, /tone === "accent" \? \{ backgroundImage: barGradient/);
});

test('telemetry is paired with a numeric read-out, never colour alone', () => {
  // Latency verdicts must be legible without hue.
  assert.match(waveform, /withinBudget \? "within" : "over"/);
  assert.match(waveform, /~\{measured\}ms/);
  assert.match(waveform, /budget = 300/);
  // The meter exposes a machine-readable value.
  assert.match(read('src/components/ui/primitives.tsx'), /role="meter"/);
  assert.match(read('src/components/ui/primitives.tsx'), /aria-valuenow=/);
});

test('no loose any or type suppressions in the studio surface', () => {
  for (const [name, source] of [
    ['Waveform.tsx', waveform],
    ['OrbVisualizer.tsx', orb],
    ['primitives.tsx', read('src/components/ui/primitives.tsx')],
    ['orb-shader.ts', read('src/lib/audio/orb-shader.ts')],
  ] as const) {
    assert.doesNotMatch(source, /:\s*any\b/, `${name} must not use a loose any`);
    assert.doesNotMatch(source, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(source, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(source, /as unknown as/, `${name} must not use double casts`);
  }
});

test('the studio palette is theme-scoped, not globally overwritten', () => {
  // Obsidian tokens are declared once; the eager aliasing only happens inside a
  // studio surface so the warm shell keeps its own identity.
  assert.match(css, /^:root \{[\s\S]*--studio-black: #08090c/m);
  assert.match(css, /\.studio-surface,\s*\.studio-panel \{/);
  const surfaceBlock = css.slice(css.indexOf('.studio-surface,\n.studio-panel {'));
  assert.ok(surfaceBlock.includes('--text-primary: var(--studio-ink)'));
  // The studio accent is pure white now, so the instrument has no hue at all.
  assert.ok(surfaceBlock.includes('--accent-primary: #ffffff') || surfaceBlock.includes('--accent-primary: var(--studio-ink'));
  // And the studio layer must not reintroduce a chromatic accent.
  assert.doesNotMatch(surfaceBlock, /--accent-primary: #(?!ffffff)[0-9a-f]{6}/i);
});
