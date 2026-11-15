import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ASSURANCES,
  BORDER_REVEAL_PX,
  FOOTER_COLUMNS,
  NAV_LINKS,
} from '../src/components/welcome/welcome-content';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const nav = read('src/components/welcome/WelcomeNavigation.tsx');
const sec = read('src/components/welcome/EnterpriseSecuritySection.tsx');
const foot = read('src/components/welcome/WelcomeFooter.tsx');
const css = read('src/app/globals.css');
const page = read('src/app/welcome/page.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const block = css.slice(css.indexOf('Pieces 5 & 6 — Sticky nav'), css.length);

// -----------------------------------------------------------------------------
// 1. Sticky navigation
// -----------------------------------------------------------------------------

test('the nav is fixed, frosted, and uses the blur token', () => {
  assert.match(block, /\.wnav \{[\s\S]*?position: fixed;/);
  assert.match(block, /\.wnav \{[\s\S]*?background: var\(--glass\);/);
  assert.match(block, /\.wnav \{[\s\S]*?backdrop-filter: blur\(var\(--blur\)\);/);
  assert.match(css, /--blur: 20px;/);
});

test('the border reveals past 20px without ever shifting layout', () => {
  assert.equal(BORDER_REVEAL_PX, 20);
  assert.match(code(nav), /window\.scrollY > BORDER_REVEAL_PX/);
  // The edge is its own always-present 1px layer, so revealing it only
  // animates opacity - toggling a real border would reflow the fixed header.
  assert.match(block, /\.wnav__edge \{[\s\S]*?height: 1px;/);
  assert.match(code(nav), /animate=\{\{ opacity: scrolled \? 1 : 0 \}\}/);
  assert.doesNotMatch(block, /\.wnav\[data-scrolled/);
});

test('the reveal rides the shared spring and respects reduced motion', () => {
  assert.match(code(nav), /springFor\(reduceMotion, SPRING\)/);
  assert.match(code(nav), /useReducedMotion/);
  assert.doesNotMatch(code(nav), /stiffness:\s*\d+/);
});

test('the scroll listener is passive, idempotent and cleaned up', () => {
  const source = code(nav);
  assert.match(source, /addEventListener\('scroll', onScroll, \{ passive: true \}\)/);
  assert.match(source, /removeEventListener\('scroll', onScroll\)/);
  // Guarded setter: no re-render once the boolean has settled.
  assert.match(source, /setScrolled\(\(current\) => \(current === next \? current : next\)\)/);
});

test('the nav links to the three entry points the brief names', () => {
  const hrefs = NAV_LINKS.map((link) => link.href);
  const all = hrefs.join(' ') + ' ' + code(nav);
  for (const target of ['/login', '/portal', '/agency']) {
    assert.ok(all.includes(target), `the nav must link to ${target}`);
  }
});

test('the shell reserves the fixed nav height', () => {
  assert.match(block, /:root \{ --wnav-h: 64px; \}/);
  assert.match(block, /\.welcome-shell \{ padding-top: var\(--wnav-h\); \}/);
});

// -----------------------------------------------------------------------------
// 2. Enterprise assurance grid
// -----------------------------------------------------------------------------

test('the four assurance cards exist, with text badges', () => {
  const ids = ASSURANCES.map((card) => card.id);
  assert.deepEqual(ids, ['soc2', 'gdpr', 'uptime', 'vault']);
  assert.equal(ASSURANCES.length, 4);
  for (const card of ASSURANCES) {
    assert.ok(card.badge.length > 0, `${card.id} needs a badge label`);
    assert.ok(card.title.length > 0);
    assert.ok(card.body.length > 0);
  }
  // Copenhagen / EU is stated in text, not implied by an icon.
  assert.ok(ASSURANCES[1].body.includes('København'));
});

test('cards are glass with a hairline border and a hover lift', () => {
  assert.match(block, /\.wsec-card \{[\s\S]*?border: 1px solid var\(--border-control\);/);
  assert.match(block, /\.wsec-card \{[\s\S]*?background: var\(--glass\);/);
  assert.match(block, /\.wsec-card:hover \{ transform: translateY\(-2px\); \}/);
});

test('the badge dot is decorative and the label carries the meaning', () => {
  // The dot is aria-hidden; the badge text is inside the same span.
  assert.match(code(sec), /<span className="wsec-badge__dot" aria-hidden="true" \/>/);
  assert.match(code(sec), /\{card\.badge\}/);
  assert.match(block, /\.wsec-badge__dot \{[\s\S]*?background: var\(--dot-online\);/);
});

test('the grid collapses from four columns to two to one', () => {
  assert.match(block, /@media \(min-width: 640px\) \{\s*\.wsec-grid \{ grid-template-columns: repeat\(2/);
  assert.match(block, /@media \(min-width: 1040px\) \{\s*\.wsec-grid \{ grid-template-columns: repeat\(4/);
});

// -----------------------------------------------------------------------------
// 3. Conversion footer
// -----------------------------------------------------------------------------

test('the CTA uses the existing gradient token, not a new literal', () => {
  // The brief's linear-gradient(180deg, #ffffff, #e8e8ee) is already exactly
  // what --primary-bg resolves to in dark mode.
  assert.match(block, /\.wfoot__cta-primary \{[\s\S]*?background: var\(--primary-bg\);/);
  assert.match(css, /--primary-bg: linear-gradient\(180deg, #ffffff, #e8e8ee\);/);
  // ...and #09090b in light.
  assert.match(css, /--primary-bg: #09090b;/);
  // No new gradient literal was introduced for it.
  assert.doesNotMatch(block, /linear-gradient\(180deg, #ffffff, #e8e8ee\)/);
});

test('the footer has four columns, all with real links', () => {
  assert.equal(FOOTER_COLUMNS.length, 4);
  for (const column of FOOTER_COLUMNS) {
    assert.ok(column.links.length >= 3, `${column.title} needs at least three links`);
    for (const link of column.links) {
      assert.ok(link.href.startsWith('/'), `${link.label} must be an internal path`);
      assert.ok(link.label.length > 0);
    }
  }
});

test('the status indicator pairs its dot with text', () => {
  assert.match(code(foot), /<span className="wfoot__status-dot" aria-hidden="true" \/>/);
  assert.match(code(foot), /<span>Operationel<\/span>/);
  assert.match(block, /\.wfoot__status-dot \{[\s\S]*?background: var\(--dot-online\);/);
});

test('the copyright year is injected rather than read from the clock', () => {
  // A `new Date()` in a static route would make the render non-deterministic.
  assert.match(code(foot), /year = 2026/);
  assert.doesNotMatch(code(foot), /new Date\(/);
  assert.match(code(foot), /© \{year\} Nordic Omni ApS/);
});

// -----------------------------------------------------------------------------
// 4. Theme invariants
// -----------------------------------------------------------------------------

test('the new block introduces no colour literal and no synthetic purple', () => {
  // CSS comments are stripped first: two of them deliberately name the literal
  // values to record why the token replaces them.
  const declarations = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = declarations.match(/#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g) ?? [];
  assert.deepEqual(literals, [], `literal colour in the block: ${literals.join(', ')}`);
  assert.doesNotMatch(block, /purple|violet|indigo|magenta/i);

  for (const [name, source] of [
    ['WelcomeNavigation.tsx', nav],
    ['EnterpriseSecuritySection.tsx', sec],
    ['WelcomeFooter.tsx', foot],
  ] as const) {
    // Comments are stripped: the nav's doc comment names `#09090b` to record
    // that the token already resolves to it.
    const body = code(source);
    assert.doesNotMatch(body, /#[0-9a-fA-F]{6}\b/, `${name} must carry no hex literal`);
    assert.doesNotMatch(body, /purple|violet|indigo/i, `${name} must not name a hue`);
  }
});

test('the brief-named tokens are all in use', () => {
  for (const token of ['--border-control', '--panel', '--text-primary', '--text-secondary', '--dot-online']) {
    assert.ok(block.includes(`var(${token}`), `expected ${token}`);
  }
});

test('every animated surface in the final pieces has a reduced-motion path', () => {
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  for (const selector of ['.wnav__cta', '.wsec-card', '.wfoot__cta-primary']) {
    assert.ok(block.includes(selector), `expected ${selector} in the reduced-motion block`);
  }
  assert.match(block, /\.wsec-card:hover,\s*\.wfoot__cta-primary:hover \{ transform: none; \}/);
  // The nav edge is a spring that resolves to a zero duration, not CSS.
  assert.match(code(nav), /springFor\(reduceMotion, SPRING\)/);
});

// -----------------------------------------------------------------------------
// 5. Page assembly
// -----------------------------------------------------------------------------

test('the page assembles all seven sections in order', () => {
  const order = [
    '<WelcomeNavigation />',
    '<HeroSection />',
    '<BentoGrid />',
    '<ConversationalPlatformSection />',
    '<DeveloperSection />',
    '<EnterpriseSecuritySection />',
    '<WelcomeFooter />',
  ];
  let cursor = -1;
  for (const marker of order) {
    const at = page.indexOf(marker);
    assert.ok(at > cursor, `${marker} is missing or out of order`);
    cursor = at;
  }
});

test('the nav renders outside main, so the document has one main landmark', () => {
  const navAt = page.indexOf('<WelcomeNavigation />');
  const mainAt = page.indexOf('<main');
  assert.ok(navAt < mainAt, 'the nav must precede main');
  assert.equal((page.match(/<main/g) ?? []).length, 1, 'exactly one main landmark');
});

test('the shared loading fallback does not add a second main landmark', () => {
  // The root loading.tsx rendered <main> and so does this page, which left
  // every route with two main landmarks. The fallback is a div now.
  const loading = code(read('src/app/loading.tsx'));
  assert.doesNotMatch(loading, /<main/, 'the fallback must not be a main landmark');
  assert.match(loading, /role="status"/);
  // And the welcome page contributes exactly one.
  assert.equal((page.match(/<main/g) ?? []).length, 1);
});

test('the final pieces ship no any, casts or suppressions', () => {
  for (const [name, source] of [
    ['WelcomeNavigation.tsx', nav],
    ['EnterpriseSecuritySection.tsx', sec],
    ['WelcomeFooter.tsx', foot],
  ] as const) {
    assert.doesNotMatch(source, /:\s*any\b/, `${name} must not declare any`);
    assert.doesNotMatch(source, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(source, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(source, /as unknown as/, `${name} must not use double casts`);
  }
});

test('the props contracts are exported', () => {
  const content = read('src/components/welcome/welcome-content.ts');
  assert.match(nav, /export interface WelcomeNavigationProps/);
  assert.match(sec, /export interface EnterpriseSecuritySectionProps/);
  assert.match(foot, /export interface WelcomeFooterProps/);
  // The copy and structure live in the plain module, so the components consume
  // it rather than declaring it, and the test runner can import it directly.
  assert.match(content, /export const NAV_LINKS/);
  assert.match(content, /export const BORDER_REVEAL_PX = 20;/);
  assert.match(content, /export interface AssuranceCard/);
  assert.match(content, /export const ASSURANCES/);
  assert.match(content, /export interface FooterColumn/);
  assert.match(content, /export const FOOTER_COLUMNS/);
  // And the components import from it.
  for (const source of [nav, sec, foot]) {
    assert.match(source, /from '\.\/welcome-content'/);
  }
});
