/**
 * Slug generation for workspace URLs and LiveKit room names.
 *
 * Danish characters are transliterated rather than stripped, so "Blomster &
 * Haveservice" becomes `blomster-haveservice` and not `blomster--haveservice`.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
