import 'server-only';

import {
  getAgencyTenantRecord,
  getTenantBySlugRecord,
  getActivePortalTenantRecord,
  getTenantHoursRecord,
  getTenantKnowledgeRecord,
} from '@/lib/db/trusted-records';
import type { KnowledgeItem, OperatingHour, Showcase, Workspace } from '@/db/schema';
import type { OpenState } from '@/lib/types';
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
