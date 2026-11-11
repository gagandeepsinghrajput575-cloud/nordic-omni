import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const queries = readFileSync(
  new URL('../web/src/lib/db/queries.ts', import.meta.url),
  'utf8',
);
const leadPage = readFileSync(
  new URL('../web/src/app/(client)/portal/leads/[id]/page.tsx', import.meta.url),
  'utf8',
);

test('the lead dashboard reads structured estimates and inspection requests', () => {
  assert.match(queries, /listProjectEstimates/);
  assert.match(queries, /listInspectionRequests/);
  assert.match(leadPage, /listProjectEstimates/);
  assert.match(leadPage, /listInspectionRequests/);
  assert.match(leadPage, /estimated_min_dkk/);
});
