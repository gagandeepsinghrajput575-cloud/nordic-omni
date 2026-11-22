import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type FeatureKey,
  ALL_FEATURES,
  DEFAULT_CLIENT_FEATURES,
  isFeatureEnabled,
  filterClientNavigation,
  isSenderEmailAllowed,
  parseEnabledFeatures,
} from '../src/lib/features/provisioning';

test('feature provisioning: parseEnabledFeatures normalizes raw data and handles fallbacks', () => {
  assert.deepEqual(parseEnabledFeatures(null), DEFAULT_CLIENT_FEATURES);
  assert.deepEqual(parseEnabledFeatures(undefined), DEFAULT_CLIENT_FEATURES);
  assert.deepEqual(parseEnabledFeatures([]), []);
  assert.deepEqual(
    parseEnabledFeatures(['antigravity', 'chatbot', 'invalid_unknown_feature']),
    ['antigravity', 'chatbot']
  );
});

test('feature provisioning: isFeatureEnabled respects master_opt_out as an immediate kill switch', () => {
  const tenant = {
    enabled_features: ['antigravity', 'chatbot', 'ai_caller'],
    master_opt_out: true,
  };

  assert.equal(isFeatureEnabled(tenant, 'antigravity'), false);
  assert.equal(isFeatureEnabled(tenant, 'chatbot'), false);
  assert.equal(isFeatureEnabled(tenant, 'ai_caller'), false);
  assert.equal(isFeatureEnabled(tenant, 'leads_crm'), false);
});

test('feature provisioning: isFeatureEnabled strictly gates on enabled_features list', () => {
  const tenant = {
    enabled_features: ['antigravity', 'chatbot'],
    master_opt_out: false,
  };

  assert.equal(isFeatureEnabled(tenant, 'antigravity'), true);
  assert.equal(isFeatureEnabled(tenant, 'chatbot'), true);
  assert.equal(isFeatureEnabled(tenant, 'ai_caller'), false);
  assert.equal(isFeatureEnabled(tenant, 'leads_crm'), false);
  assert.equal(isFeatureEnabled(tenant, 'meta_ads'), false);
  assert.equal(isFeatureEnabled(tenant, 'ai_seo'), false);
});

test('feature provisioning: filterClientNavigation hides disabled features completely from client navigation', () => {
  const allNavItems = [
    { href: '/portal', label: 'Overview', icon: 'dashboard' as const, featureKey: undefined },
    { href: '/portal/leads', label: 'Callers', icon: 'users' as const, featureKey: 'leads_crm' as FeatureKey },
    { href: '/portal/chat', label: 'Messages', icon: 'messages' as const, featureKey: 'chatbot' as FeatureKey },
    { href: '/portal/antigravity', label: 'Antigravity Agent', icon: 'bot' as const, featureKey: 'antigravity' as FeatureKey },
    { href: '/portal/settings', label: 'Settings', icon: 'settings' as const, featureKey: 'settings' as FeatureKey },
  ];

  // Case 1: Only antigravity and chatbot are enabled
  const minimalTenant = {
    enabled_features: ['antigravity', 'chatbot'],
    master_opt_out: false,
  };

  const filtered = filterClientNavigation(allNavItems, minimalTenant);
  const hrefs = filtered.map((item) => item.href);

  // Overview, Chat, and Antigravity are visible
  assert.ok(hrefs.includes('/portal'));
  assert.ok(hrefs.includes('/portal/chat'));
  assert.ok(hrefs.includes('/portal/antigravity'));

  // Callers (leads_crm) and Settings MUST NOT be in the navigation!
  assert.equal(hrefs.includes('/portal/leads'), false);
  assert.equal(hrefs.includes('/portal/settings'), false);

  // Case 2: Master opt-out is enabled -> Only base overview or empty
  const optedOutTenant = {
    enabled_features: ['antigravity', 'chatbot'],
    master_opt_out: true,
  };
  const optedOutFiltered = filterClientNavigation(allNavItems, optedOutTenant);
  assert.equal(optedOutFiltered.some(item => item.featureKey !== undefined), false);
});

test('feature provisioning: isSenderEmailAllowed enforces strict email whitelist', () => {
  const allowed = ['support@nordicroof.dk', 'quotes@nordicroof.dk'];

  assert.equal(isSenderEmailAllowed('quotes@nordicroof.dk', allowed), true);
  assert.equal(isSenderEmailAllowed('QUOTES@NORDICROOF.DK', allowed), true); // case-insensitive
  assert.equal(isSenderEmailAllowed('hacker@evil.com', allowed), false);
  assert.equal(isSenderEmailAllowed('random@nordicroof.dk', allowed), false);

  // When whitelist is empty, no sender is authorized by default
  assert.equal(isSenderEmailAllowed('quotes@nordicroof.dk', []), false);
  assert.equal(isSenderEmailAllowed('quotes@nordicroof.dk', null), false);
});
