import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InspectionRequestSchema,
  PricingItemSchema,
  ProjectEstimateSchema,
  TranscriptTurnSchema,
  UICommandTypeSchema,
} from '../src/contracts/schemas';

const ids = {
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  contact_id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
  call_log_id: 'cccccccc-cccc-4ccc-accc-cccccccccccc',
};

test('Danish migration catalog and worker estimation fields survive Zod parsing', () => {
  const parsed = PricingItemSchema.parse({
    id: 'proj-roof',
    service: 'Nyt Tag',
    price_dkk: 1800,
    unit: 'kr. pr. kvadratmeter (typisk 1.400 - 2.400 kr./m²)',
    estimate_model: 'per_square_meter',
    estimate_min_dkk: 1400,
    estimate_max_dkk: 2400,
  });
  assert.equal(parsed.estimate_model, 'per_square_meter');
  assert.equal(parsed.estimate_min_dkk, 1400);
  assert.equal(parsed.estimate_max_dkk, 2400);

  for (const invalid of [true, '', '1400', NaN, Infinity, -Infinity, 0, -1]) {
    assert.equal(PricingItemSchema.safeParse({
      id: 'bad', service: 'Bad input', price_dkk: 1, unit: 'fixed',
      estimate_model: 'fixed', estimate_min_dkk: invalid, estimate_max_dkk: 20,
    }).success, false);
  }

  assert.equal(PricingItemSchema.safeParse({
    id: 'bad', service: 'Bad bracket', price_dkk: 1, unit: 'fixed',
    estimate_model: 'fixed', estimate_min_dkk: 20, estimate_max_dkk: 10,
  }).success, false);
});

test('estimate and inspection schemas match migration 0007 columns and invariants', () => {
  const estimate = ProjectEstimateSchema.parse({
    ...ids,
    project_type: 'Tagarbejde',
    scope_details: '120 kvadratmeter',
    square_meters: 120,
    estimated_min_dkk: 168000,
    estimated_max_dkk: 288000,
    estimated_value_dkk: 228000,
    followup_notes: '',
    created_at: new Date().toISOString(),
  });
  assert.equal(estimate.square_meters, 120);
  assert.equal(ProjectEstimateSchema.safeParse({
    ...ids,
    project_type: 'Tagarbejde', scope_details: 'for stort', square_meters: 100_001,
    estimated_min_dkk: 1, estimated_max_dkk: 2, estimated_value_dkk: 2,
    followup_notes: '', created_at: new Date().toISOString(),
  }).success, false);

  const inspection = InspectionRequestSchema.parse({
    ...ids,
    requested_time_text: 'tirsdag formiddag',
    address: 'Lyngby',
    notes: '',
    status: 'requested',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  assert.equal(inspection.status, 'requested');
});

test('worker transcript and estimate UI events match web contracts', () => {
  assert.deepEqual(
    TranscriptTurnSchema.parse({ role: 'assistant', content: 'Goddag' }),
    { role: 'assistant', content: 'Goddag' },
  );
  assert.equal(UICommandTypeSchema.parse('PROJECT_ESTIMATE_RECORDED'), 'PROJECT_ESTIMATE_RECORDED');
  assert.equal(UICommandTypeSchema.parse('INSPECTION_REQUESTED'), 'INSPECTION_REQUESTED');
});

test('web source contains no loose any casts or suppressions', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  walk(root);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\bas\s+any\b|@ts-ignore|@ts-expect-error/, file);
  }
});
