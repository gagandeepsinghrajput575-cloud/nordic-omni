/**
 * A deliberately small syntax highlighter.
 *
 * Why not Prism or Shiki: this renders four fixed snippets in a marketing
 * section. Shiki would add a build-time grammar per language and Prism a
 * runtime dependency, both to colour ~20 lines of code we already control. The
 * whole job is "find strings, comments, keywords, numbers, and object keys",
 * which is a single ordered regex.
 *
 * The output is a token list, not HTML — the component renders `<span>`s from
 * it. That keeps `dangerouslySetInnerHTML` out of the codebase entirely, so a
 * snippet can never inject markup.
 *
 * Colours are assigned by token *class*, never inline, so the whole palette is
 * neutral steps declared once in globals.css.
 */

export type TokenKind = 'plain' | 'keyword' | 'string' | 'number' | 'property' | 'comment';

export interface CodeToken {
  kind: TokenKind;
  text: string;
}

export interface CodeLine {
  tokens: CodeToken[];
}

/** Word-boundaried keywords only. Bare words like `curl` or `limit` are not
 *  keywords — matching them would swallow identifiers and numbers mid-line. */
const KEYWORDS = [
  'import', 'from', 'const', 'let', 'var', 'await', 'async', 'new', 'return',
  'export', 'function', 'package', 'func', 'def', 'type', 'interface',
  'true', 'false', 'null', 'nil',
] as const;

/**
 * One pass, ordered alternation. Order is the whole correctness argument:
 *
 *  1. comments before strings would eat `//` inside a URL, so strings come first
 *  2. property before keyword, so an object key named `type` stays a key
 *  3. number before keyword, so a digit run cannot be captured by a bare word
 *
 * Numbers go ahead of keywords deliberately: `limit: 25` was previously
 * mis-tokenised because the keyword branch matched first and consumed the
 * identifier, leaving the number stranded.
 */
const TOKEN_RE = new RegExp(
  [
    /(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/.source,
    /(?<comment>\/\/[^\n]*|#[^\n]*)/.source,
    /(?<property>[A-Za-z_$][\w$]*(?=\s*:))/.source,
    /(?<number>-?\b\d+(?:\.\d+)?\b)/.source,
    new RegExp(`(?<keyword>\\b(?:${KEYWORDS.join('|')})\\b)`).source,
  ].join('|'),
  'g',
);

export function tokenizeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let lastIndex = 0;

  // A fresh regex per line: the global flag carries `lastIndex` state, and a
  // shared instance would skip matches once two lines are tokenised.
  const re = new RegExp(TOKEN_RE.source, 'g');
  for (const match of line.matchAll(re)) {
    const groups = match.groups ?? {};
    const kind: TokenKind =
      groups.comment !== undefined
        ? 'comment'
        : groups.string !== undefined
          ? 'string'
          : groups.property !== undefined
            ? 'property'
            : groups.keyword !== undefined
              ? 'keyword'
              : 'number';

    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ kind: 'plain', text: line.slice(lastIndex, index) });
    }
    tokens.push({ kind, text: match[0] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < line.length) {
    tokens.push({ kind: 'plain', text: line.slice(lastIndex) });
  }

  // An empty line still needs one token so it keeps its height.
  if (tokens.length === 0) tokens.push({ kind: 'plain', text: '' });
  return tokens;
}

export function tokenize(source: string): CodeLine[] {
  return source.split('\n').map((line) => ({ tokens: tokenizeLine(line) }));
}
