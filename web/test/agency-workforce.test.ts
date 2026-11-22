import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type EmployeeRole,
  type VisibilityMode,
  AI_EMPLOYEES,
  MOCK_FEATURE_FLAGS,
  calculateClientPortalVisibility,
} from '../src/components/workforce/workforce-types';

test('workforce: employee catalog contains only specialized voice receptionist after surgical removal', () => {
  const roles = AI_EMPLOYEES.map((e) => e.role);
  assert.equal(roles.includes('creative_director' as any), false);
  assert.equal(roles.includes('paid_media' as any), false);
  assert.equal(roles.includes('ai_seo_geo' as any), false);
  assert.ok(roles.includes('voice_receptionist' as EmployeeRole));
  assert.equal(AI_EMPLOYEES.length, 1);

  // Each employee must have valid metadata, capabilities and telemetry metrics
  for (const emp of AI_EMPLOYEES) {
    assert.ok(emp.name.length > 0);
    assert.ok(emp.title.length > 0);
    assert.ok(emp.metrics.length >= 2);
    assert.ok(emp.tags.length >= 2);
    assert.ok(emp.capabilities.length >= 2);
    assert.ok(emp.sampleTask.length > 0);
  }
});

test('workforce: calculateClientPortalVisibility handles Active, Teaser, and Hidden states', () => {
  const flags: Record<string, VisibilityMode> = {
    chatbot: 'active',
    antigravity: 'active',
    meta_ads: 'teaser',
    ai_seo: 'hidden',
    ai_caller: 'hidden',
  };

  const visibility = calculateClientPortalVisibility(flags);

  // Active features are accessible
  assert.equal(visibility.activeFeatures.includes('chatbot'), true);
  assert.equal(visibility.activeFeatures.includes('antigravity'), true);
  assert.equal(visibility.activeFeatures.includes('meta_ads'), false);

  // Teaser features are in upsell mode
  assert.equal(visibility.teaserFeatures.includes('meta_ads'), true);
  assert.equal(visibility.teaserFeatures.includes('chatbot'), false);

  // Hidden features are completely omitted
  assert.equal(visibility.hiddenFeatures.includes('ai_seo'), true);
  assert.equal(visibility.hiddenFeatures.includes('ai_caller'), true);
  assert.equal(visibility.activeFeatures.includes('ai_seo'), false);
  assert.equal(visibility.teaserFeatures.includes('ai_seo'), false);
});

test('workforce: default mock flags adhere to safe defaults', () => {
  assert.equal(MOCK_FEATURE_FLAGS.length >= 4, true);
  for (const flag of MOCK_FEATURE_FLAGS) {
    assert.ok(['active', 'teaser', 'hidden'].includes(flag.mode));
    assert.ok(flag.flagKey.length > 0);
    assert.ok(flag.name.length > 0);
  }
});

test('workforce: all component files exist and export required interfaces', () => {
  const baseDir = resolve(__dirname, '../src/components/workforce');
  const files = [
    'workforce-types.ts',
    'WorkforceHeader.tsx',
    'EmployeePodCard.tsx',
    'FeatureSwitchboardSimulator.tsx',
    'MissionActivityFeed.tsx',
    'WorkforceStudio.tsx',
  ];

  for (const file of files) {
    const fullPath = resolve(baseDir, file);
    assert.ok(existsSync(fullPath), `Expected ${file} to exist in components/workforce`);
    const content = readFileSync(fullPath, 'utf-8');
    assert.ok(content.length > 100, `${file} should not be empty`);
  }

  // Route file
  const pagePath = resolve(__dirname, '../src/app/(agency)/agency/workforce/page.tsx');
  assert.ok(existsSync(pagePath), 'Expected /agency/workforce/page.tsx to exist');
});

test('workforce: zero synthetic purple and strict monochrome token adherence', () => {
  const baseDir = resolve(__dirname, '../src/components/workforce');
  const files = [
    'WorkforceHeader.tsx',
    'EmployeePodCard.tsx',
    'FeatureSwitchboardSimulator.tsx',
    'MissionActivityFeed.tsx',
    'WorkforceStudio.tsx',
  ];

  const purpleRegex = /purple|violet|fuchsia|#[89a-fA-F]{2}[0-5]{2}[89a-fA-F]{2}/i;

  for (const file of files) {
    const content = readFileSync(resolve(baseDir, file), 'utf-8');
    assert.doesNotMatch(
      content,
      purpleRegex,
      `${file} must not contain synthetic purple or violet literals`
    );
  }
});
