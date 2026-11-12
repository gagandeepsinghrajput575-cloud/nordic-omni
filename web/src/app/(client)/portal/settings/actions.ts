'use server';

import { revalidatePath } from 'next/cache';
import { clientScope } from '@/lib/actions/scope';
import { updateTenantFacts } from '@/lib/db/mutations';
import type { ActionState } from '@/lib/actions/types';

/**
 * The client's own facts: contact details, opening hours, price list and the
 * operational broadcast. These are exactly the columns the client is permitted
 * to write (`tenants_client_update`). Behaviour — prompts, persona, escalation
 * policy — is not reachable from this file at all.
 */

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];
type Hours = Record<Day, { open: string; close: string; closed: boolean }>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveFactsAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { session, tenantId } = await clientScope();

  const ownerName = String(formData.get('ownerName') ?? '').trim();
  const ownerPhone = String(formData.get('ownerPhone') ?? '').trim();
  const ownerEmail = String(formData.get('ownerEmail') ?? '').trim();
  const broadcast = formData.get('broadcast');

  if (!ownerName) {
    return { ok: false, field: 'ownerName', error: 'The owner’s name is required.' };
  }
  if (ownerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) {
    return { ok: false, field: 'ownerEmail', error: 'Enter a valid email address.' };
  }

  const affected = await updateTenantFacts(session.userId, tenantId, {
    ownerName,
    ownerPhone: ownerPhone || undefined,
    ownerEmail: ownerEmail || undefined,
    activeBroadcastMessage:
      broadcast === null ? undefined : String(broadcast).trim() || null,
  });

  if (affected === 0) return { ok: false, error: 'Could not save these details.' };

  revalidatePath('/portal');
  revalidatePath('/portal/settings');
  return { ok: true, message: 'Saved. The agent uses this on the next call.' };
}

export async function saveHoursAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { session, tenantId } = await clientScope();

  const hours = {} as Hours;

  for (const day of DAYS) {
    const closed = formData.get(`${day}_closed`) === 'on';
    const open = String(formData.get(`${day}_open`) ?? '08:00');
    const close = String(formData.get(`${day}_close`) ?? '16:00');

    if (!closed) {
      if (!TIME.test(open) || !TIME.test(close)) {
        return {
          ok: false,
          field: `${day}_open`,
          error: `Opening hours for ${day} must look like 08:00.`,
        };
      }
      if (open >= close) {
        return {
          ok: false,
          field: `${day}_open`,
          error: `${day}: closing time must be after opening time.`,
        };
      }
    }

    hours[day] = { open, close, closed };
  }

  const affected = await updateTenantFacts(session.userId, tenantId, {
    businessHours: hours,
  });

  if (affected === 0) return { ok: false, error: 'Could not save opening hours.' };

  revalidatePath('/portal/settings');
  revalidatePath('/portal');
  return { ok: true, message: 'Opening hours saved.' };
}

type PricingRowInput = {
  id: string;
  service: string;
  price_dkk: number;
  unit: string;
  estimate_model?: 'fixed' | 'per_square_meter';
  estimate_min_dkk?: number;
  estimate_max_dkk?: number;
};

function slugServiceId(service: string, usedIds: Set<string>, index: number): string {
  const base =
    service
      .toLowerCase()
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'oe')
      .replace(/å/g, 'aa')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `service-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * Price list. Inputs arrive as `service_<n>`, `price_<n>`, `unit_<n>` plus optional
 * preserved estimation metadata (`id_<n>`, `estimate_model_<n>`, `estimate_min_dkk_<n>`,
 * `estimate_max_dkk_<n>`); blank rows are skipped.
 */
export async function savePricingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { session, tenantId } = await clientScope();

  const catalog: PricingRowInput[] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < 40; i += 1) {
    const service = String(formData.get(`service_${i}`) ?? '').trim();
    if (!service) continue;

    const existingId = String(formData.get(`id_${i}`) ?? '').trim();
    const id = existingId && !usedIds.has(existingId) ? existingId : slugServiceId(service, usedIds, i);
    usedIds.add(id);

    const priceRaw = String(formData.get(`price_${i}`) ?? '').trim();
    const unit = String(formData.get(`unit_${i}`) ?? '').trim() || 'fixed';
    const price = Number(priceRaw);

    if (!Number.isFinite(price) || price < 0) {
      return {
        ok: false,
        field: `price_${i}`,
        error: `"${service}" needs a price of 0 or more.`,
      };
    }

    const row: PricingRowInput = {
      id,
      service,
      price_dkk: price,
      unit,
    };

    const modelRaw = String(formData.get(`estimate_model_${i}`) ?? '').trim();
    const minRaw = String(formData.get(`estimate_min_dkk_${i}`) ?? '').trim();
    const maxRaw = String(formData.get(`estimate_max_dkk_${i}`) ?? '').trim();
    if (modelRaw === 'fixed' || modelRaw === 'per_square_meter') {
      row.estimate_model = modelRaw;
    }
    if (minRaw !== '' && Number.isFinite(Number(minRaw)) && Number(minRaw) > 0) {
      row.estimate_min_dkk = Number(minRaw);
    }
    if (maxRaw !== '' && Number.isFinite(Number(maxRaw)) && Number(maxRaw) > 0) {
      row.estimate_max_dkk = Number(maxRaw);
    }

    catalog.push(row);
  }

  if (catalog.length === 0) {
    return { ok: false, error: 'Add at least one service before saving.' };
  }

  const affected = await updateTenantFacts(session.userId, tenantId, {
    pricingCatalog: catalog,
  });

  if (affected === 0) return { ok: false, error: 'Could not save the price list.' };

  revalidatePath('/portal/settings');
  revalidatePath('/portal');
  return { ok: true, message: `${catalog.length} services saved.` };
}
