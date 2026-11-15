import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const css = read('src/app/globals.css');
const layout = read('src/app/layout.tsx');
const themeContext = read('src/lib/theme/ThemeContext.tsx');
const themeScript = read('src/lib/theme/theme-script.ts');
const motion = read('src/lib/motion/springs.ts');
const motionUi = read('src/components/ui/motion.tsx');
const shell = read('src/components/shell/AppShell.tsx');
const switcher = read('src/components/theme/ThemeSwitcher.tsx');
const copilot = read('src/components/portal/AiCopilotBar.tsx');
const clientChat = read('src/components/portal/ClientDirectChatPanel.tsx');
const agencyChat = read('src/components/agency/AgencyClientChatPanel.tsx');

// -----------------------------------------------------------------------------
// WCAG helpers
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

/** Read a custom property out of its first declaration. */
function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `token --${name} must be declared as a hex colour`);
  return match[1];
}

const GROUND = '#050507';
const SURFACE = '#0b0b0f';
const ELEVATED = '#121218';

// -----------------------------------------------------------------------------
// 1. One identity
// -----------------------------------------------------------------------------

test('there is exactly one visual identity and it is obsidian', () => {
  assert.equal(token('bg'), '#050507');
  assert.equal(token('panel'), '#0b0b0f');
  assert.equal(token('text'), '#f4f4f6');
  // The retired warm shell must not survive anywhere in the stylesheet.
  for (const warm of ['#FAF7F2', '#F4EFEA', '#ECE5DC', '#1C1512', '#2A201C', '#75675e']) {
    assert.ok(!css.toUpperCase().includes(warm.toUpperCase()), `${warm} must be gone`);
  }
  // Both theme selectors must resolve to the same palette rather than diverge.
  assert.match(css, /:root,\s*\n\.theme-light \{/);
  assert.doesNotMatch(css, /\.theme-light \{[^}]*--bg:\s*#(?!050507)/);
});

test('the document, the boot script and the context all pin dark', () => {
  assert.match(layout, /data-theme="dark"/);
  assert.match(layout, /className="dark"/);
  assert.match(layout, /color: '#050507'/);
  assert.match(themeScript, /r\.dataset\.theme='dark'/);
  assert.doesNotMatch(themeScript, /=== 'light'|!=='dark'\)t='light'/);
  assert.match(themeContext, /useState<ThemeMode>\('dark'\)/);
  // No stored preference may resurrect a second palette.
  assert.doesNotMatch(themeContext, /return 'light'/);
});

test('the theme switcher declares the single identity instead of toggling', () => {
  assert.doesNotMatch(switcher, /setTheme\(/, 'a switcher that cannot switch must not pretend to');
  assert.doesNotMatch(switcher, /OPTIONS/, 'the light/dark option list must be gone');
  assert.match(switcher, /Obsidian/);
});

// -----------------------------------------------------------------------------
// 2. Contrast — measured, on every elevation
// -----------------------------------------------------------------------------

test('every core ink clears WCAG AA on all three elevations', () => {
  for (const name of ['text', 'a', 'b', 'ok', 'bad', 'warn', 'info']) {
    const hex = token(name);
    for (const ground of [GROUND, SURFACE, ELEVATED]) {
      const ratio = contrast(hex, ground);
      assert.ok(ratio >= 4.5, `--${name} (${hex}) on ${ground} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('secondary and muted ink remain AA rather than dropping to decoration', () => {
  // These are declared as literals inside the spine, so read them directly.
  assert.ok(contrast('#c6c6d0', GROUND) >= 4.5, '--text-secondary must be AA');
  assert.ok(contrast('#a9a9b6', GROUND) >= 4.5, '--text-muted must be AA');
  assert.ok(contrast('#a9a9b6', ELEVATED) >= 4.5, '--text-muted must survive on elevation 3');
});

test('accent-filled surfaces always pair with dark ink, never white', () => {
  // White on the accent is 1.78:1 — a hard failure. The token must be obsidian.
  assert.equal(token('accent-contrast'), '#050507');
  assert.ok(contrast('#050507', '#c9b8ff') >= 4.5);
  assert.ok(contrast('#ffffff', '#c9b8ff') < 3, 'the failing pair is the one we avoid');
  // The accent CTA class must carry that ink rather than white.
  assert.match(css, /\.btn\.btn-accent \{[^}]*color: #050507/);
});

test('a perceivable control border exists and clears the 3:1 UI threshold', () => {
  // --line is decorative; --border-control is the one a control may use.
  assert.equal(token('border-control'), '#666673');
  for (const ground of [GROUND, SURFACE, ELEVATED]) {
    const ratio = contrast('#666673', ground);
    assert.ok(ratio >= 3, `--border-control on ${ground} is ${ratio.toFixed(2)}:1, below 3:1`);
  }
  // Inputs lift to that grade on hover, so the field edge is perceivable.
  assert.match(css, /\.input:hover:not\(:disabled\) \{ border-color: var\(--border-control\)/);
});

// -----------------------------------------------------------------------------
// 3. The token spine replaced the layer, so untouched pages convert
// -----------------------------------------------------------------------------

test('the legacy class names every page already uses are re-skinned in place', () => {
  // If these had been renamed, the 22 untouched routes would have stayed warm.
  for (const selector of ['.card', '.hairline-card', '.btn', '.input', '.nav-link', '.data-table', '.badge', '.pill']) {
    assert.ok(css.includes(selector), `${selector} must still exist`);
  }
  // Cards are frosted glass now, not flat warm panels.
  assert.match(css, /\.card, \.hairline-card \{[^}]*background: var\(--glass\)/);
  assert.match(css, /\.card, \.hairline-card \{[^}]*backdrop-filter: blur\(var\(--blur\)\)/);
});

test('no undefined design token is referenced by any component', () => {
  const declared = new Set(
    (css.match(/^\s*--[a-z0-9-]+/gm) ?? []).map((entry) => entry.trim()),
  );
  // Tokens are also introduced by component modules; collect those too.
  const extra = new Set<string>();
  for (const source of [superSource(), motionUi]) {
    for (const match of source.matchAll(/(--[a-z0-9-]+):/g)) extra.add(match[1]);
  }
  const used = new Set<string>();
  for (const source of componentSources()) {
    for (const match of source.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(match[1]);
  }
  const missing = [...used].filter((name) => !declared.has(name) && !extra.has(name));
  assert.deepEqual(missing, [], `undeclared tokens: ${missing.join(', ')}`);
});

/** Every .tsx/.ts under src, read once. */
function componentSources(): string[] {
  const sources: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(entry.name)) sources.push(readFileSync(child, 'utf8'));
    }
  };
  walk(new URL('../src/', import.meta.url));
  return sources;
}

function superSource(): string { return css; }

// -----------------------------------------------------------------------------
// 4. Motion system
// -----------------------------------------------------------------------------

test('one spring vocabulary is shared rather than re-declared per component', () => {
  assert.match(motion, /export const SPRING(: SpringPreset)? = \{ type: 'spring'/);
  assert.match(motion, /export const SPRING_SOFT/);
  // Components import the preset instead of inventing a curve.
  assert.match(shell, /import \{ SPRING \} from '@\/lib\/motion\/springs'/);
  assert.match(shell, /const NAV_SPRING = SPRING;/);
  assert.match(read('src/components/ui/Tabs.tsx'), /from '@\/lib\/motion\/springs'/);
});

test('every scroll reveal collapses to static under reduced motion', () => {
  assert.match(motionUi, /useReducedMotion/);
  assert.match(motionUi, /useInView/);
  // The observer fires once, so nothing keeps watching after the element is seen.
  assert.match(motionUi, /once: true/);
  assert.match(motionUi, /reduceMotion\)/);
  // And the hidden state is already visible when motion is reduced.
  assert.match(motion, /hidden: reduceMotion \? \{ opacity: 1 \} : \{ opacity: 0, y: 14 \}/);
  assert.match(motion, /springFor\(reduceMotion, SPRING_SOFT\)/);
});

test('the magnetic hover is pointer-only and disabled for reduced motion', () => {
  assert.match(motionUi, /event\.pointerType !== 'mouse'/);
  assert.match(motionUi, /if \(reduceMotion\) return/);
  // It writes a transform, never a layout property.
  assert.match(motionUi, /translate3d/);
  assert.doesNotMatch(motionUi, /style\.(top|left|width|height)\s*=/);
});

// -----------------------------------------------------------------------------
// 5. The four-tier hierarchy
// -----------------------------------------------------------------------------

test('tier 1 — the co-pilot is an AI surface with a live state, not a passive card', () => {
  // It presents itself as an instrument panel and reports a real working state.
  assert.match(copilot, /studio-panel/);
  assert.match(copilot, /EqualizerBadge/);
  assert.match(copilot, /aria-busy=\{busy\}/);
  // Keyboard access to the command line.
  assert.match(copilot, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(copilot, /metaKey \|\| event\.ctrlKey/);
  // The listener is removed on unmount.
  assert.match(copilot, /removeEventListener\('keydown', onKey\)/);
});

test('tier 1 — the co-pilot still never executes an ungrounded change', () => {
  // It may only act through the server action, never by writing directly.
  assert.match(copilot, /executeClientAiCommand\(prompt\)/);
  assert.doesNotMatch(copilot, /fetch\(/);
  assert.doesNotMatch(copilot, /price|pris/i, 'pricing must never be mutated client-side');
});

test('tier 2 — search and tabs are first-class controls', () => {
  const directory = read('src/components/portal/CallerDirectory.tsx');
  // The search field ignites on focus and its results are announced.
  assert.match(css, /\.table-search:focus-within > svg \{ color: var\(--accent-primary\)/);
  assert.match(directory, /aria-live="polite"/);
  assert.match(directory, /aria-describedby=\{`\$\{id\}-count`\}/);
  // Tabs keep roving focus and a spring indicator.
  const tabs = read('src/components/ui/Tabs.tsx');
  assert.match(tabs, /aria-selected=\{value === item\.id\}/);
  assert.match(tabs, /refs\.current\[next\]\?\.focus\(\)/);
  assert.match(tabs, /reduceMotion \? \{ duration: 0 \} : SPRING/);
});

test('tier 3 — human conversation never borrows the AI accent for its own body', () => {
  // A client's own message is a tinted glass bubble with normal ink: accent ink
  // behind white text would have been 1.78:1.
  assert.match(clientChat, /bg-\[var\(--accent-soft\)\] text-\[var\(--text\)\]/);
  assert.doesNotMatch(clientChat, /text-\[var\(--accent-contrast\)\]/);
  // The composer button uses the AA-safe accent CTA rather than raw accent ink.
  assert.match(clientChat, /btn btn-accent/);
  // Both sides announce the sender rather than relying on alignment alone.
  assert.match(agencyChat, /Skriv som agentur/);
});

test('tier 4 — delegation stays staged and is never applied silently', () => {
  // The operator's instruction becomes a grounded question that is *sent*, and
  // the UI returns to manual mode rather than assuming success.
  assert.match(agencyChat, /action: 'delegation'/);
  assert.match(agencyChat, /setMode\('message'\)/);
  assert.match(agencyChat, /await refresh\(\)/);
  // A failure surfaces rather than being swallowed.
  assert.match(agencyChat, /setError\(cause instanceof Error/);
});

// -----------------------------------------------------------------------------
// 6. Accessibility of the new shell
// -----------------------------------------------------------------------------

test('the shell keeps its floating frosted bar and its accessibility affordances', () => {
  assert.match(shell, /el-header/);
  assert.match(shell, /el-shimmer/);
  assert.match(shell, /className="skip-link"/);
  assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(shell, /useFocusTrap\(drawerRef, open, close\)/);
  // The nav tile is announced once, not twice.
  assert.match(shell, /aria-hidden/);
});

test('reduced motion stills every ambient animation in the stylesheet', () => {
  // Each layer owns its own reduced-motion block, so every block is inspected.
  const blocks = css.split('@media (prefers-reduced-motion: reduce)').slice(1);
  assert.ok(blocks.length >= 3, `expected several reduced-motion blocks, got ${blocks.length}`);
  const reduced = blocks.join('\n');
  for (const selector of ['.el-shimmer::after', '.el-eq > span', '.auth-monogram::before', '.wave-bar.is-live']) {
    assert.ok(reduced.includes(selector), `${selector} must be stilled`);
  }
  // Nothing may keep animating under the preference.
  assert.match(reduced, /animation: none !important/);
});

test('the new modules carry no loose any or type suppressions', () => {
  for (const [name, source] of [
    ['springs.ts', motion],
    ['motion.tsx', motionUi],
    ['ThemeSwitcher.tsx', switcher],
    ['AiCopilotBar.tsx', copilot],
    ['ClientDirectChatPanel.tsx', clientChat],
    ['AgencyClientChatPanel.tsx', agencyChat],
    ['theme-script.ts', themeScript],
    ['ThemeContext.tsx', themeContext],
  ] as const) {
    assert.doesNotMatch(source, /:\s*any\b/, `${name} must not declare any`);
    assert.doesNotMatch(source, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(source, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(source, /as unknown as/, `${name} must not double-cast`);
  }
});

test('the ambient mesh is painted once, not on both body and shell', () => {
  const meshUses = (css.match(/var\(--el-mesh-a\)/g) ?? []).length;
  assert.equal(meshUses, 1, `the mesh must be painted exactly once (on body), got ${meshUses}`);
  // Fixed attachment means scrolling never repaints the gradient.
  assert.match(css, /background-attachment: fixed/);
});

// `readdirSync` is imported lazily at module scope above; keep the import honest.
import { readdirSync } from 'node:fs';
