import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 450_000;
const MAX_PAGES = 4;
const MAX_TEXT_PER_PAGE = 32_000;
const MAX_REDIRECTS = 3;

export interface FetchedSource {
  kind: 'website';
  title: string;
  location: string;
  rawText: string;
}

function extractMappedIpv4(normalized: string): string | null {
  if (!normalized.startsWith('::ffff:')) return null;
  const tail = normalized.slice('::ffff:'.length);
  if (isIP(tail) === 4) return tail;
  const parts = tail.split(':');
  if (parts.length !== 2) return null;
  const hi = Number.parseInt(parts[0], 16);
  const lo = Number.parseInt(parts[1], 16);
  if (
    !Number.isInteger(hi) ||
    !Number.isInteger(lo) ||
    hi < 0 ||
    hi > 0xffff ||
    lo < 0 ||
    lo > 0xffff ||
    !/^[0-9a-f]{1,4}$/.test(parts[0]) ||
    !/^[0-9a-f]{1,4}$/.test(parts[1])
  ) {
    return null;
  }
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    if (parts[0] >= 224) return true;
    return false;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    const mappedV4 = extractMappedIpv4(normalized);
    if (mappedV4) return isPrivateAddress(mappedV4);
    if (normalized.startsWith('::ffff:')) return true;
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }
  return true;
}

export async function assertPublicUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https websites can be imported.');
  }
  if (url.username || url.password) throw new Error('Website URLs cannot contain credentials.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) {
    throw new Error('Local and private addresses are not allowed.');
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error('The website hostname did not resolve.');
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('Local and private addresses are not allowed.');
  }
  return url;
}

async function safeFetch(url: URL): Promise<Response> {
  let current = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(current.toString());
    const response = await fetch(current, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'NORDIC-OMNI-KnowledgeBot/1.0 (+business knowledge import)',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The website returned an invalid redirect.');
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error('The website redirected too many times.');
}

async function readLimited(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_BYTES) throw new Error('The page is larger than the import limit.');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error('The page is larger than the import limit.');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function safeCodePoint(cp: number, fallback: string): string {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return fallback;
  }
  return String.fromCodePoint(cp);
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aelig: 'æ', oslash: 'ø', aring: 'å', AElig: 'Æ', Oslash: 'Ø', Aring: 'Å',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => safeCodePoint(parseInt(hex, 16), entity))
    .replace(/&#(\d+);/g, (entity, dec: string) => safeCodePoint(Number(dec), entity))
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name] ?? entity);
}

/** Pure text extraction so it can be tested without fetching a live site. */
export function extractReadableHtml(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = decodeEntities(titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|canvas|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/section|\/article|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_PER_PAGE);
  return { title: title || 'Business website', text };
}

function discoverPages(html: string, base: URL): URL[] {
  const keywords = /om|about|ydelse|service|pris|price|kontakt|contact|faq/i;
  const seen = new Set<string>();
  const pages: URL[] = [];
  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], base);
      url.hash = '';
      url.search = '';
      if (url.origin !== base.origin || !keywords.test(url.pathname)) continue;
      if (url.pathname === '/' || url.pathname === base.pathname) continue;
      const key = url.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      pages.push(url);
    } catch {
      // Ignore malformed links.
    }
    if (pages.length >= MAX_PAGES - 1) break;
  }
  return pages;
}

export async function fetchWebsiteSources(input: string): Promise<FetchedSource[]> {
  const initial = await assertPublicUrl(input);
  const first = await safeFetch(initial);
  if (!first.ok) throw new Error(`The website returned HTTP ${first.status}.`);
  const contentType = first.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
    throw new Error('The URL did not return an HTML page.');
  }

  const html = await readLimited(first);
  const home = extractReadableHtml(html);
  const sources: FetchedSource[] = [
    { kind: 'website', title: home.title, location: initial.toString(), rawText: home.text },
  ];

  for (const page of discoverPages(html, initial)) {
    try {
      const response = await safeFetch(page);
      if (!response.ok) continue;
      const pageHtml = await readLimited(response);
      const readable = extractReadableHtml(pageHtml);
      if (readable.text.length < 120) continue;
      sources.push({
        kind: 'website',
        title: readable.title,
        location: page.toString(),
        rawText: readable.text,
      });
    } catch {
      // One bad subpage must not discard the homepage.
    }
    if (sources.length >= MAX_PAGES) break;
  }

  return sources;
}
