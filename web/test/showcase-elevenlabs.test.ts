import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const css = read('src/app/globals.css');
const glass = read('src/components/ui/glass.tsx');
const playground = read('src/components/showcase/VoicePlayground.tsx');
const showcase = read('src/components/showcase/ShowcaseExperience.tsx');
const shell = read('src/components/shell/AppShell.tsx');

// -----------------------------------------------------------------------------
// WCAG helpers (same maths as studio-contract.test.ts, kept local so this suite
// can assert its own layer without importing another test file)
// -----------------------------------------------------------------------------

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

/**
 * The glass layer's dark ramp lives in the `:root` block that opens the layer
 * itself; the light ramp is an override further up in the theme spine.
 */
function ramp(theme: 'light' | 'dark'): string {
  if (theme === 'dark') {
    const start = css.indexOf('ELEVENLABS GLASS LAYER');
    assert.ok(start >= 0, 'the glass layer must exist');
    return css.slice(start);
  }
  const start = css.search(/\:root\[data-theme='light'\]/);
  assert.ok(start >= 0, 'a light ramp must exist');
  const end = css.indexOf('\n}', start);
  assert.ok(end > start, 'the light ramp must close');
  return css.slice(start, end);
}

/**
 * Pull an `--el-*` custom property out of a named theme. The glass layer now
 * declares the same token names twice, once per theme, so an unscoped match
 * would silently read whichever ramp happens to come first.
 */
function token(name: string, theme: 'light' | 'dark' = 'dark'): string {
  const match = ramp(theme).match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `token ${name} must be declared as a hex colour in the ${theme} ramp`);
  return match[1];
}

/** Every elevation text can sit on in the dark glass layer. */
const ELEVATIONS = ['#050507', '#0b0b0f', '#121218'] as const;

/** And the light glass layer's three elevations. */
const LIGHT_ELEVATIONS = ['#fafafa', '#ffffff', '#f4f4f5'] as const;

// -----------------------------------------------------------------------------
// 1. Contrast
// -----------------------------------------------------------------------------

test('every glass ink clears WCAG AA on all three elevations', () => {
  const inks = [
    '--el-ink',
    '--el-ink-secondary',
    '--el-ink-muted',
    '--el-accent',
    '--el-violet',
    '--el-cyan',
    '--el-mint',
    '--el-amber',
    '--el-rose',
  ];
  for (const name of inks) {
    const hex = token(name);
    for (const elevation of ELEVATIONS) {
      const ratio = contrast(hex, elevation);
      // 4.5:1 is the AA floor for normal body text.
      assert.ok(
        ratio >= 4.5,
        `${name} (${hex}) on ${elevation} must reach AA, got ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test('the glass ground is the documented obsidian values', () => {
  assert.equal(token('--el-black'), '#050507');
  assert.equal(token('--el-surface'), '#0b0b0f');
  assert.equal(token('--el-elevated'), '#121218');
});

test('the light glass layer inverts to paper white with ink-black type', () => {
  assert.equal(token('--el-black', 'light'), '#fafafa');
  assert.equal(token('--el-surface', 'light'), '#ffffff');
  assert.equal(token('--el-elevated', 'light'), '#f4f4f5');
  assert.equal(token('--el-ink', 'light'), '#09090b');
  assert.equal(token('--el-accent', 'light'), '#09090b');
});

test('every glass ink clears WCAG AA on all three light elevations', () => {
  // The same nine inks, re-measured against paper white. #71717a would fail
  // here (4.40:1 on #f4f4f5), which is why light muted is #6b6b74.
  for (const name of ['--el-ink', '--el-ink-secondary', '--el-ink-muted', '--el-accent', '--el-violet', '--el-cyan', '--el-mint', '--el-amber', '--el-rose']) {
    const hex = token(name, 'light');
    for (const elevation of LIGHT_ELEVATIONS) {
      const ratio = contrast(hex, elevation);
      assert.ok(
        ratio >= 4.5,
        `${name} (${hex}) on ${elevation} must reach AA, got ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test('iridescent gradients are never handed to a text property', () => {
  // Decorative only: a gradient used as `color` would be invisible or a contrast
  // failure. The stylesheet must never do it in the glass layer.
  const glassLayer = css.slice(css.indexOf('ELEVENLABS GLASS LAYER'));
  assert.ok(glassLayer.length > 0, 'the glass layer must exist');
  assert.doesNotMatch(glassLayer, /(?:^|[\s;{])color:\s*var\(--el-iri\)/m);
  assert.doesNotMatch(glassLayer, /(?:^|[\s;{])color:\s*linear-gradient/m);
});

test('state is never conveyed by colour alone in the new controls', () => {
  // The equalizer carries a text label alongside its bars.
  assert.match(glass, /label\?: string/);
  assert.match(glass, /aria-hidden/);
  // The segmented control exposes selection to assistive tech.
  assert.match(glass, /role="tablist"/);
  assert.match(glass, /aria-selected=\{selected\}/);
  // The model cards are radios with an explicit checked state.
  assert.match(playground, /role="radio"/);
  assert.match(playground, /aria-checked=\{selected\}/);
  // The scrubber is a slider with a numeric value and a spoken equivalent.
  assert.match(playground, /role="slider"/);
  assert.match(playground, /aria-valuenow=\{playedRatio\}/);
  assert.match(playground, /aria-valuetext=/);
  // The transport button names its state both ways.
  assert.match(playground, /aria-pressed=\{playing\}/);
});

// -----------------------------------------------------------------------------
// 2. Reduced motion
// -----------------------------------------------------------------------------

test('every new animation has a reduced-motion fallback', () => {
  const block = css.slice(css.indexOf('ELEVENLABS GLASS LAYER'));
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  for (const selector of ['.el-shimmer::after', '.el-eq > span', '.el-scrub-bar', '.el-play', '.el-nav-link']) {
    assert.ok(block.includes(selector), `${selector} must be stilled under reduced motion`);
  }
  // The shimmer must actually stop, not merely slow down.
  assert.match(block, /\.el-shimmer::after \{ animation: none !important/);
});

test('motion is gated on the hook rather than assumed available', () => {
  // Every animated component asks framer-motion for the preference.
  assert.match(glass, /useReducedMotion/);
  assert.match(playground, /useReducedMotion/);
  assert.match(shell, /useReducedMotion/);
  // And passes a zero-duration transition when motion is reduced.
  assert.match(playground, /reduceMotion \? \{ duration: 0 \}/);
  assert.match(shell, /reduceMotion \? \{ duration: 0 \}/);
});

// -----------------------------------------------------------------------------
// 3. Playground audio state machine
// -----------------------------------------------------------------------------

test('the playground is explicitly labelled as a simulation, not audio', () => {
  // There are no audio assets in the repo, so the UI must not imply playback.
  assert.match(playground, /Simuleret forhåndsvisning/);
  assert.match(playground, /Simulated preview/);
  assert.match(playground, /en simulation uden lyd/);
  assert.match(playground, /simulation with no audio/);
  // And it must not pretend to own an <audio> element or AudioContext.
  assert.doesNotMatch(playground, /new Audio\(|AudioContext|<audio/);
});

test('the transport has a complete, keyboard-operable state machine', () => {
  // Play/pause/mute/restart states exist as real state.
  assert.match(playground, /const \[playing, setPlaying\]/);
  assert.match(playground, /const \[progress, setProgress\]/);
  assert.match(playground, /const \[scrubbing, setScrubbing\]/);
  // Seeking is clamped to [0, 1] so a drag past the edge cannot overflow.
  assert.match(playground, /Math\.max\(0, Math\.min\(1, ratio\)\)/);
  // Keyboard support covers arrows, Home/End and Space/Enter.
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', "' '", 'Enter']) {
    assert.ok(playground.includes(key), `the scrubber must handle ${key}`);
  }
  // Reaching the end stops playback rather than looping silently.
  assert.match(playground, /progressRef\.current >= 1\) \{\s*setPlaying\(false\)/);
});

test('the playground owns exactly one RAF chain and cancels it on unmount', () => {
  const rafCalls = playground.match(/requestAnimationFrame/g) ?? [];
  const cancels = playground.match(/cancelAnimationFrame/g) ?? [];
  // Two scheduling sites (start + step) and at least one cancel.
  assert.equal(rafCalls.length, 2, `expected 2 requestAnimationFrame sites, got ${rafCalls.length}`);
  assert.ok(cancels.length >= 1, 'the RAF chain must be cancellable');
  // The effect that starts it returns the stop() cleanup.
  assert.match(playground, /frameRef\.current = requestAnimationFrame\(step\);\s*return stop;/);
  // And there is an unconditional unmount cleanup.
  assert.match(playground, /useEffect\(\(\) => stop, \[stop\]\)/);
});

test('bar heights are a pure function of progress, not per-frame state', () => {
  // 56 bars re-rendering at 60fps would be a jank machine; the shape is derived.
  assert.match(playground, /function barHeight\(index: number, count: number, progress: number\): number/);
  assert.match(playground, /Math\.exp\(-/);
  // The clock advances in state at a bounded rate, driven by elapsed deltas.
  assert.match(playground, /const delta = timestamp - previous/);
});

test('editing the text invalidates a finished pass', () => {
  // A stale progress bar over new text would misrepresent what is previewed.
  assert.match(playground, /onChange=\{\(event\) => \{\s*setText\(event\.target\.value\);[\s\S]{0,120}?restart\(\);/);
});

// -----------------------------------------------------------------------------
// 4. Showcase structure and hook preservation
// -----------------------------------------------------------------------------

test('the showcase renders the playground and keeps the live console intact', () => {
  assert.match(showcase, /<VoicePlayground/);
  // The voice state machine is untouched by the redesign.
  for (const fn of [
    'sendMessage', 'startConversation', 'endConversation',
    'toggleMute', 'submitLead', 'switchLanguage', 'saveCall', 'trackEvent',
  ]) {
    assert.ok(showcase.includes(`const ${fn}`), `${fn} must survive the rewrite`);
  }
  // Streaming and speech hooks still wired.
  assert.match(showcase, /useBrowserVoice\(/);
  assert.match(showcase, /streamReceptionistChat\(/);
  assert.match(showcase, /audioStream=\{voice\.micStream\}/);
  // Barge-in and latency telemetry preserved.
  assert.match(showcase, /<BargeInPill \/>/);
  assert.match(showcase, /<LatencyPill latencyMs=\{latencyMs\}/);
});

test('the public prop contract is unchanged', () => {
  for (const prop of [
    'slug: string', 'workspaceSlug: string', 'workspaceName: string', 'agentName: string',
    'greetingDa: string', 'greetingEn: string', 'initialLanguage: Language',
    'allowDanish: boolean', 'allowEnglish: boolean', 'openState: OpenState',
    'escalationPhone: string', 'knowledgeCount: number',
  ]) {
    assert.ok(showcase.includes(prop), `ShowcaseExperienceProps must still declare ${prop}`);
  }
});

test('the playground presets quote the agent’s real greeting', () => {
  // The preview must never show a line the agent would not actually say.
  assert.match(showcase, /const playgroundPresets = language === "da"/);
  assert.match(showcase, /greetingDa,/);
  assert.match(showcase, /greetingEn,/);
});

// -----------------------------------------------------------------------------
// 5. Shell
// -----------------------------------------------------------------------------

test('the shell is frosted, floating and still fully accessible', () => {
  assert.match(shell, /el-header/);
  assert.match(shell, /el-shimmer/);
  assert.match(shell, /el-sidebar/);
  // Accessibility affordances survive the redesign.
  assert.match(shell, /className="skip-link"/);
  assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(shell, /useFocusTrap\(drawerRef, open, close\)/);
  assert.match(shell, /role="dialog"/);
  assert.match(shell, /aria-modal="true"/);
  // The backdrop blur is declared with the vendor prefix too.
  assert.match(css, /-webkit-backdrop-filter: blur\(var\(--el-blur\)\)/);
});

test('the nav indicator glides on a spring rather than switching abruptly', () => {
  assert.match(shell, /layoutId=\{`nav-tile-\$\{scope\}`\}/);
  // The spring is the shared preset now, so one curve drives the whole product.
  assert.match(shell, /const NAV_SPRING = SPRING;/);
  // One shared tile per scope, so the desktop and mobile drawers do not fight.
  assert.match(shell, /navigation\(scope\)/);
});

// -----------------------------------------------------------------------------
// 6. Type hygiene
// -----------------------------------------------------------------------------

test('the new surface ships no loose any, casts, or suppressions', () => {
  for (const [name, source] of [
    ['glass.tsx', glass],
    ['VoicePlayground.tsx', playground],
    ['ShowcaseExperience.tsx', showcase],
    ['AppShell.tsx', shell],
  ] as const) {
    assert.doesNotMatch(source, /:\s*any\b/, `${name} must not declare any`);
    assert.doesNotMatch(source, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(source, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(source, /as unknown as/, `${name} must not use double casts`);
  }
});

test('the glass primitives stay in their own client module', () => {
  // primitives.tsx is imported by server components; adding hooks there would
  // turn every one of them into a client boundary.
  assert.match(glass, /^'use client';/);
  const primitives = read('src/components/ui/primitives.tsx');
  assert.doesNotMatch(primitives, /useReducedMotion|useState|useId\(/);
  assert.doesNotMatch(primitives, /^'use client';/m);
});

test('Spring constants match the CSS curve so motion feels consistent', () => {
  // The glass module used to restate the literals, which made it a second
  // source of truth. It now imports the preset and re-exports it, so the curve
  // is declared exactly once in the motion vocabulary.
  const springs = read('src/lib/motion/springs.ts');
  assert.match(
    springs,
    /export const SPRING: SpringPreset = \{ type: 'spring', stiffness: 420, damping: 34, mass: 0\.7 \}/,
  );
  assert.match(glass, /import \{[^}]*\bSPRING\b[^}]*\} from '@\/lib\/motion\/springs'/);
  assert.doesNotMatch(glass, /export const SPRING =/, 'glass.tsx must not redeclare the spring');
  // The stylesheet documents the same spring for CSS-driven transitions.
  assert.match(css, /--el-spring: cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
});
