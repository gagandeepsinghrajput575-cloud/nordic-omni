/** Catalog-grounded estimates. The model may choose the item, never the amount. */

export interface CatalogItem {
  id: string;
  service: string;
  price_dkk?: number;
  unit?: string;
  estimate_model?: 'fixed' | 'per_square_meter' | string;
  estimate_min_dkk?: number;
  estimate_max_dkk?: number;
}

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
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function legacyBracket(unit: string): [number, number] | null {
  const match = /typisk\s+([\d.]+)(?:,\d+)?\s*-\s*([\d.]+)(?:,\d+)?/i.exec(unit);
  if (!match) return null;
  const low = positiveNumber(match[1].replaceAll('.', ''));
  const high = positiveNumber(match[2].replaceAll('.', ''));
  return low !== null && high !== null ? [low, high] : null;
}

export function calculateEstimate(
  catalog: CatalogItem[],
  catalogItemId: string,
  squareMeters: number | null,
): Estimate {
  const item = catalog.find((entry) => entry.id === catalogItemId);
  if (!item) throw new EstimateError('This project type is not configured for an estimate.');

  const unit = String(item.unit || '');
  let low = positiveNumber(item.estimate_min_dkk);
  let high = positiveNumber(item.estimate_max_dkk);
  if (low === null || high === null) {
    const legacy = legacyBracket(unit);
    if (legacy) [low, high] = legacy;
  }
  if (low === null || high === null || low > high) {
    throw new EstimateError('No valid estimate bracket is configured for this project.');
  }

  let model = String(item.estimate_model || '').trim();
  if (!model) {
    model = /kvadratmeter|m²/i.test(unit) ? 'per_square_meter' : 'fixed';
  }

  let scope: number | null = null;
  if (squareMeters !== null) {
    scope = positiveNumber(squareMeters);
    if (scope === null || scope > 100_000) {
      throw new EstimateError('Square meters must be a positive, realistic number.');
    }
  }

  if (model === 'per_square_meter') {
    if (scope === null) throw new EstimateError('Square meters are required for this estimate.');
    low *= scope;
    high *= scope;
  } else if (model !== 'fixed') {
    throw new EstimateError('The catalog has an unsupported estimation model.');
  }

  return {
    catalogItemId,
    service: item.service || catalogItemId,
    minimum: low,
    maximum: high,
    midpoint: Math.round((low + high) / 2),
    squareMeters: scope,
  };
}
