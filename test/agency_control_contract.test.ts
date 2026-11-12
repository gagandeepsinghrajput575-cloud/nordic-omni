import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { envelope, newWebhookSecret, retryDelay, signedHeaders, verifySignature, WEBHOOK_EVENTS } from '../web/src/lib/webhooks/protocol';
import { resolveLiveKitAccess } from '../web/src/lib/livekit/policy';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('webhooks sign timestamp and exact raw bytes with HMAC-SHA256', () => {
  const secret = newWebhookSecret();
  const body = JSON.stringify(envelope('lead.created', 'tenant-a', { name: 'Henrik' }));
  const headers = signedHeaders(body, secret, 'delivery-1', 1_700_000_000_123);
  const expected = createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex');
  assert.equal(headers['X-OMNI-Signature'], `sha256=${expected}`);
  assert.equal(headers['X-OMNI-Timestamp'], '1700000000');
  assert.equal(headers['X-OMNI-Delivery'], 'delivery-1');
  assert.equal(verifySignature(body, `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`, secret), true);
  assert.equal(verifySignature(body + ' ', headers['X-OMNI-Signature'], secret), false);
  assert.equal(verifySignature(body, headers['X-OMNI-Signature'], 'wrong'), false);
  assert.match(secret, /^[a-f0-9]{64}$/);
});

test('webhook retries are bounded and the outbox includes voice-worker events', () => {
  assert.equal(retryDelay(1), 30_000);
  assert.equal(retryDelay(2), 60_000);
  assert.equal(retryDelay(20), 3_600_000);
  assert.ok(WEBHOOK_EVENTS.includes('call.completed'));
  assert.ok(WEBHOOK_EVENTS.includes('escalation.resolved'));
  const sql = read('db/migrations/0012_agency_control_plane.sql');
  for (const table of ['contacts', 'call_logs', 'conversation_escalations']) assert.ok(sql.includes(`ON ${table}`));
  assert.match(sql, /e\.tenant_id IS NULL OR e\.tenant_id = p_tenant_id/);
  const dispatcher = read('web/src/lib/webhooks/dispatcher.ts');
  assert.match(dispatcher, /for update of d skip locked/);
  assert.match(dispatcher, /assertPublicUrl/);
  assert.match(dispatcher, /AbortSignal\.timeout/);
});

test('agency control writes use agency scope and RLS, never a client-supplied identity', () => {
  const actions = read('web/src/app/(agency)/agency/control-actions.ts');
  assert.ok(actions.includes("await agencyScope()"));
  assert.ok(!actions.includes('adminSql'));
  const db = read('web/src/lib/db/agency.ts');
  assert.ok(!db.includes('adminSql'));
  assert.match(db, /withUser\(userId/);
  const sql = read('db/migrations/0012_agency_control_plane.sql');
  for (const table of ['webhook_endpoints', 'webhook_events', 'webhook_deliveries']) {
    assert.ok(sql.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`CREATE POLICY ${table}_agency ON ${table}[\\s\\S]*?USING \\(is_agency\\(\\)\\) WITH CHECK \\(is_agency\\(\\)\\)`));
  }
  assert.match(sql, /IF NOT is_agency\(\) THEN RAISE EXCEPTION/);
  assert.match(sql, /DELETE FROM sessions WHERE user_id = v_user_id/);
  assert.match(db, /must_change_password = \(user_security\.must_change_password or \$\{action === 'reset'\}\)/);
  assert.match(db, /update users set password_hash = \$\{hash\} where id = \$\{memberId\}/);
  assert.ok(!db.includes('password_hash = ${hash}, is_active = true'));
  assert.match(db, /status = 'pending', attempts = 0/);
  const route = read('web/src/app/api/agency/webhooks/test/route.ts');
  assert.match(route, /apiRequireAgency/);
  assert.match(route, /status: 403/);
});

test('client sessions cannot enter agency paths and lifecycle gates every call channel', () => {
  const guard = read('web/src/lib/auth/guard.ts');
  assert.match(guard, /if \(!session\.isAgency\) redirect\('\/portal'\)/);
  assert.match(guard, /mustChangePassword/);
  const layout = read('web/src/app/(agency)/agency/layout.tsx');
  assert.match(layout, /await requireAgency\(\)/);
  const worker = read('agent-worker/main.py');
  assert.match(worker, /tenant\.get\("status"\).*!= "active"/);
  assert.match(worker, /reception_mode.*human_forward/);
  assert.match(worker, /forward_sip_call/);
  const chat = read('web/src/app/api/chat/[contactId]/route.ts');
  assert.match(chat, /reception_mode === 'human_forward'/);
  assert.equal(resolveLiveKitAccess({ tenantId: 't', tenantStatus: 'suspended', requestedRole: 'customer', session: null, isTenantOwner: false }).ok, false);
});

test('warm palette reaches orb tokens and motion has a reduced-motion fallback', () => {
  const css = read('web/src/app/globals.css');
  for (const color of ['#FAF7F2', '#F4EFEA', '#ECE5DC', '#1C1512', '#2A201C', '#7C3AED', '#9333EA']) assert.ok(css.includes(color));
  assert.match(css, /--ease: cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  for (const token of ['--accent-primary', '--accent-secondary', '--danger', '--warning', '--text-muted', '--line']) assert.ok(css.includes(token));
  const orb = read('web/src/components/audio/OrbVisualizer.tsx');
  assert.match(orb, /getPropertyValue\('--accent-primary'\).*'#7C3AED'/);
  assert.match(orb, /prefers-reduced-motion/);
});

test('saved server facts reconcile into agency editors without stale drafts', () => {
  const controls = read('web/src/components/agency/WorkspaceControls.tsx');
  assert.match(controls, /value=\{draft\.status\}/);
  assert.match(controls, /value=\{draft\.receptionMode\}/);
  assert.match(controls, /value=\{draft\.did\}/);
  assert.match(controls, /disabled=\{pending\}/);
  assert.match(controls, /setDraft\(\{ status: status === 'archived'/);
  const facts = read('web/src/components/agency/WorkspaceFactsEditor.tsx');
  assert.match(facts, /key=\{JSON\.stringify\(hours\)\}/);
});
