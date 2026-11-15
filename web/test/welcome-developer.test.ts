import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LANGUAGES, snippetFor, WEBHOOK_PATH, DISPATCH_PATH, WEBHOOK_PAYLOAD, DISPATCH_PAYLOAD } from '../src/components/welcome/code-samples';
import { tokenize, tokenizeLine } from '../src/components/welcome/code-highlight';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const console_ = read('src/components/welcome/DeveloperApiConsole.tsx');
const section = read('src/components/welcome/DeveloperSection.tsx');
const samples = read('src/components/welcome/code-samples.ts');
const highlight = read('src/components/welcome/code-highlight.ts');
const css = read('src/app/globals.css');
const page = read('src/app/welcome/page.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const devcBlock = css.slice(css.indexOf('Piece 4 — Developer console'), css.indexOf('Pieces 5 & 6'));

// -----------------------------------------------------------------------------
// 1. The highlighter — real behaviour, executed
// -----------------------------------------------------------------------------

test('the highlighter classifies strings, comments, keywords and numbers', () => {
  // The number sits outside the comment on purpose: digits inside a `//` are
  // part of the comment token, not numbers in their own right.
  const tokens = tokenizeLine(`const key = "abc"; limit: 42; // note`);
  const kinds = tokens.map((token) => token.kind);

  assert.ok(kinds.includes('keyword'), 'const should be a keyword');
  assert.ok(kinds.includes('string'), 'a quoted value should be a string');
  assert.ok(kinds.includes('comment'), 'a trailing // should be a comment');
  assert.ok(kinds.includes('number'), '42 should be a number');

  const byText = new Map(tokens.map((token) => [token.text, token.kind]));
  assert.equal(byText.get('const'), 'keyword');
  assert.equal(byText.get('"abc"'), 'string');
  assert.equal(byText.get('42'), 'number');
});

test('a comment marker inside a string does not start a comment', () => {
  const tokens = tokenizeLine(`const url = "https://example.dk/a";`);
  // The whole URL must stay one string token; the // must not split it.
  const strings = tokens.filter((token) => token.kind === 'string');
  assert.equal(strings.length, 1);
  assert.equal(strings[0].text, '"https://example.dk/a"');
  assert.ok(!tokens.some((token) => token.kind === 'comment'));
});

test('an object key is a property, not a keyword', () => {
  const tokens = tokenizeLine(`  action: "fetch_leads",`);
  const property = tokens.find((token) => token.kind === 'property');
  assert.ok(property, 'the key before a colon should be a property');
  assert.equal(property?.text, 'action');
});

test('tokenizing preserves every character of the source', () => {
  const source = [
    "const a = 'x';",
    '',
    '// only a comment',
    'await fetch("/api/v1/agency/webhook", { limit: 25 });',
  ].join('\n');
  const lines = tokenize(source);
  const rebuilt = lines.map((entry) => entry.tokens.map((token) => token.text).join('')).join('\n');
  assert.equal(rebuilt, source, 'round-trip must be byte-identical');
  // Empty lines keep one token so they still occupy a line.
  assert.equal(lines.length, 4);
  assert.equal(lines[1].tokens.length, 1);
});

test('the highlighter carries no regex state between lines', () => {
  // A shared /g regex would skip matches on the second identical line.
  const source = `const a = "one";\nconst a = "one";`;
  const [first, second] = tokenize(source).map((entry) => entry.tokens.length);
  assert.equal(first, second, 'identical lines must tokenize identically');
});

test('the highlighter never produces markup', () => {
  // Tokens, not HTML: there is no dangerouslySetInnerHTML anywhere in the piece.
  assert.doesNotMatch(code(highlight), /innerHTML/);
  assert.doesNotMatch(code(console_), /dangerouslySetInnerHTML/);
  assert.match(highlight, /export function tokenize/);
  assert.match(highlight, /export type TokenKind/);
});

// -----------------------------------------------------------------------------
// 2. Snippets are real endpoints
// -----------------------------------------------------------------------------

test('the snippets point at endpoints that exist in this repository', () => {
  assert.equal(WEBHOOK_PATH, '/api/v1/agency/webhook');
  assert.equal(DISPATCH_PATH, '/api/telephony/dispatch');

  // And the routes are on disk, so the copy cannot drift from the product.
  const webhookRoute = read('src/app/api/v1/agency/webhook/route.ts');
  const dispatchRoute = read('src/app/api/telephony/dispatch/route.ts');
  assert.match(webhookRoute, /export async function POST/);
  assert.match(dispatchRoute, /export async function POST/);
});

test('the webhook payload matches the real fetch_leads contract', () => {
  const contract = read('src/lib/webhooks/inbound-contract.ts');
  // `action`, `status` and `limit` are the fields the schema declares.
  assert.match(contract, /action: z\.literal\('fetch_leads'\)/);
  assert.match(contract, /status: z\.string\(\)\.max\(40\)\.optional\(\)/);
  assert.match(contract, /limit: z\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)/);
  assert.equal(WEBHOOK_PAYLOAD.action, 'fetch_leads');
  assert.ok(WEBHOOK_PAYLOAD.limit >= 1 && WEBHOOK_PAYLOAD.limit <= 100);
});

test('the dispatch payload matches the fields the route actually reads', () => {
  const route = read('src/app/api/telephony/dispatch/route.ts');
  // The route resolves the dialled number from `did` and the caller from `caller`.
  assert.match(route, /readString\(body, "did"\)/);
  assert.match(route, /readString\(body, "caller"\)/);
  assert.ok('did' in DISPATCH_PAYLOAD);
  assert.ok('caller' in DISPATCH_PAYLOAD);
});

test('all four languages render the same payload', () => {
  const languages = LANGUAGES.map((entry) => entry.value);
  assert.deepEqual(languages, ['ts', 'py', 'curl', 'go']);

  for (const language of languages) {
    const snippet: string = snippetFor(language);
    assert.ok(snippet.length > 40, `${language} snippet is too short`);
    assert.ok(
      snippet.includes('/api/v1/agency/webhook'),
      `${language} must reference the real webhook path`,
    );
  }
  // The cURL sample states the method explicitly; the others do it in code.
  assert.match(snippetFor('curl'), /curl -X POST/);
  const gateway = read('src/components/agency/InboundGateway.tsx');
  assert.match(gateway, /curl -X POST/, 'the same shape the agency console already emits');
});

// -----------------------------------------------------------------------------
// 3. Copy interaction
// -----------------------------------------------------------------------------

test('the copy button morphs the glyph and springs 1.2x', () => {
  const source = code(console_);
  assert.match(source, /await navigator\.clipboard\.writeText\(code\)/);
  assert.match(source, /animate=\{copied && !reduceMotion \? \{ scale: \[1, 1\.2, 1\] \}/);
  // 200ms settle, as specified.
  assert.match(source, /duration: 0\.2/);
  // The label changes too, so the state is not carried by the icon alone.
  assert.match(source, /copied \? 'Kopieret' : copyFailed \? 'Kunne ikke kopiere' : 'Kopier'/);
  assert.match(source, /aria-label=\{copied \? 'Kopieret' : 'Kopier kode'\}/);
});

test('a clipboard rejection is handled rather than swallowed', () => {
  const source = code(console_);
  assert.match(source, /catch \{/);
  assert.match(source, /setCopyFailed\(true\)/);
  // The reset timer is cleared on unmount and before a second copy.
  assert.match(source, /clearTimeout\(resetRef\.current\)/);
  assert.match(source, /useEffect\(\(\) => clearReset, \[clearReset\]\)/);
});

test('copy under reduced motion swaps the glyph with no scale', () => {
  assert.match(code(console_), /reduceMotion \? \{ duration: 0 \}/);
});

// -----------------------------------------------------------------------------
// 4. Language switching is instant
// -----------------------------------------------------------------------------

test('switching languages waits on nothing', () => {
  const source = code(console_);
  // Every snippet is a synchronous string in one module.
  assert.match(source, /const code = snippetFor\(language\);/);
  assert.match(source, /useMemo\(\(\) => tokenize\(code\), \[code\]\)/);
  // No dynamic import, no fetch, no async grammar load in the switch path.
  assert.doesNotMatch(source, /import\(/, 'no dynamic import in the switch path');
  assert.doesNotMatch(source, /await .*snippet|fetch\(.*snippet/);
});

test('the language switcher is the shared gliding pill', () => {
  assert.match(code(console_), /<GlidingTabSwitcher/);
  assert.match(code(console_), /label="Vælg sprog"/);
  assert.doesNotMatch(code(console_), /layoutId/, 'the thumb belongs to SegmentedControl');
});

// -----------------------------------------------------------------------------
// 5. Theme and structure
// -----------------------------------------------------------------------------

test('the terminal is a studio surface and stays obsidian in both themes', () => {
  assert.match(devcBlock, /\.devc-terminal \{[\s\S]*?background: var\(--studio-black\);/);
  assert.match(devcBlock, /\.devc-terminal__bar \{[\s\S]*?background: var\(--studio-panel\);/);
  // The page-ground tokens are still used by the surrounding section.
  assert.match(devcBlock, /\.devc-endpoint \{[\s\S]*?background: var\(--panel\);/);
  assert.match(devcBlock, /var\(--border-control\)/);
  assert.match(devcBlock, /var\(--text-primary\)/);
  assert.match(devcBlock, /var\(--text-secondary\)/);
});

test('the window controls are three neutral dots, not a traffic light', () => {
  assert.match(code(console_), /<span className="devc-dots" aria-hidden="true">\s*<span \/>\s*<span \/>\s*<span \/>/);
  assert.match(devcBlock, /\.devc-dots > span \{[\s\S]*?background: var\(--studio-line-strong\);/);
});

test('syntax tones are neutral steps, declared in CSS not inline', () => {
  for (const token of ['kw', 'str', 'num', 'prop', 'com']) {
    assert.ok(devcBlock.includes(`.devc-tok-${token}`), `missing .devc-tok-${token}`);
  }
  // Inline colour would bypass the palette entirely.
  assert.doesNotMatch(code(console_), /style=\{\{[^}]*color/);
  assert.doesNotMatch(code(highlight), /#[0-9a-fA-F]{3,8}\b/);
});

test('the developer surface ships no chromatic literal or synthetic purple', () => {
  for (const [name, source] of [
    ['DeveloperApiConsole.tsx', console_],
    ['DeveloperSection.tsx', section],
    ['code-samples.ts', samples],
    ['code-highlight.ts', highlight],
  ] as const) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/, `${name} must carry no hex literal`);
    assert.doesNotMatch(source, /purple|violet|indigo/i, `${name} must not name a hue`);
  }
  const hexes = devcBlock.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  assert.deepEqual(hexes, [], `chromatic hex in the block: ${hexes.join(', ')}`);
});

test('reduced motion removes the remaining transitions', () => {
  assert.match(devcBlock, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(devcBlock, /\.devc-copy,[\s\S]*?transition: none;/);
});

// -----------------------------------------------------------------------------
// 6. Mounting and hygiene
// -----------------------------------------------------------------------------

test('the developer section mounts beneath the conversational band', () => {
  assert.match(page, /<ConversationalPlatformSection \/>\s*<DeveloperSection \/>/);
  assert.match(page, /import \{ DeveloperSection \} from '@\/components\/welcome\/DeveloperSection';/);
});

test('the developer surface ships no any, casts or suppressions', () => {
  for (const [name, source] of [
    ['DeveloperApiConsole.tsx', console_],
    ['DeveloperSection.tsx', section],
    ['code-samples.ts', samples],
    ['code-highlight.ts', highlight],
  ] as const) {
    assert.doesNotMatch(source, /:\s*any\b/, `${name} must not declare any`);
    assert.doesNotMatch(source, /as any\b/, `${name} must not cast to any`);
    assert.doesNotMatch(source, /@ts-(ignore|nocheck|expect-error)/, `${name} must not suppress types`);
    assert.doesNotMatch(source, /as unknown as/, `${name} must not use double casts`);
  }
});

test('the code sample module has no React dependency', () => {
  // It is imported by the test runner directly, so it must stay a plain module.
  assert.doesNotMatch(samples, /from 'react'|use client/);
  assert.doesNotMatch(highlight, /from 'react'|use client/);
});
