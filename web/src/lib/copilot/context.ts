/**
 * Builds the co-pilot's grounded context from real rows.
 *
 * This is the only place where the co-pilot learns anything, and it deliberately
 * imports nothing but RLS-scoped readers. If a read fails, the corresponding
 * fact becomes `null` — the engine then says "I can't read that" rather than
 * treating a failure as zero. Silently turning an outage into "0 calls" would be
 * a factual lie dressed as data.
 */

import { getTenantFacts, getTenantOverview, listOpenEscalations } from '@/lib/db/queries';
import type { CopilotContext, GroundedCatalogItem } from '@/lib/copilot/engine';

function toCatalog(
  rows: ReadonlyArray<{ id: string; service: string; price_dkk?: number | null; unit?: string | null }> | null | undefined,
): GroundedCatalogItem[] {
  if (!rows) return [];
  return rows.map((row) => ({
    id: row.id,
    service: row.service,
    price_dkk: typeof row.price_dkk === 'number' ? row.price_dkk : 0,
    unit: row.unit ?? 'fast pris',
  }));
}

/** Resolve a number, or null when the read itself failed. */
function nullable(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function buildCopilotContext(
  userId: string,
  tenantId: string,
  language: 'da-DK' | 'en-US',
): Promise<CopilotContext | null> {
  const tenant = await getTenantFacts(userId, tenantId);
  if (!tenant) return null;

  const [overview, escalations] = await Promise.all([
    getTenantOverview(userId, tenantId).catch(() => null),
    listOpenEscalations(userId, tenantId, 50).catch(() => null),
  ]);

  const hours = tenant.business_hours ?? null;
  const normalizedHours: CopilotContext['businessHours'] = hours
    ? Object.fromEntries(
        Object.entries(hours).map(([day, value]) => [
          day,
          { open: value.open, close: value.close, closed: value.closed },
        ]),
      )
    : null;

  return {
    tenantId,
    tenantName: tenant.name,
    ownerName: tenant.owner_name,
    language,
    metrics: {
      contacts: nullable(overview?.contacts),
      calls: nullable(overview?.calls),
      booked: nullable(overview?.booked),
      messages: nullable(overview?.messages),
      pipelineDkk: nullable(overview?.pipeline_dkk),
      openEscalations: escalations ? escalations.length : null,
    },
    catalog: toCatalog(tenant.pricing_catalog),
    businessHours: normalizedHours,
    ownerPhone: tenant.owner_phone ?? null,
    ownerEmail: tenant.owner_email ?? null,
    activeBroadcast: tenant.active_broadcast_message ?? null,
  };
}
