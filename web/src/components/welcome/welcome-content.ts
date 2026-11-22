/**
 * Copy and structure for the final pieces, as plain data.
 *
 * Kept out of the components for two reasons:
 *
 *  1. The test runner uses the classic JSX transform, so a `.tsx` module cannot
 *     be imported without React in scope. A plain `.ts` module is testable as a
 *     pure value, which is what the assertions actually want to check.
 *  2. The assurance claims are the most reviewable strings on the page. One
 *     place to correct them is better than four JSX blocks.
 *
 * On the claims themselves: SOC 2 Type II, GDPR, a 99.99% uptime SLA and
 * encrypted vaults describe the deployment this product targets. They are not
 * certifications this repository contains evidence of.
 */

export interface NavLink {
  href: string;
  label: string;
}

export const NAV_LINKS: ReadonlyArray<NavLink> = [
  { href: '/showcase', label: 'Produkt' },
  { href: '/agency/webhooks', label: 'Udviklere' },
  { href: '/login', label: 'Priser' },
];

/** Scroll distance, in px, past which the nav border appears. */
export const BORDER_REVEAL_PX = 20;

/** The three entry points the navigation must reach. */
export const NAV_TARGETS = ['/login', '/portal', '/agency'] as const;

// -----------------------------------------------------------------------------
// Enterprise assurance
// -----------------------------------------------------------------------------

export type AssuranceGlyphId = 'shield' | 'pin' | 'pulse' | 'lock';

export interface AssuranceCard {
  id: string;
  title: string;
  body: string;
  badge: string;
  glyph: AssuranceGlyphId;
}

export const ASSURANCES: ReadonlyArray<AssuranceCard> = [
  {
    id: 'soc2',
    title: 'SOC 2 Type II',
    body: 'Kontroller for adgang, ændringer og logning revideres løbende.',
    badge: 'Revisionsspor',
    glyph: 'shield',
  },
  {
    id: 'gdpr',
    title: 'GDPR & dataophold',
    body: 'Persondata behandles i EU. Primær region: København, Danmark.',
    badge: 'EU-region',
    glyph: 'pin',
  },
  {
    id: 'uptime',
    title: '99,99 % oppetid',
    body: 'Beregnet på rullende 30 dage med automatisk failover pr. region.',
    badge: 'SLA',
    glyph: 'pulse',
  },
  {
    id: 'vault',
    title: 'Krypterede datavaults',
    body: 'Kryptering i hvile og under transport. Nøgler roteres og revideres.',
    badge: 'AES-256',
    glyph: 'lock',
  },
];

// -----------------------------------------------------------------------------
// Footer
// -----------------------------------------------------------------------------

export interface FooterColumn {
  title: string;
  links: ReadonlyArray<{ href: string; label: string }>;
}

export const FOOTER_COLUMNS: ReadonlyArray<FooterColumn> = [
  {
    title: 'Produkt',
    links: [
      { href: '/showcase', label: 'Reception' },
      { href: '/showcase', label: 'Opkald' },
      { href: '/showcase', label: 'Booking' },
    ],
  },
  {
    title: 'Udviklere',
    links: [
      { href: '/agency/webhooks', label: 'Inbound webhook' },
      { href: '/agency/webhooks', label: 'Vision AI' },
      { href: '/api/v1/agency/webhook', label: 'API-reference' },
    ],
  },
  {
    title: 'Virksomhed',
    links: [
      { href: '/welcome', label: 'Om os' },
      { href: '/welcome', label: 'Kontakt' },
      { href: '/welcome', label: 'Karriere' },
    ],
  },
  {
    title: 'Jura',
    links: [
      { href: '/welcome', label: 'Privatlivspolitik' },
      { href: '/welcome', label: 'Vilkår' },
      { href: '/welcome', label: 'Databehandleraftale' },
    ],
  },
];
