import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const grid = read('src/components/welcome/BentoGrid.tsx');
const card = read('src/components/welcome/BentoCard.tsx');
const css = read('src/app/globals.css');
const page = read('src/app/welcome/page.tsx');
const springs = read('src/lib/motion/springs.ts');

/** Comments removed, so negative assertions test behaviour rather than prose. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The Piece 2 block only — bounded so Piece 1 assertions stay independent. */
const bentoBlock = css.slice(css.indexOf('Piece 2 — Bento'), css.length);

// -----------------------------------------------------------------------------
// 1. Spotlight cursor glow
// -----------------------------------------------------------------------------

test('the spotlight tracks the pointer without React state', () => {
  const source = code(card);
  // Coordinates go through CSS custom properties on the node itself.
  assert.match(source, /style\.setProperty\('--mx'/);
  assert.match(source, /style\.setProperty\('--my'/);
  assert.match(source, /onPointerMove=\{handlePointerMove\}/);
  // The only state is the lit flag; a per-move useState would re-render per frame.
  // `useState(` with the call parens: the bare identifier also appears in the
  // import list, which is not a call site.
  const stateCalls = source.match(/useState\(/g) ?? [];
  assert.equal(stateCalls.length, 1, 'the pointer must not drive state');
  assert.match(source, /const \[lit, setLit\] = useState\(false\)/);
});

test('the spotlight is pointer-type gated so touch never pins it', () => {
  assert.match(code(card), /event\.pointerType !== 'mouse'/);
  // Two handlers guard it: move and enter.
  const guards = code(card).match(/pointerType !== 'mouse'/g) ?? [];
  assert.equal(guards.length, 2);
});

test('the spotlight layer is decorative and clipped', () => {
  assert.match(card, /className="bento-card__spotlight" aria-hidden="true"/);
  assert.match(bentoBlock, /\.bento-card \{[\s\S]*?overflow: hidden;/);
  assert.match(bentoBlock, /\.bento-card__spotlight \{[\s\S]*?position: absolute;/);
  assert.match(bentoBlock, /\.bento-card__spotlight \{[\s\S]*?pointer-events: none;/);
});

test('the spotlight tone comes from a theme token, not a literal', () => {
  // The brief's rgba(255,255,255,0.12) is the dark value; it lives on a token so
  // the light theme can pick its own weight and the achromatic scan stays clean.
  assert.match(css, /--spotlight: rgba\(255, 255, 255, 0\.12\);/);
  assert.match(css, /--spotlight: rgba\(9, 9, 11, 0\.09\);/);
  assert.match(bentoBlock, /var\(--spotlight\)/);
  assert.doesNotMatch(bentoBlock, /rgba\(\s*255,\s*255,\s*255/);
});

// -----------------------------------------------------------------------------
// 2. Staggered reveal
// -----------------------------------------------------------------------------

test('cards rise 24px with a 60ms stagger', () => {
  const source = code(card);
  assert.match(source, /y: 24/);
  assert.match(source, /opacity: 0/);
  assert.match(source, /index \* staggerFor\(reduceMotion\)\.staggerChildren/);
  assert.match(code(grid), /STAGGER_STEP = 0\.06;/);
});

test('the reveal fires once and collapses under reduced motion', () => {
  const source = code(card);
  assert.match(source, /once: true/);
  assert.match(source, /useReducedMotion/);
  // hidden state is already final when motion is reduced.
  assert.match(source, /initial=\{reduceMotion \? false : \{ opacity: 0, y: 24 \}\}/);
  assert.match(source, /delay: reduceMotion \? 0 :/);
});

test('no card declares a spring curve of its own', () => {
  for (const source of [code(card), code(grid)]) {
    assert.doesNotMatch(source, /stiffness:\s*\d+/);
    assert.doesNotMatch(source, /damping:\s*\d+/);
  }
  assert.match(code(card), /from '@\/lib\/motion\/springs'/);
  assert.match(code(grid), /from '@\/lib\/motion\/springs'/);
  // And the shared preset is still the one the brief names.
  assert.match(springs, /stiffness: 420, damping: 34/);
});

// -----------------------------------------------------------------------------
// 3. The four platform cards
// -----------------------------------------------------------------------------

test('all four platform cards are present with their wells', () => {
  const source = code(grid);
  for (const title of [
    'Autonom AI-reception',
    'Meta & Google Ads',
    'AI SEO / GEO',
    'Universal inbound webhook',
  ]) {
    assert.ok(source.includes(title), `missing card: ${title}`);
  }
  for (const well of ['<ReceptionWell />', '<CampaignWell />', '<CitationWell />', '<PipelineWell />']) {
    assert.ok(source.includes(well), `missing well: ${well}`);
  }
  // Indices drive the stagger, so they must be sequential and complete.
  for (const index of ['index={0}', 'index={1}', 'index={2}', 'index={3}']) {
    assert.ok(source.includes(index), `missing ${index}`);
  }
});

test('the reception well is a CSS keyframe waveform, not a second RAF loop', () => {
  const source = code(grid);
  assert.match(source, /className="bento-wave__bar"/);
  assert.doesNotMatch(source, /requestAnimationFrame/, 'no clock in the bento grid');
  assert.match(bentoBlock, /@keyframes bento-pulse/);
  // Deterministic geometry: server and client render the same bars.
  assert.match(source, /Math\.sin\(index \* 1\.7 \+ 0\.6\)/);
});

test('the citation well is an accessible inline SVG with no colour of its own', () => {
  const source = code(grid);
  assert.match(source, /role="img"/);
  assert.match(source, /aria-label="Citationsgraf/);
  // Presentation attributes would bypass the theme layer.
  const svgPaths = source.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
  assert.ok(svgPaths.length > 0);
  for (const svg of svgPaths) {
    assert.doesNotMatch(svg, /\sfill="#/, 'svg must not hard-code a fill');
    assert.doesNotMatch(svg, /\sstroke="#/, 'svg must not hard-code a stroke');
  }
});

// -----------------------------------------------------------------------------
// 4. Theme and tokens
// -----------------------------------------------------------------------------

test('the bento block uses the tokens the brief names', () => {
  for (const token of [
    'var(--panel)',
    'var(--border-control)',
    'var(--text-primary)',
    'var(--text-secondary)',
    'var(--line)',
    'var(--el-elevated)',
    'var(--el-ink-muted)',
    'var(--r-lg)',
  ]) {
    assert.ok(bentoBlock.includes(token), `the bento block must use ${token}`);
  }
});

test('the bento block declares no hard-coded colour', () => {
  const literals = bentoBlock.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
  assert.deepEqual(literals, [], 'the bento block must be token-only');
});

test('the supplied rgba(255,255,255,0.12) never reaches a component', () => {
  for (const source of [code(grid), code(card)]) {
    assert.doesNotMatch(source, /rgba\(\s*255,\s*255,\s*255/);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{6}/, 'components must not carry hex literals');
  }
});

test('the cards inherit ink that already clears AA', () => {
  // The bento introduces no new ink. It reuses --text-primary and
  // --text-secondary, both of which design-system.test.ts already measures
  // against their elevations; asserting the resolution here keeps the claim
  // local to this surface without re-deriving luminance.
  assert.match(css, /--text-primary: var\(--text\);/);
  assert.match(css, /--text-secondary: #3f3f46;/);
  assert.match(css, /--text-secondary: #a1a1aa;/);
  // A pale secondary on obsidian was the failure mode worth pinning: the dark
  // secondary must not be the light one.
  const darkRoot = css.slice(0, css.indexOf(":root[data-theme='light']"));
  assert.match(darkRoot, /--text-secondary: #a1a1aa;/);
});

// -----------------------------------------------------------------------------
// 5. Motion hygiene and route mounting
// -----------------------------------------------------------------------------

test('the bento animation is disabled under reduced motion', () => {
  assert.match(bentoBlock, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(bentoBlock, /\.bento-wave__bar \{ animation: none; transform: scaleY\(1\); \}/);
  assert.match(bentoBlock, /\.bento-card__spotlight \{ transition: none; \}/);
});

test('the grid mounts directly beneath the hero', () => {
  assert.match(page, /<HeroSection \/>\s*<BentoGrid \/>/);
  assert.match(page, /import \{ BentoGrid \} from '@\/components\/welcome\/BentoGrid';/);
});

test('the bento surface ships no any, casts or suppressions', () => {
  for (const [name, source] of [
    ['BentoGrid.tsx', grid],
    ['BentoCard.tsx', card],
  ] as const) {
    assert.doesNotMatch(source, /:\s*any\b/, `${name} must not declare any`);
    assert.doesNotMatch(source, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(source, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(source, /as unknown as/, `${name} must not use double casts`);
  }
});

test('the card swap on the piece-1 waveform does not collide with the studio one', () => {
  // Piece 1 previously reused `.wave-bar`, which is also used by the agency
  // Waveform.tsx. A global height rule there would have restyled every
  // waveform in the product.
  const studio = read('src/components/audio/Waveform.tsx');
  assert.match(studio, /className=\{\[\s*"wave-bar"/);
  const piece1 = css.slice(css.indexOf('Piece 1 — Welcome'), css.indexOf('Piece 2 — Bento'));
  assert.doesNotMatch(piece1, /\.wave-bar\b/, 'piece 1 must not redefine .wave-bar');
  assert.match(piece1, /\.wf-bar \{/);
});
