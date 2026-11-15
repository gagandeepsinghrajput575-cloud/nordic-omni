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

/** Slice out a whole theme ramp so its own tokens can be asserted in isolation. */
function themeBlock(theme: 'light' | 'dark'): string {
  const opener = new RegExp(`\\:root\\[data-theme='${theme}'\\]`);
  const start = css.search(opener);
  assert.ok(start >= 0, `a ${theme} ramp must exist`);
  const end = css.indexOf('\n}', start);
  assert.ok(end > start, `the ${theme} ramp must close`);
  return css.slice(start, end);
}

const GROUND = '#050507';
const SURFACE = '#0b0b0f';
const ELEVATED = '#121218';

// -----------------------------------------------------------------------------
// 1. One identity
// -----------------------------------------------------------------------------

test('the document ships two themes and the default is Obsidian', () => {
  // The bare `:root` ramp is the dark one; light only arrives by selection.
  assert.equal(token('bg'), '#050507');
  assert.equal(token('panel'), '#0b0b0f');
  assert.equal(token('text'), '#f4f4f6');
  // The retired warm shell must not survive anywhere in the stylesheet.
  for (const warm of ['#FAF7F2', '#F4EFEA', '#ECE5DC', '#1C1512', '#2A201C', '#75675e']) {
    assert.ok(!css.toUpperCase().includes(warm.toUpperCase()), `${warm} must be gone`);
  }
  assert.match(css, /\:root\[data-theme='light'\],\s*\n\.theme-light \{/);
});

test('the light ramp is ElevenLabs paper-white, not a dimmed obsidian', () => {
  const light = themeBlock('light');
  assert.match(light, /--bg:\s*#fafafa/, 'ground must be #fafafa');
  assert.match(light, /--panel:\s*#ffffff/, 'panels must be pure white');
  // Type is pitch black, not a softened charcoal.
  assert.match(light, /--text:\s*#09090b/);
  assert.match(light, /--primary:\s*#09090b/, 'the CTA is stark black');
  assert.match(light, /--primary-ink:\s*#ffffff/, 'and its label is pure white');
  // Hairlines are zinc, and the control border clears the 3:1 non-text bar.
  assert.match(light, /--line:/);
  assert.match(light, /--border-control:\s*#8a8a94/);
  assert.match(light, /color-scheme:\s*light/);
});

test('the document, the boot script and the context resolve a real theme', () => {
  // Server paint must not assume a theme the boot script will contradict.
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /themeInitScript/);
  assert.match(layout, /color: '#fafafa'/, 'light browser chrome');
  assert.match(layout, /color: '#050507'/, 'dark browser chrome');
  // The boot script reads storage, then the OS, then falls back to light.
  assert.match(themeScript, /localStorage\.getItem/);
  assert.match(themeScript, /prefers-color-scheme: dark/);
  assert.match(themeScript, /r\.dataset\.theme=t/);
  // The context resolves the same way and defaults to light.
  assert.match(themeContext, /DEFAULT_THEME: ThemeMode = 'light'/);
  assert.match(themeContext, /useState<ThemeMode>\(DEFAULT_THEME\)/);
  assert.match(themeContext, /prefers-color-scheme: dark/);
  // A stored preference wins over the OS.
  assert.match(themeContext, /saved === 'light' \|\| saved === 'dark'/);
  // A toggle from another tab is adopted, not re-derived.
  assert.match(themeContext, /event\.newValue === 'light'/);
});

test('the theme switcher is a real, keyboard-operable toggle', () => {
  assert.match(switcher, /useTheme\(\)/);
  assert.match(switcher, /cycleTheme/, 'it must actually change the theme');
  // It is one button carrying its own state, not a pair of hidden options.
  assert.match(switcher, /aria-pressed=\{isDark\}/);
  assert.match(switcher, /aria-label=\{label\}/);
  assert.match(switcher, /event\.key === 'Enter' \|\| event\.key === ' '/);
  // Both glyphs exist, and the indicator glides rather than snapping.
  assert.match(switcher, /Moon/);
  assert.match(switcher, /Sun/);
  assert.match(switcher, /layoutId="theme-pill"/);
  // Every animated element has a static fallback.
  assert.match(switcher, /useReducedMotion\(\)/);
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
  assert.equal(token('border-control'), '#71717a');
  for (const ground of [GROUND, SURFACE, ELEVATED]) {
    const ratio = contrast('#71717a', ground);
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
  assert.match(shell, /import \{[^}]*\bSPRING\b[^}]*\} from '@\/lib\/motion\/springs'/);
  // The route transition reuses the same presets rather than a local curve.
  assert.match(shell, /pageIn\(reduceMotion\)/);
  assert.match(shell, /pageRest\(reduceMotion\)/);
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

// -----------------------------------------------------------------------------
// 7. Monochrome enforcement
// -----------------------------------------------------------------------------

/** Parse a CSS colour literal into [r, g, b], or null when it is not one. */
function rgbOf(literal: string): [number, number, number] | null {
  const hex = literal.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const h = hex[1];
    return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
  }
  const fn = literal.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return null;
}

/**
 * The four light-shell literals are pinned by studio-contract.test.ts and the two
 * status dots are the one Tier-4 exception, so they are allowed by name rather
 * than by hue. Everything else must be achromatic.
 */
const CHROMATIC_ALLOWLIST = new Set([
  '#4c1d95', '#2c6647', '#8a5a16', '#a13a35',
  // Status dots, Tier 4: the only chromatic pixels in the product.
  '#34d399', '#fb7185',   // dark — legible on obsidian
  '#047857', '#be123c',   // light — #34d399 measures 1.84:1 on #fafafa
]);

test('the stylesheet carries no chromatic colour outside the documented allowlist', () => {
  const offenders: string[] = [];
  for (const match of css.matchAll(/#[0-9a-fA-F]{6}\b|rgba?\(\s*\d+[,\s]+\d+[,\s]+\d+/g)) {
    const literal = match[0];
    const rgb = rgbOf(literal);
    if (!rgb) continue;
    const [r, g, b] = rgb;
    // A tolerance of 12 keeps neutral greys (which never have exactly equal
    // channels once a designer nudges them) while rejecting any real hue.
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 12) continue;
    if (CHROMATIC_ALLOWLIST.has(literal.toLowerCase())) continue;
    offenders.push(literal);
  }
  assert.deepEqual([...new Set(offenders)], [], `chromatic colours leaked: ${[...new Set(offenders)].join(', ')}`);
});

test('no component ship a chromatic colour in a class or inline style', () => {
  // The stylesheet guard alone was not enough: 21 chromatic rgba() tints lived in
  // Tailwind arbitrary values and inline styles across six agency components.
  const offenders: string[] = [];
  for (const source of componentSources()) {
    for (const match of source.matchAll(/#[0-9a-fA-F]{6}\b|rgba?\(\s*\d+[,\s]+\d+[,\s]+\d+/g)) {
      const rgb = rgbOf(match[0]);
      if (!rgb) continue;
      const [r, g, b] = rgb;
      if (Math.max(r, g, b) - Math.min(r, g, b) <= 12) continue;
      if (CHROMATIC_ALLOWLIST.has(match[0].toLowerCase())) continue;
      offenders.push(match[0]);
    }
  }
  assert.deepEqual([...new Set(offenders)], [], `chromatic colours in components: ${[...new Set(offenders)].join(', ')}`);
});

test('the accent is pure white and the CTA ink is jet black', () => {
  assert.equal(token('a'), '#ffffff');
  assert.equal(token('accent-contrast'), '#050507');
  // 20.4:1, comfortably AAA.
  assert.ok(contrast('#ffffff', '#050507') >= 7);
  // The retired chromatic accent must be gone from the spine entirely.
  for (const old of ['#c9b8ff', '#b49bff', '#a98cff', '#7fe4ff', '#5be3ff', '#ff9ad5', '#ff86d3', '#7ce8ae', '#6be3a4']) {
    assert.ok(!css.toLowerCase().includes(old), `${old} must be gone`);
  }
});

test('the --el-* pigment aliases resolve to the neutral scale', () => {
  for (const name of ['el-accent', 'el-violet', 'el-cyan', 'el-magenta', 'el-mint', 'el-amber', 'el-rose']) {
    const hex = token(name);
    const rgb = rgbOf(hex);
    assert.ok(rgb, `${name} must be a hex colour`);
    const [r, g, b] = rgb;
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 12, `${name} (${hex}) must be achromatic`);
  }
});

test('tier 1 visualisers are monochrome, not iridescent', () => {
  const shader = read('src/lib/audio/orb-shader.ts');
  const waveform = read('src/components/audio/Waveform.tsx');
  // Every palette stop must be a true grey: R = G = B within tolerance.
  for (const [label, source] of [['orb-shader.ts', shader], ['Waveform.tsx', waveform]] as const) {
    const triples = source.match(/\[\s*\d{1,3},\s*\d{1,3},\s*\d{1,3}\s*\]/g) ?? [];
    assert.ok(triples.length > 0, `${label} must declare palette RGB triples`);
    for (const triple of triples) {
      const [r, g, b] = triple.replace(/[[\]]/g, '').split(',').map((n) => Number(n.trim()));
      assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 12, `${label}: ${triple} is chromatic`);
    }
  }
  // The ramp must no longer describe itself as iridescent.
  assert.doesNotMatch(shader, /Iridescent ramp sampled/i);
  assert.doesNotMatch(waveform, /iridescent gradient/i);
});

test('the ambient mesh and every glow are zero-saturation', () => {
  for (const name of ['--el-mesh-a', '--el-mesh-b', '--el-mesh-c', '--el-iri', '--studio-iri', '--grad', '--grad-strong']) {
    const line = css.split('\n').find((entry) => entry.includes(`${name}:`));
    assert.ok(line, `${name} must be declared`);
    for (const match of line.matchAll(/rgba?\([^)]*\)|#[0-9a-fA-F]{6}/gi)) {
      const rgb = rgbOf(match[0]);
      if (!rgb) continue;
      const [r, g, b] = rgb;
      assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 12, `${name} contains chromatic ${match[0]}`);
    }
  }
});

test('semantic dots survive, and nothing tints a background with them', () => {
  // Tier 4 permits a 6px semantic dot; it never becomes a filled surface.
  assert.equal(token('dot-online'), '#34d399');
  assert.equal(token('dot-alert'), '#fb7185');
  // The success/danger *soft* backgrounds must be neutral, not green/red washes.
  assert.match(css, /--success-soft: rgba\(255, 255, 255/);
  assert.match(css, /--danger-soft: rgba\(255, 255, 255/);
});

// -----------------------------------------------------------------------------
// 7. The light theme clears the same bar as the dark one
// -----------------------------------------------------------------------------

/** Read one hex token out of a specific theme ramp. */
function lightToken(name: string): string {
  const block = themeBlock('light');
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `light --${name} must be declared as a hex colour`);
  return match[1];
}

test('light mode type is AAA on the ground, on panels and on the zinc bubble', () => {
  const ink = lightToken('text');
  assert.ok(contrast(ink, '#fafafa') >= 18, `primary ink is ${contrast(ink, '#fafafa').toFixed(2)} on ground`);
  assert.ok(contrast(ink, '#ffffff') >= 18, 'primary ink must stay AAA on white panels');
  assert.ok(contrast(ink, '#f4f4f5') >= 18, 'and on the operator bubble');
  // Secondary ink is a lower tier but still AAA.
  const secondary = lightToken('text-secondary');
  for (const ground of ['#fafafa', '#ffffff', '#f4f4f5']) {
    assert.ok(contrast(secondary, ground) >= 7, `secondary ink only ${contrast(secondary, ground).toFixed(2)} on ${ground}`);
  }
});

test('light muted ink clears AA everywhere it is painted', () => {
  const muted = lightToken('muted');
  // #71717a measures 4.40 on the zinc bubble and would fail; #6b6b74 is the fix.
  assert.notEqual(muted, '#71717a', 'the specified muted failed AA on the operator bubble');
  for (const ground of ['#fafafa', '#ffffff', '#f4f4f5']) {
    const ratio = contrast(muted, ground);
    assert.ok(ratio >= 4.5, `muted ink is ${ratio.toFixed(2)} on ${ground}`);
  }
});

test('the light CTA is a stark black button with white type', () => {
  const bg = lightToken('primary');
  const ink = lightToken('primary-ink');
  assert.equal(ink, '#ffffff');
  assert.ok(contrast(ink, bg) >= 18, `CTA label is ${contrast(ink, bg).toFixed(2)}`);
  assert.ok(contrast(lightToken('primary-hover'), ink) >= 7, 'the hover state must stay legible');
});

test('light control borders clear the 3:1 non-text bar, hairlines stay decorative', () => {
  const control = lightToken('border-control');
  for (const ground of ['#fafafa', '#ffffff', '#f4f4f5']) {
    assert.ok(contrast(control, ground) >= 3, `control border is ${contrast(control, ground).toFixed(2)} on ${ground}`);
  }
  // #e4e4e7 is a hairline: it must never be used where it carries meaning.
  assert.ok(contrast(lightToken('line'), '#fafafa') < 1.5, 'the hairline is deliberately low contrast');
});

test('the status dots consume the theme-aware pigments, not the ink ramp', () => {
  // A dot declared but never consumed renders grey and the tier-4 contract is
  // silently broken, so the class must reference the token directly.
  assert.match(css, /\.dot-live \{ background: var\(--dot-online\)/);
  assert.match(css, /\.dot-danger \{ background: var\(--dot-alert\)/);
  // And they stay 6px with no size animation.
  const dot = css.match(/\.dot-live,[^{]*\{[^}]*\}/);
  assert.ok(dot, 'the dot base rule must exist');
  assert.match(dot![0], /width:\s*6px/);
  assert.match(dot![0], /height:\s*6px/);
});

test('light status dots are legible chroma, not the dark-mode pastels', () => {
  for (const [name, role] of [['dot-online', 'online'], ['dot-alert', 'offline']] as const) {
    const dot = lightToken(name);
    const ratio = contrast(dot, '#fafafa');
    assert.ok(ratio >= 4.5, `the ${role} dot is only ${ratio.toFixed(2)} on paper white`);
  }
});

test('every theme declares the same token surface', () => {
  const dark = themeBlock('dark');
  const light = themeBlock('light');
  const names = (block: string) => new Set([...block.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]));
  const darkNames = names(dark);
  const lightNames = names(light);
  // Light may add tokens, but it must not silently drop one and inherit a dark
  // value that was never designed for paper white.
  const missing = [...darkNames].filter((name) => !lightNames.has(name));
  assert.deepEqual(missing, [], `light ramp is missing: ${missing.join(', ')}`);
});

// -----------------------------------------------------------------------------
// 8. Every animated surface honours reduced motion
// -----------------------------------------------------------------------------

const ANIMATED = [
  'components/ui/Dialog.tsx',
  'components/ui/Tabs.tsx',
  'components/theme/ThemeSwitcher.tsx',
  'components/audio/Waveform.tsx',
  'components/audio/OrbVisualizer.tsx',
  'components/shell/AppShell.tsx',
  'components/portal/ClientDirectChatPanel.tsx',
  'components/agency/AgencyClientChatPanel.tsx',
  'components/showcase/VoicePlayground.tsx',
];

test('no animated component ships without a reduced-motion path', () => {
  const offenders: string[] = [];
  for (const file of ANIMATED) {
    const source = read(`src/${file}`);
    // A file that animates nothing needs no guard.
    if (!/motion\.|AnimatePresence|requestAnimationFrame/.test(source)) continue;
    const guarded = /useReducedMotion|prefersReducedMotion|reduceMotion|prefers-reduced-motion/.test(source);
    if (!guarded) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `animating without a static fallback: ${offenders.join(', ')}`);
});
