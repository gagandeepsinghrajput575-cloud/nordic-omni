import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildParticipantIdentity,
  buildRoomName,
  FixedWindowRateLimiter,
  resolveLiveKitAccess,
} from '../web/src/lib/livekit/policy';

const root = path.resolve(import.meta.dirname, '..');

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';
const contactId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

const base = {
  tenantId,
  tenantStatus: 'active',
  contactId,
  contactTenantId: tenantId,
  requestedRole: 'customer' as const,
  session: null,
  isTenantOwner: false,
};

test('anonymous public links are customer-only and owner identity cannot elevate them', () => {
  const owner = resolveLiveKitAccess({ ...base, requestedRole: 'owner_consult' });
  assert.equal(owner.ok, false);
  if (!owner.ok) assert.equal(owner.status, 403);

  const customer = resolveLiveKitAccess(base);
  assert.deepEqual(customer, { ok: true, role: 'customer', contactId });
});

test('every actor requires an exact contact-to-tenant binding for customer calls', () => {
  const anonymous = resolveLiveKitAccess({ ...base, contactTenantId: otherTenantId });
  assert.equal(anonymous.ok, false);

  const signedIn = resolveLiveKitAccess({
    ...base,
    contactTenantId: otherTenantId,
    session: { isAgency: false, tenantIds: [tenantId] },
  });
  assert.equal(signedIn.ok, false);
});

test('tenant membership is mandatory and paused tenants cannot mint calls', () => {
  assert.equal(resolveLiveKitAccess({
    ...base,
    session: { isAgency: false, tenantIds: [otherTenantId] },
  }).ok, false);
  assert.equal(resolveLiveKitAccess({ ...base, tenantStatus: 'paused' }).ok, false);
});

test('owner agent requires agency or an explicit owner membership', () => {
  assert.equal(resolveLiveKitAccess({
    ...base,
    contactId: undefined,
    contactTenantId: undefined,
    requestedRole: 'owner_consult',
    session: { isAgency: false, tenantIds: [tenantId] },
    isTenantOwner: false,
  }).ok, false);
  assert.equal(resolveLiveKitAccess({
    ...base,
    contactId: undefined,
    contactTenantId: undefined,
    requestedRole: 'owner_consult',
    session: { isAgency: false, tenantIds: [tenantId] },
    isTenantOwner: true,
  }).ok, true);
});

test('room and identity are attempt-scoped rather than contact-scoped', () => {
  const first = buildRoomName('dansk-byg', contactId, 'attempt-1');
  const second = buildRoomName('dansk-byg', contactId, 'attempt-2');
  assert.notEqual(first, second);
  assert.match(first, /^dansk-byg_call_/);
  assert.notEqual(
    buildParticipantIdentity('customer', contactId, 'attempt-1'),
    buildParticipantIdentity('customer', contactId, 'attempt-2'),
  );
});

test('rate limiter fails closed after the configured request budget', () => {
  const limiter = new FixedWindowRateLimiter(2, 1000);
  assert.equal(limiter.allow('contact', 0), true);
  assert.equal(limiter.allow('contact', 1), true);
  assert.equal(limiter.allow('contact', 2), false);
  assert.equal(limiter.allow('contact', 1001), true);
});

test('token route pins the named agent instead of relying on default dispatch', () => {
  const route = readFileSync(
    path.join(root, 'web/src/app/api/livekit/token/route.ts'),
    'utf8'
  );
  assert.match(route, /RoomAgentDispatch/);
  assert.match(route, /agentName:\s*LIVEKIT_AGENT_NAME/);
  assert.match(route, /at\.roomConfig\s*=/);
});

test('worker uses the same named agent by default', () => {
  const worker = readFileSync(path.join(root, 'agent-worker/main.py'), 'utf8');
  assert.match(worker, /LIVEKIT_AGENT_NAME.*nordic-omni/);
  assert.match(worker, /agent_name=AGENT_NAME/);
});

