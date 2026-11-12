import type { z } from 'zod';
import { PricingItemSchema } from '@/contracts/schemas';

/** Catalog-grounded estimates. The model may choose the item, never the amount. */
export type CatalogItem = z.infer<typeof PricingItemSchema>;

export interface Estimate {
  catalogItemId: string;
  service: string;
  minimum: number;
  maximum: number;
  midpoint: number;
  squareMeters: number | null;
}

export class EstimateError extends Error {}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function legacyNumber(token: string): number | null {
  const value = Number(token.replaceAll('.', '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const LEGACY_NUMBER = String.raw`(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?`;
const LEGACY_BRACKET = new RegExp(
  String.raw`typisk\s+(${LEGACY_NUMBER})\s*-\s*(${LEGACY_NUMBER})`,
  'i',
);

function legacyBracket(unit: string): [number, number] | null {
  const match = LEGACY_BRACKET.exec(unit);
  if (!match) return null;
  const low = legacyNumber(match[1]);
  const high = legacyNumber(match[2]);
  return low !== null && high !== null && low <= high ? [low, high] : null;
}

export function calculateEstimate(
  catalog: readonly CatalogItem[],
  catalogItemId: string,
  squareMeters: unknown,
): Estimate {
  const candidate = catalog.find((entry) => entry?.id === catalogItemId);
  const parsed = PricingItemSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new EstimateError('This project type is not configured for a valid estimate.');
  }
  const item = parsed.data;

  let low = positiveNumber(item.estimate_min_dkk);
  let high = positiveNumber(item.estimate_max_dkk);
  if (low === null || high === null) {
    const legacy = legacyBracket(item.unit);
    if (legacy) [low, high] = legacy;
  }
  if (low === null || high === null) {
    throw new EstimateError('No valid estimate bracket is configured for this project.');
  }

  const model = item.estimate_model ??
    (/kvadratmeter|m²/i.test(item.unit) ? 'per_square_meter' : 'fixed');

  let scope: number | null = null;
  if (squareMeters !== null && squareMeters !== undefined) {
    scope = positiveNumber(squareMeters);
    if (scope === null || scope > 100_000) {
      throw new EstimateError('Square meters must be a positive, realistic number.');
    }
  }

  if (model === 'per_square_meter') {
    if (scope === null) throw new EstimateError('Square meters are required for this estimate.');
    low *= scope;
    high *= scope;
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      throw new EstimateError('The estimate exceeds the supported numeric range.');
    }
  } else {
    // Scope can be useful dialogue context, but is not part of a fixed price.
    scope = null;
  }

  return {
    catalogItemId,
    service: item.service,
    minimum: low,
    maximum: high,
    midpoint: Math.round((low + high) / 2),
    squareMeters: scope,
  };
}
