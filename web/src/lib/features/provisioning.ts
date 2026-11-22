/**
 * Client Feature Provisioning & Policy Governance
 * Controls which features, tabs, and capabilities a client workspace is allowed to see and use.
 * If a feature is toggled off, it is completely hidden from the client portal navigation and dashboard.
 */

export type FeatureKey =
  | 'chatbot'
  | 'antigravity'
  | 'ai_caller'
  | 'leads_crm'
  | 'meta_ads'
  | 'ai_seo'
  | 'settings';

export interface FeatureDefinition {
  key: FeatureKey;
  label: string;
  labelDa: string;
  description: string;
  descriptionDa: string;
  defaultEnabled: boolean;
}

export const ALL_FEATURES: FeatureDefinition[] = [
  {
    key: 'antigravity',
    label: 'Antigravity Agent',
    labelDa: 'Antigravity Agent',
    description: 'Autonomous AI engineer and marketing task execution workspace',
    descriptionDa: 'Autonom AI-ingeniør og arbejdsrum til automatiseret opgaveudførelse',
    defaultEnabled: true,
  },
  {
    key: 'chatbot',
    label: 'AI Chatbot & Copilot',
    labelDa: 'AI Chatbot & Co-pilot',
    description: 'Direct customer web chat, grounding copilot, and message history',
    descriptionDa: 'Direkte kunde-webchat, forankret co-pilot og beskedhistorik',
    defaultEnabled: true,
  },
  {
    key: 'ai_caller',
    label: 'AI Voice Receptionist',
    labelDa: 'AI Stemmereceptionist',
    description: 'ElevenLabs voice caller, WebRTC audio test console, and inbound phone routing',
    descriptionDa: 'ElevenLabs stemmeopkald, WebRTC-testkonsol og indgående telefonrute',
    defaultEnabled: true,
  },
  {
    key: 'leads_crm',
    label: 'Callers & Pipeline CRM',
    labelDa: 'Kunder & Pipeline CRM',
    description: 'Lead stages, estimated caller value, and escalation tracking',
    descriptionDa: 'Lead-stadier, anslået kundeværdi og opfølgningssager',
    defaultEnabled: true,
  },
  {
    key: 'meta_ads',
    label: 'Meta Ads Manager',
    labelDa: 'Meta Annoncestyring',
    description: 'Automated ad set creation, copy generation, and budget guardrails',
    descriptionDa: 'Automatiseret oprettelse af annoncesæt, tekster og budgetgrænser',
    defaultEnabled: false,
  },
  {
    key: 'ai_seo',
    label: 'AI SEO & GEO Plugin',
    labelDa: 'AI SEO & GEO Plugin',
    description: 'Generative Engine Optimization for Perplexity, ChatGPT, and AI Search citation',
    descriptionDa: 'Generative Engine Optimization til synlighed i Perplexity, ChatGPT og AI-søgning',
    defaultEnabled: false,
  },
  {
    key: 'settings',
    label: 'Workspace Settings',
    labelDa: 'Indstillinger',
    description: 'Client profile, operating hours, and business facts configuration',
    descriptionDa: 'Virksomhedsprofil, åbningstider og stamoplysninger',
    defaultEnabled: true,
  },
];

export const DEFAULT_CLIENT_FEATURES: FeatureKey[] = ALL_FEATURES
  .filter((f) => f.defaultEnabled)
  .map((f) => f.key);

const VALID_FEATURE_KEYS = new Set<string>(ALL_FEATURES.map((f) => f.key));

/**
 * Normalizes raw enabled_features from database or form input.
 */
export function parseEnabledFeatures(raw: unknown): FeatureKey[] {
  if (raw === null || raw === undefined) {
    return [...DEFAULT_CLIENT_FEATURES];
  }
  if (!Array.isArray(raw)) {
    return [...DEFAULT_CLIENT_FEATURES];
  }
  return raw.filter((item): item is FeatureKey => typeof item === 'string' && VALID_FEATURE_KEYS.has(item));
}

export interface TenantFeatureState {
  enabled_features?: unknown;
  master_opt_out?: boolean | null;
  allowed_sender_emails?: unknown;
}

/**
 * Checks if a specific feature is enabled for a tenant.
 * Returns false immediately if master_opt_out is active.
 */
export function isFeatureEnabled(tenant: TenantFeatureState, feature: FeatureKey): boolean {
  if (tenant.master_opt_out === true) {
    return false;
  }
  const enabled = parseEnabledFeatures(tenant.enabled_features);
  return enabled.includes(feature);
}

export interface NavItemWithFeature {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  featureKey?: FeatureKey;
}

/**
 * Filters navigation items so that toggled-off features are completely removed from the dashboard navigation.
 */
export function filterClientNavigation<T extends { href: string; featureKey?: FeatureKey }>(
  items: T[],
  tenant: TenantFeatureState
): T[] {
  if (tenant.master_opt_out === true) {
    // If master opt-out is on, hide all feature tabs except base overview
    return items.filter((item) => item.featureKey === undefined);
  }

  const enabled = new Set(parseEnabledFeatures(tenant.enabled_features));

  return items.filter((item) => {
    if (!item.featureKey) {
      return true; // Core overview or unkeyed item
    }
    return enabled.has(item.featureKey);
  });
}

/**
 * Verifies if an outbound sender email is authorized by the client's email whitelist.
 */
export function isSenderEmailAllowed(email: string, whitelist: unknown): boolean {
  if (!email || typeof email !== 'string') return false;
  if (!Array.isArray(whitelist) || whitelist.length === 0) return false;

  const normalized = email.trim().toLowerCase();
  return whitelist.some(
    (allowed) => typeof allowed === 'string' && allowed.trim().toLowerCase() === normalized
  );
}
