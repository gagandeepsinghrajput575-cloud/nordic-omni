export type EmployeeRole = 'voice_receptionist';

export type VisibilityMode = 'active' | 'teaser' | 'hidden';

export interface EmployeeMetric {
  label: string;
  value: string;
  change: string;
}

export interface AIEmployee {
  role: EmployeeRole;
  name: string;
  initials: string;
  title: string;
  department: string;
  description: string;
  status: 'Active' | 'Paused' | 'Training';
  metrics: EmployeeMetric[];
  tags: string[];
  avatar: string;
  capabilities: string[];
  sampleTask: string;
  accentHue?: string;
}

export interface FeatureFlagConfig {
  flagKey: string;
  name: string;
  roleAssigned: EmployeeRole;
  description: string;
  mode: VisibilityMode;
  clientVisible: boolean;
  upsellPrice?: string;
}

export interface ClientPortalVisibilityResult {
  activeFeatures: string[];
  teaserFeatures: string[];
  hiddenFeatures: string[];
}

export const AI_EMPLOYEES: AIEmployee[] = [
  {
    role: 'voice_receptionist',
    name: 'Søren Lindqvist',
    initials: 'SL',
    title: 'Inbound Voice Receptionist',
    department: 'Telephony & Emergency Triage',
    description: 'Sub-150ms Danish & English voice receptionist. Triages emergency callouts, checks on-call technician schedules, and books appointments into Cal.com.',
    status: 'Active',
    avatar: 'SL',
    metrics: [
      { label: 'Inbound Calls Handled', value: '3,842', change: '99.8% answered' },
      { label: 'Mean Audio Latency', value: '142ms', change: 'Sub-150ms target' },
      { label: 'Calendar Bookings', value: '648', change: 'Direct to Cal.com' },
    ],
    tags: ['Sub-150ms WebRTC', 'Bilingual da-DK / en-US', 'Cal.com Sync', 'Emergency Triage'],
    capabilities: [
      '24/7 autonomous telephony triage with instant Danish/English dialect switching',
      'Real-time technician calendar availability check & confirmed Cal.com booking',
      'Sub-150ms acoustic barge-in detector for natural interruptions',
      'Instant SMS confirmation and emergency escalation dispatch to on-call tech',
    ],
    sampleTask: 'Simulate emergency pipe burst call in Danish and schedule urgent technician',
  },
];

export const MOCK_FEATURE_FLAGS: FeatureFlagConfig[] = [
  {
    flagKey: 'ai_caller',
    name: 'Autonomous Voice Receptionist',
    roleAssigned: 'voice_receptionist',
    description: 'Sub-150ms Danish conversational voice agent handling inbound calls and Cal.com booking.',
    mode: 'active',
    clientVisible: true,
  },
  {
    flagKey: 'chatbot',
    name: 'Client AI Assistant',
    roleAssigned: 'voice_receptionist',
    description: 'Calm web chat assistant grounded in the tenant’s actual hours, pricing, and services.',
    mode: 'active',
    clientVisible: true,
  },
  {
    flagKey: 'leads_crm',
    name: 'Callers & Pipeline CRM',
    roleAssigned: 'voice_receptionist',
    description: 'Lead stages, estimated caller value, and escalation tracking.',
    mode: 'active',
    clientVisible: true,
  },
  {
    flagKey: 'antigravity',
    name: 'Autonomous Multi-Agent Dispatch',
    roleAssigned: 'voice_receptionist',
    description: 'Internal agency coordinator orchestrating cross-department workflows.',
    mode: 'hidden',
    clientVisible: false,
    upsellPrice: 'Internal agency only',
  },
];

export function calculateClientPortalVisibility(flags: Record<string, VisibilityMode>): ClientPortalVisibilityResult {
  const activeFeatures: string[] = [];
  const teaserFeatures: string[] = [];
  const hiddenFeatures: string[] = [];

  for (const [key, mode] of Object.entries(flags)) {
    if (mode === 'active') {
      activeFeatures.push(key);
    } else if (mode === 'teaser') {
      teaserFeatures.push(key);
    } else if (mode === 'hidden') {
      hiddenFeatures.push(key);
    }
  }

  return {
    activeFeatures,
    teaserFeatures,
    hiddenFeatures,
  };
}
