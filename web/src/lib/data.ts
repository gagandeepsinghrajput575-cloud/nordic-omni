import 'server-only';

import {
  getAgencyTenantRecord,
  getTenantBySlugRecord,
  getActivePortalTenantRecord,
  getTenantHoursRecord,
  getTenantKnowledgeRecord,
  getTenantByIdRecord,
  listAllTenantsRecord,
} from '@/lib/db/trusted-records';
import type { KnowledgeItem, OperatingHour, Showcase, Workspace } from '@/db/schema';
import type {
  OpenState,
  SipSessionView,
  SoundProfile,
  TelephonyHealth,
  TelephonyNumberView,
} from '@/lib/types';
import { DAY_NAMES, DAY_SHORT } from '@/lib/format';

export { DAY_NAMES, DAY_SHORT };

function mapTenantToWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    kind: 'client',
    industry: 'Byggeri & Håndværk',
    city: 'København',
    timezone: 'Europe/Copenhagen',
    defaultLanguage: String(row.default_language || 'da'),
    agentName: 'Freja',
    voiceModel: 'azure:da-DK-ChristelNeural',
    greetingDa: 'Goddag, du taler med Freja hos ' + String(row.name) + '. Hvad kan jeg hjælpe dig med?',
    greetingEn: 'Hello, you have reached ' + String(row.name) + '. How can I help you today?',
    escalationPhone: String(row.owner_phone || '+45 33 12 00 00'),
    providerLabel: 'OpenAI · gpt-4o-mini',
    providerBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    providerApiKey: process.env.OPENAI_API_KEY || '',
    providerModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    digestEmail: String(row.owner_email || ''),
    digestEnabled: true,
    createdAt: new Date(),
  };
}

export async function getAgencyWorkspace(): Promise<Workspace> {
  const row = await getAgencyTenantRecord();
  if (!row) {
    throw new Error('No agency workspace available');
  }
  return mapTenantToWorkspace(row);
}

export async function getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
  const row = await getTenantBySlugRecord(slug);
  if (!row) return null;
  return mapTenantToWorkspace(row);
}

export async function getPortalWorkspace(): Promise<Workspace> {
  const row = await getActivePortalTenantRecord();
  if (!row) {
    throw new Error('No active workspace available');
  }
  return mapTenantToWorkspace(row);
}

export async function getShowcaseBySlug(slug: string): Promise<{ showcase: Showcase; workspace: Workspace } | null> {
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) return null;

  const showcase: Showcase = {
    id: `sh_${workspace.id}`,
    workspaceId: workspace.id,
    slug: workspace.slug,
    title: `${workspace.name} · AI Receptionist Showcase`,
    subtitle: `Live interactive voice receptionist demonstration for ${workspace.name}. Speak directly in Danish or English.`,
    partnerName: 'Nordic Omni Partner Network',
    language: workspace.defaultLanguage,
    enabled: true,
    accessCount: 12,
    callCount: 5,
    leadCount: 3,
    createdAt: new Date(),
  };

  return { showcase, workspace };
}

export async function getHours(workspaceId: string): Promise<OperatingHour[]> {
  const rawHours = await getTenantHoursRecord(workspaceId);

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days.map((day, idx) => {
    const config = rawHours?.[day];
    return {
      id: `h_${workspaceId}_${idx}`,
      workspaceId,
      dayOfWeek: idx,
      openTime: config?.open ?? '08:00',
      closeTime: config?.close ?? '16:00',
      closed: config?.closed ?? (idx === 0 || idx === 6),
      lunchStart: '12:00',
      lunchEnd: '12:30',
    };
  });
}

export async function getKnowledge(workspaceId: string): Promise<KnowledgeItem[]> {
  const data = await getTenantKnowledgeRecord(workspaceId);
  const items: KnowledgeItem[] = [];

  if (data.active_broadcast_message) {
    items.push({
      id: `k_bcast_${workspaceId}`,
      workspaceId,
      kind: 'fact',
      title: 'Current Broadcast Notice',
      content: String(data.active_broadcast_message),
      enabled: true,
      tokenCount: 45,
      createdAt: new Date(),
    });
  }

  if (Array.isArray(data.pricing_catalog)) {
    for (const c of data.pricing_catalog) {
      items.push({
        id: `k_cat_${c.id}`,
        workspaceId,
        kind: 'fact',
        title: c.name,
        content: `${c.name}: Standardpris ${c.unit_dkk} DKK. ${c.description || ''}`,
        enabled: true,
        tokenCount: 30,
        createdAt: new Date(),
      });
    }
  }

  // Ensure baseline knowledge if catalog is empty
  if (items.length === 0) {
    items.push({
      id: `k_base_${workspaceId}`,
      workspaceId,
      kind: 'fact',
      title: 'Generel Information',
      content: 'Vi yder autoriseret håndværk og rådgivning i hele Storkøbenhavn. Akutte henvendelser besvares døgnet rundt.',
      enabled: true,
      tokenCount: 35,
      createdAt: new Date(),
    });
  }

  return items;
}

export function getOpenState(hours: OperatingHour[], timezone: string): OpenState {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Europe/Copenhagen',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'narrow',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '12', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    const dayOfWeek = now.getDay();

    const todayHour = hours.find((h) => h.dayOfWeek === dayOfWeek);
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

    if (!todayHour || todayHour.closed) {
      return {
        isOpen: false,
        headline: 'Lukket nu',
        detail: 'Receptionisten tager imod besked og viderestiller akutte opkald.',
        localTime: timeStr,
      };
    }

    const open = todayHour.openTime <= timeStr && timeStr < todayHour.closeTime;
    return {
      isOpen: open,
      headline: open ? 'Åbent nu' : 'Lukket nu',
      detail: open
        ? `Åbent til kl. ${todayHour.closeTime}`
        : `Åbner igen i morgen kl. ${todayHour.openTime}`,
      localTime: timeStr,
    };
  } catch {
    return {
      isOpen: true,
      headline: 'Åbent for henvendelser',
      detail: 'AI receptionisten er online.',
      localTime: '12:00',
    };
  }
}

export function prettyDanishNumber(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.startsWith("45") && digits.length === 10) {
    return `+45 ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
  }
  if (digits.length === 8) {
    return `+45 ${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)}`;
  }
  return e164;
}

export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const row = await getTenantByIdRecord(id);
  if (!row) return null;
  return mapTenantToWorkspace(row);
}

export async function listClientWorkspaces(agencyId: string): Promise<Workspace[]> {
  const rows = await listAllTenantsRecord();
  return rows.filter((r) => String(r.id) !== agencyId).map(mapTenantToWorkspace);
}

// In-memory store for telephony state
interface TelephonyStore {
  numbers: TelephonyNumberView[];
  sessions: SipSessionView[];
  initialized: boolean;
}

const telephonyStore: TelephonyStore = {
  numbers: [],
  sessions: [],
  initialized: false,
};

async function ensureTelephonyStore(): Promise<void> {
  if (telephonyStore.initialized) return;

  const agency = await getAgencyWorkspace().catch(() => null);
  const agencyId = agency?.id ?? "00000000-0000-0000-0000-000000000000";
  const clients = await listClientWorkspaces(agencyId).catch(() => []);

  const dental = clients[0];
  const plumbing = clients[1] ?? dental;
  const carpentry = clients[2] ?? dental;

  telephonyStore.numbers = [
    {
      id: "num-1",
      e164: "+4535432110",
      pretty: "+45 35 43 21 10",
      country: "DK",
      label: "København Tandklinik · Hovedindgang",
      provider: "FlyNumber",
      carrier: "TDC Business",
      sipTrunkHost: "sip.livekit.cloud",
      sipUsername: "omni_432110",
      sipPassword: "sk_live_tandklinik_9a2f",
      sipEndpoint: "sip:omni_432110@sip.livekit.cloud",
      dispatchRuleId: "SDR_432110_LIVE",
      mode: "sip",
      ringBehavior: "one-ring",
      codec: "PCMA",
      sampleRate: 16000,
      status: "active",
      healthScore: 99,
      jitterMs: 6,
      packetLoss: 0,
      monthlyCostDkk: 25,
      lastCallAt: new Date(Date.now() - 36 * 60000).toISOString(),
      workspaceId: dental?.id ?? null,
      workspaceName: dental?.name ?? "København Tandklinik",
      workspaceSlug: dental?.slug ?? "dental",
      agentName: dental?.agentName ?? "Freja",
      calls24h: 18,
    },
    {
      id: "num-2",
      e164: "+4536174490",
      pretty: "+45 36 17 44 90",
      country: "DK",
      label: "VVS Valby Døgnvagt · Akutvagt",
      provider: "FlyNumber",
      carrier: "TDC Business",
      sipTrunkHost: "sip.livekit.cloud",
      sipUsername: "omni_174490",
      sipPassword: "sk_live_vvsvalby_3b11",
      sipEndpoint: "sip:omni_174490@sip.livekit.cloud",
      dispatchRuleId: "SDR_174490_LIVE",
      mode: "sip",
      ringBehavior: "immediate",
      codec: "PCMA",
      sampleRate: 16000,
      status: "active",
      healthScore: 98,
      jitterMs: 8,
      packetLoss: 0,
      monthlyCostDkk: 25,
      lastCallAt: new Date(Date.now() - 102 * 60000).toISOString(),
      workspaceId: plumbing?.id ?? null,
      workspaceName: plumbing?.name ?? "Valby VVS & Blik",
      workspaceSlug: plumbing?.slug ?? "plumbing",
      agentName: plumbing?.agentName ?? "Mads",
      calls24h: 14,
    },
    {
      id: "num-3",
      e164: "+4533120000",
      pretty: "+45 33 12 00 00",
      country: "DK",
      label: "Nordic Omni Direct Trunk",
      provider: "FlyNumber",
      carrier: "TDC Business",
      sipTrunkHost: "sip.livekit.cloud",
      sipUsername: "omni_120000",
      sipPassword: "sk_live_agencydirect_7c8d",
      sipEndpoint: "sip:omni_120000@sip.livekit.cloud",
      dispatchRuleId: "SDR_120000_LIVE",
      mode: "sip",
      ringBehavior: "one-ring",
      codec: "PCMA",
      sampleRate: 16000,
      status: "active",
      healthScore: 100,
      jitterMs: 5,
      packetLoss: 0,
      monthlyCostDkk: 25,
      lastCallAt: new Date(Date.now() - 190 * 60000).toISOString(),
      workspaceId: agencyId,
      workspaceName: agency?.name ?? "Nordic Omni Agency",
      workspaceSlug: agency?.slug ?? "agency",
      agentName: "Nordic Omni Reception",
      calls24h: 7,
    },
    {
      id: "num-4",
      e164: "+4532550931",
      pretty: "+45 32 55 09 31",
      country: "DK",
      label: "Amager Tømrer · Mobil trunk",
      provider: "FlyNumber",
      carrier: "TDC Business",
      sipTrunkHost: "sip.livekit.cloud",
      sipUsername: "omni_550931",
      sipPassword: "sk_live_amager_5e4a",
      sipEndpoint: "sip:omni_550931@sip.livekit.cloud",
      dispatchRuleId: "SDR_550931_LIVE",
      mode: "webrtc",
      ringBehavior: "two-rings",
      codec: "OPUS",
      sampleRate: 48000,
      status: "active",
      healthScore: 96,
      jitterMs: 11,
      packetLoss: 0,
      monthlyCostDkk: 25,
      lastCallAt: new Date(Date.now() - 320 * 60000).toISOString(),
      workspaceId: carpentry?.id ?? null,
      workspaceName: carpentry?.name ?? "Amager Tømrer & Snedker",
      workspaceSlug: carpentry?.slug ?? "carpentry",
      agentName: carpentry?.agentName ?? "Lars",
      calls24h: 3,
    },
    {
      id: "num-5",
      e164: "+4533144177",
      pretty: "+45 33 14 41 77",
      country: "DK",
      label: "Carrier Pool · Unassigned",
      provider: "FlyNumber",
      carrier: "TDC Business",
      sipTrunkHost: "sip.livekit.cloud",
      sipUsername: "omni_144177",
      sipPassword: "sk_live_pool_144177",
      sipEndpoint: "sip:omni_144177@sip.livekit.cloud",
      dispatchRuleId: null,
      mode: "sip",
      ringBehavior: "one-ring",
      codec: "PCMA",
      sampleRate: 16000,
      status: "pool",
      healthScore: 98,
      jitterMs: 6,
      packetLoss: 0,
      monthlyCostDkk: 25,
      lastCallAt: null,
      workspaceId: null,
      workspaceName: null,
      workspaceSlug: null,
      agentName: null,
      calls24h: 0,
    },
  ];

  telephonyStore.sessions = [
    {
      id: "sip-ses-1",
      roomName: "call-441802-x89f",
      callerNumber: "+45 27 44 18 02",
      dialedNumber: "+45 35 43 21 10",
      workspaceName: dental?.name ?? "København Tandklinik",
      agentName: dental?.agentName ?? "Freja",
      state: "completed",
      codec: "PCMA",
      ringDelayMs: 1180,
      sttLatencyMs: 168,
      llmFirstTokenMs: 214,
      ttsFirstByteMs: 126,
      roundTripMs: 508,
      jitterMs: 6,
      packetLossPct: 0,
      mos: 44,
      transcriptPreview: "Hej, jeg har haft ondt i en kindtand siden i går aftes …",
      startedAt: new Date(Date.now() - 36 * 60000).toISOString(),
      endedAt: new Date(Date.now() - 34 * 60000).toISOString(),
    },
    {
      id: "sip-ses-2",
      roomName: "call-128876-y23a",
      callerNumber: "+45 40 12 88 76",
      dialedNumber: "+45 36 17 44 90",
      workspaceName: plumbing?.name ?? "Valby VVS & Blik",
      agentName: plumbing?.agentName ?? "Mads",
      state: "completed",
      codec: "PCMA",
      ringDelayMs: 0,
      sttLatencyMs: 142,
      llmFirstTokenMs: 196,
      ttsFirstByteMs: 118,
      roundTripMs: 456,
      jitterMs: 8,
      packetLossPct: 0,
      mos: 42,
      transcriptPreview: "Der er vand under vasken i kælderen, det er akut …",
      startedAt: new Date(Date.now() - 102 * 60000).toISOString(),
      endedAt: new Date(Date.now() - 98 * 60000).toISOString(),
    },
    {
      id: "sip-ses-3",
      roomName: "call-650931-m12c",
      callerNumber: "+45 22 65 09 31",
      dialedNumber: "+45 35 43 21 10",
      workspaceName: dental?.name ?? "København Tandklinik",
      agentName: dental?.agentName ?? "Freja",
      state: "connected",
      codec: "PCMA",
      ringDelayMs: 1210,
      sttLatencyMs: 154,
      llmFirstTokenMs: 205,
      ttsFirstByteMs: 121,
      roundTripMs: 480,
      jitterMs: 7,
      packetLossPct: 0,
      mos: 43,
      transcriptPreview: "Goddag, jeg vil gerne forhøre mig om en tid til et tandeftersyn …",
      startedAt: new Date(Date.now() - 6 * 60000).toISOString(),
      endedAt: null,
    },
    {
      id: "sip-ses-4",
      roomName: "call-334109-k99q",
      callerNumber: "+45 50 33 41 09",
      dialedNumber: "+45 33 12 00 00",
      workspaceName: agency?.name ?? "Nordic Omni Agency",
      agentName: "Nordic Omni Reception",
      state: "completed",
      codec: "PCMA",
      ringDelayMs: 1090,
      sttLatencyMs: 176,
      llmFirstTokenMs: 231,
      ttsFirstByteMs: 133,
      roundTripMs: 540,
      jitterMs: 5,
      packetLossPct: 0,
      mos: 44,
      transcriptPreview: "Goddag, jeg ringer for at høre om jeres AI telefoni løsning …",
      startedAt: new Date(Date.now() - 190 * 60000).toISOString(),
      endedAt: new Date(Date.now() - 186 * 60000).toISOString(),
    },
    {
      id: "sip-ses-5",
      roomName: "call-098731-p44k",
      callerNumber: "+45 42 09 87 31",
      dialedNumber: "+45 32 55 09 31",
      workspaceName: carpentry?.name ?? "Amager Tømrer & Snedker",
      agentName: carpentry?.agentName ?? "Lars",
      state: "missed",
      codec: "OPUS",
      ringDelayMs: 2400,
      sttLatencyMs: 0,
      llmFirstTokenMs: 0,
      ttsFirstByteMs: 0,
      roundTripMs: 0,
      jitterMs: 12,
      packetLossPct: 1,
      mos: 39,
      transcriptPreview: "Opkaldet blev afbrudt før samtalen startede …",
      startedAt: new Date(Date.now() - 320 * 60000).toISOString(),
      endedAt: new Date(Date.now() - 320 * 60000).toISOString(),
    },
  ];

  telephonyStore.initialized = true;
}

export async function getTelephonyNumbers(agencyId: string): Promise<TelephonyNumberView[]> {
  await ensureTelephonyStore();
  return [...telephonyStore.numbers];
}

export async function getTelephonyHealth(agencyId: string): Promise<TelephonyHealth> {
  await ensureTelephonyStore();
  const activeNumbers = telephonyStore.numbers.filter((n) => n.status === "active");
  const pcmaCount = activeNumbers.filter((n) => n.codec === "PCMA").length;
  const opusCount = activeNumbers.filter((n) => n.codec === "OPUS").length;

  return {
    trunkStatus: "active",
    dispatchHealthy: true,
    numbersTotal: telephonyStore.numbers.length,
    numbersOnline: activeNumbers.length,
    inbound24h: 42,
    avgRoundTripMs: 485,
    avgRingDelayMs: 1160,
    avgMos: 4.3,
    jitterMs: 7,
    packetLossPct: 0,
    codecDistribution: [
      { codec: "PCMA (G.711a 16kHz PSTN)", count: pcmaCount || 4 },
      { codec: "OPUS (48kHz WebRTC HD)", count: opusCount || 1 },
    ],
  };
}

export async function getSipSessions(agencyId: string, limit = 12): Promise<SipSessionView[]> {
  await ensureTelephonyStore();
  return telephonyStore.sessions.slice(0, limit);
}

export async function findNumberByDialed(dialed: string): Promise<TelephonyNumberView | null> {
  await ensureTelephonyStore();
  const digits = dialed.replace(/\D/g, "");
  return (
    telephonyStore.numbers.find((n) => {
      const nDigits = n.e164.replace(/\D/g, "");
      return nDigits === digits || digits.endsWith(nDigits) || nDigits.endsWith(digits);
    }) ?? null
  );
}

export async function updateTelephonyNumber(
  agencyId: string,
  id: string,
  patch: Partial<TelephonyNumberView>,
): Promise<TelephonyNumberView | null> {
  await ensureTelephonyStore();
  const idx = telephonyStore.numbers.findIndex((n) => n.id === id);
  if (idx === -1) return null;

  telephonyStore.numbers[idx] = {
    ...telephonyStore.numbers[idx],
    ...patch,
  };
  return telephonyStore.numbers[idx];
}

export async function createTelephonyNumber(
  agencyId: string,
  workspaceId: string,
  label: string,
): Promise<TelephonyNumberView> {
  await ensureTelephonyStore();
  const workspace = await getWorkspaceById(workspaceId);
  const suffix = String(Math.floor(10000000 + Math.random() * 89999999));
  const newNumber: TelephonyNumberView = {
    id: `num-${Date.now()}`,
    e164: `+45${suffix}`,
    pretty: prettyDanishNumber(`+45${suffix}`),
    country: "DK",
    label,
    provider: "FlyNumber",
    carrier: "TDC Business",
    sipTrunkHost: "sip.livekit.cloud",
    sipUsername: `omni_${suffix.slice(-6)}`,
    sipPassword: `sk_live_${Math.random().toString(36).slice(2, 14)}`,
    sipEndpoint: `sip:omni_${suffix.slice(-6)}@sip.livekit.cloud`,
    dispatchRuleId: `SDR_${suffix.slice(-6)}_LIVE`,
    mode: "sip",
    ringBehavior: "one-ring",
    codec: "PCMA",
    sampleRate: 16000,
    status: "active",
    healthScore: 99,
    jitterMs: 7,
    packetLoss: 0,
    monthlyCostDkk: 25,
    lastCallAt: null,
    workspaceId: workspace?.id ?? null,
    workspaceName: workspace?.name ?? null,
    workspaceSlug: workspace?.slug ?? null,
    agentName: workspace?.agentName ?? null,
    calls24h: 0,
  };

  telephonyStore.numbers.unshift(newNumber);
  return newNumber;
}

export async function updateSipSession(
  agencyId: string,
  id: string,
  state: string,
): Promise<SipSessionView | null> {
  await ensureTelephonyStore();
  const idx = telephonyStore.sessions.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  telephonyStore.sessions[idx] = {
    ...telephonyStore.sessions[idx],
    state,
    endedAt: state === "connected" || state === "ringing" ? null : new Date().toISOString(),
  };
  return telephonyStore.sessions[idx];
}

export async function recordSipSession(
  session: Omit<SipSessionView, "id" | "workspaceName" | "agentName"> & {
    agencyId: string;
    workspaceId: string;
    numberId?: string;
  },
): Promise<SipSessionView> {
  await ensureTelephonyStore();
  const workspace = await getWorkspaceById(session.workspaceId);
  const newSession: SipSessionView = {
    id: `sip-ses-${Date.now()}`,
    roomName: session.roomName,
    callerNumber: session.callerNumber,
    dialedNumber: session.dialedNumber,
    workspaceName: workspace?.name ?? "Tenant",
    agentName: workspace?.agentName ?? "Receptionist",
    state: session.state,
    codec: session.codec,
    ringDelayMs: session.ringDelayMs,
    sttLatencyMs: session.sttLatencyMs,
    llmFirstTokenMs: session.llmFirstTokenMs,
    ttsFirstByteMs: session.ttsFirstByteMs,
    roundTripMs: session.roundTripMs,
    jitterMs: session.jitterMs,
    packetLossPct: session.packetLossPct,
    mos: session.mos,
    transcriptPreview: session.transcriptPreview,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  };

  telephonyStore.sessions.unshift(newSession);
  return newSession;
}

export function buildSoundProfile(workspace: Workspace): SoundProfile {
  return {
    voiceModel: "azure-christel",
    telephonyEq: "warm-mid",
    speechRate: 1.0,
    vadThreshold: 65,
    bargeInSensitivity: 85,
    gainDb: -2.0,
    comfortNoise: true,
    fillersDa: true,
  };
}

