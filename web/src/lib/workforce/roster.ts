/**
 * The workforce roster and switchboard definitions.
 *
 * This is a **prototype**: every figure below is a fixed sample, not a reading
 * from a live system. Nothing here polls, and no agent in this repository
 * executes these missions. The UI says so in the HUD and the feed footer, and
 * the components take these values as props rather than fetching them, so
 * wiring a real source later is a substitution rather than a rewrite.
 *
 * A plain `.ts` module so the test runner can import it as a value; the
 * components hold no copy of their own.
 */

export type PodId = 'creative' | 'paid-media' | 'seo-geo' | 'voice';

export type PodStatus = 'active' | 'idle' | 'attention';

export interface PodMetric {
  label: string;
  value: string;
}

export interface EmployeePod {
  id: PodId;
  role: string;
  name: string;
  /** One line on what the pod owns. */
  charter: string;
  status: PodStatus;
  statusLabel: string;
  metrics: ReadonlyArray<PodMetric>;
  capabilities: ReadonlyArray<string>;
  /** Drawer detail: two-column key/value lines. */
  drawer: ReadonlyArray<{ key: string; value: string }>;
}

export const PODS: ReadonlyArray<EmployeePod> = [
  {
    id: 'creative',
    role: 'Kreativ direktør',
    name: 'Creative Director AI',
    charter: 'Finder vinklen, spinner hooks og bygger prompt-arkitekturen.',
    status: 'active',
    statusLabel: 'Arbejder',
    metrics: [
      { label: 'Hooks', value: '24' },
      { label: 'Vinkler', value: '7' },
      { label: 'Win rate', value: '31 %' },
    ],
    capabilities: ['Hook & angle spinner', 'Offer RAG miner', 'Prompt-arkitekt'],
    drawer: [
      { key: 'Hook-spinner', value: '24 udkast · 7 vinkler · 3 valgt til test' },
      { key: 'Offer RAG', value: 'Læser 12 udbud og prisark fra kundens vidensbase' },
      { key: 'Prompt-arkitekt', value: 'Bygger Higgsfield-sekvenser med fast seed' },
      { key: 'Guardrail', value: 'Ingen kreativ tekst går live uden godkendelse' },
    ],
  },
  {
    id: 'paid-media',
    role: 'Paid media',
    name: 'Paid Media Specialist AI',
    charter: 'Køber performance media på Meta og Google inden for CBO-rammen.',
    status: 'active',
    statusLabel: 'Arbejder',
    metrics: [
      { label: 'ROAS', value: '4,2×' },
      { label: 'CPA', value: '184 kr' },
      { label: 'Budget', value: '62 %' },
    ],
    capabilities: ['Meta & Google', 'CBO guardrail', 'Kampagne-staging'],
    drawer: [
      { key: 'CBO-ramme', value: 'Dagligt loft 2 400 kr · stop ved 85 % forbrug' },
      { key: 'Meta', value: '4 annoncesæt · 2 kreative varianter hver' },
      { key: 'Google', value: 'Search + Performance Max · negativliste deles' },
      { key: 'Guardrail', value: 'Budgetændringer kræver én-kliks godkendelse' },
    ],
  },
  {
    id: 'seo-geo',
    role: 'SEO & GEO',
    name: 'AI SEO & GEO Specialist AI',
    charter: 'Opbygger citationsautoritet i Perplexity og ChatGPT.',
    status: 'attention',
    statusLabel: 'Afventer',
    metrics: [
      { label: 'Citations', value: '128' },
      { label: 'Kilder', value: '9' },
      { label: 'Mangler', value: '2' },
    ],
    capabilities: ['Citation authority', 'Schema-graf', 'GEO-audit'],
    drawer: [
      { key: 'Citationer', value: '128 henvisninger fra 9 domæner, 30 dage' },
      { key: 'Schema-graf', value: 'Organization + Service + FAQPage udrullet' },
      { key: 'Huller', value: '2 sider mangler struktureret data' },
      { key: 'Guardrail', value: 'Ingen indhold ændres uden gennemlæsning' },
    ],
  },
  {
    id: 'voice',
    role: 'Telefonreception',
    name: 'Voice Receptionist AI',
    charter: 'Tager telefonen på dansk og engelsk og booker i kalenderen.',
    status: 'active',
    statusLabel: 'I samtale',
    metrics: [
      { label: 'Svartid', value: '128 ms' },
      { label: 'Opkald', value: '17' },
      { label: 'Booket', value: '6' },
    ],
    capabilities: ['< 150 ms svartid', 'Dansk & engelsk', 'Kalender-sync'],
    drawer: [
      { key: 'Svartid', value: '128 ms målt · budget 300 ms barge-in' },
      { key: 'Sprog', value: 'Dansk og engelsk, samme stemme og tone' },
      { key: 'Kalender', value: 'Læser ledige tider og booker direkte' },
      { key: 'Guardrail', value: 'Akutte sager sendes til operatøren med det samme' },
    ],
  },
];

// -----------------------------------------------------------------------------
// Orchestrator
// -----------------------------------------------------------------------------

export interface OrchestratorMetric {
  label: string;
  value: string;
  unit?: string;
}

export const ORCHESTRATOR_METRICS: ReadonlyArray<OrchestratorMetric> = [
  { label: 'Aktive dispatches', value: '4' },
  { label: 'Gennemstrøm', value: '38', unit: 'opgaver/t' },
  { label: 'Kø', value: '2' },
  { label: 'Fejlrate', value: '0,4', unit: '%' },
];

// -----------------------------------------------------------------------------
// 3-way feature switchboard
// -----------------------------------------------------------------------------

export type FeatureMode = 'active' | 'teaser' | 'hidden';

export const FEATURE_MODES: ReadonlyArray<{ value: FeatureMode; label: string }> = [
  { value: 'active', label: 'Aktiv' },
  { value: 'teaser', label: 'Teaser' },
  { value: 'hidden', label: 'Skjult' },
];

export interface PortalFeature {
  id: string;
  label: string;
  hint: string;
  /** What an active feature costs the client, shown in the teaser card. */
  teaserNote: string;
}

export const PORTAL_FEATURES: ReadonlyArray<PortalFeature> = [
  {
    id: 'inbound',
    label: 'Indgående opkald',
    hint: 'Se og afspil optagelser',
    teaserNote: 'Opgrader',
  },
  {
    id: 'leads',
    label: 'Lead-pipeline',
    hint: 'Følg leads fra opkald til booking',
    teaserNote: 'Opgrader',
  },
  {
    id: 'reports',
    label: 'Ugentlig rapport',
    hint: 'KPI-mail hver mandag',
    teaserNote: 'Opgrader',
  },
  {
    id: 'webhooks',
    label: 'Webhook-integration',
    hint: 'Send hændelser til eget system',
    teaserNote: 'Opgrader',
  },
];

export const DEFAULT_FEATURE_MODES: Readonly<Record<string, FeatureMode>> = {
  inbound: 'active',
  leads: 'active',
  reports: 'teaser',
  webhooks: 'hidden',
};

// -----------------------------------------------------------------------------
// Mission feed
// -----------------------------------------------------------------------------

export type FeedKind = 'dispatch' | 'commit' | 'verify' | 'guard';

export interface FeedEntry {
  /** Fixed clock time, so the render is deterministic and hydration-safe. */
  time: string;
  kind: FeedKind;
  message: string;
  /** Verified entries render brighter; this is emphasis, not a colour change. */
  verified: boolean;
}

export const FEED_ENTRIES: ReadonlyArray<FeedEntry> = [
  {
    time: '09:41:02',
    kind: 'dispatch',
    message: 'orchestrator → creative · spin 12 hooks for "sommerklar facade"',
    verified: false,
  },
  {
    time: '09:41:06',
    kind: 'guard',
    message: 'creative · 3 hooks staged, 0 published — awaiting operator approval',
    verified: false,
  },
  {
    time: '09:42:18',
    kind: 'commit',
    message: 'paid-media PR #41 · tighten CBO ceiling to 2 400 kr/day',
    verified: true,
  },
  {
    time: '09:43:55',
    kind: 'verify',
    message: 'verify · tsc clean · 337 tests pass · build ok',
    verified: true,
  },
  {
    time: '09:45:10',
    kind: 'dispatch',
    message: 'voice · answered +4527441802 · Danish · booked Thu 14:30',
    verified: false,
  },
  {
    time: '09:47:31',
    kind: 'guard',
    message: 'seo-geo · 2 pages missing schema markup — flagged, not edited',
    verified: false,
  },
  {
    time: '09:48:02',
    kind: 'commit',
    message: 'seo-geo PR #42 · add FAQPage schema to /priser and /om-os',
    verified: true,
  },
];
