import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEstimate, EstimateError, type CatalogItem } from '../src/lib/estimation';

function item(overrides: Record<string, unknown> = {}): CatalogItem {
  return {
    id: 'project',
    service: 'Nyt tag',
    price_dkk: 1900,
    unit: 'kr. pr. kvadratmeter (typisk 1.400 - 2.400 kr./m²)',
    estimate_model: 'per_square_meter',
    estimate_min_dkk: 1400,
    estimate_max_dkk: 2400,
    ...overrides,
  } as CatalogItem;
}

const rejects = (catalog: CatalogItem[], scope: unknown = 1) => {
  assert.throws(() => calculateEstimate(catalog, 'project', scope), EstimateError);
};

test('calculator agrees on Danish legacy numbers, scope, and half-up midpoints', () => {
  const fixed = item({ estimate_model: 'fixed', estimate_min_dkk: 1, estimate_max_dkk: 2 });
  const fixedResult = calculateEstimate([fixed], 'project', 8);
  assert.equal(fixedResult.squareMeters, null);
  assert.equal(fixedResult.midpoint, 2);

  const legacy = item({
    estimate_model: undefined,
    estimate_min_dkk: undefined,
    estimate_max_dkk: undefined,
    unit: 'typisk 1.400,50 - 2.400,25 kr. pr. kvadratmeter',
  });
  const result = calculateEstimate([legacy], 'project', 2);
  assert.equal(result.minimum, 2801);
  assert.equal(result.maximum, 4800.5);
  assert.equal(result.midpoint, 3801);
  assert.equal(result.squareMeters, 2);
});

test('all scope types fail closed without numeric coercion', () => {
  for (const invalid of [true, false, 0, -1, 100_001, '', '8', NaN, Infinity, -Infinity]) {
    rejects([item({ estimate_model: 'fixed' })], invalid);
  }
  assert.throws(() => calculateEstimate([item()], 'project', null), EstimateError);
});

test('structured prices and catalog shape agree with PricingItemSchema', () => {
  for (const field of ['price_dkk', 'estimate_min_dkk', 'estimate_max_dkk']) {
    for (const invalid of [true, false, '', '1400', NaN, Infinity, -Infinity, -1]) {
      rejects([item({ [field]: invalid })]);
    }
  }
  for (const invalid of [
    item({ service: 'x' }),
    item({ price_dkk: undefined }),
    item({ unit: '' }),
    item({ estimate_model: 'unsupported' }),
    item({ estimate_min_dkk: 2000, estimate_max_dkk: 1000 }),
    item({ estimate_model: 'fixed', estimate_max_dkk: undefined }),
  ]) {
    rejects([invalid]);
  }
  assert.throws(() => calculateEstimate([null as unknown as CatalogItem], 'project', 1), EstimateError);
});
