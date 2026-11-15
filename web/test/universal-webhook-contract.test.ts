import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.DATABASE_ADMIN_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const route = read('src/app/api/v1/agency/webhook/route.ts');
const contract = read('src/lib/webhooks/inbound-contract.ts');
const dispatch = read('src/lib/webhooks/inbound-dispatch.ts');
const gatewayUi = read('src/components/agency/InboundGateway.tsx');
const migration = read('../db/migrations/0020_universal_inbound_gateway.sql');

// -----------------------------------------------------------------------------
// 1. Authentication gates
// -----------------------------------------------------------------------------

test('API keys are generated with 256 bits of entropy and stored only as a hash', async () => {
  const { generateApiKey, hashApiKey, looksLikeApiKey, keyPrefixOf } = await import(
    '../src/lib/webhooks/inbound-auth'
  );

  const generated = generateApiKey();
  assert.match(generated.key, /^omni_live_[A-Za-z0-9_-]{40,}$/, 'key must carry a recognisable prefix');
  assert.equal(generated.hash, hashApiKey(generated.key));
  assert.equal(generated.hash.length, 64, 'SHA-256 hex digest');
  assert.notEqual(generated.hash, generated.key, 'the stored value must not be the secret');
  assert.equal(generated.prefix, keyPrefixOf(generated.key));
  assert.equal(generated.prefix.length, 12);
  assert.ok(looksLikeApiKey(generated.key));

  // Distinct calls must never collide.
  const other = generateApiKey();
  assert.notEqual(other.key, generated.key);
  assert.notEqual(other.hash, generated.hash);
});

test('junk bearer values are rejected before any database lookup', async () => {
  const { looksLikeApiKey, readBearer } = await import('../src/lib/webhooks/inbound-auth');
  for (const bad of ['', 'omni_live_short', 'sk_live_' + 'a'.repeat(40), 'Bearer', 'x'.repeat(200)]) {
    assert.equal(looksLikeApiKey(bad), false, `${bad} must not look like a key`);
  }
  assert.equal(readBearer(null), null);
  assert.equal(readBearer('Basic abc'), null);
  assert.equal(readBearer('bearer  omni_live_abc '), 'omni_live_abc');
});

test('an invalid key is a 401 and never reveals whether it existed', async () => {
  const { safeEqualHex } = await import('../src/lib/webhooks/inbound-auth');
  // Same length, different content: must be false, and must not throw.
  assert.equal(safeEqualHex('a'.repeat(64), 'b'.repeat(64)), false);
  assert.equal(safeEqualHex('a'.repeat(64), 'a'.repeat(64)), true);
  // Mismatched length must be false rather than throwing inside timingSafeEqual.
  assert.equal(safeEqualHex('abc', 'a'.repeat(64)), false);

  assert.match(route, /failure\(401, 'unauthorized', 'Invalid or revoked API key\.'\)/);
  // The route must not distinguish "unknown prefix" from "wrong hash".
  assert.doesNotMatch(route, /Unknown key\.|No such key|key not found/i);
});

test('HMAC signatures outside the replay window are rejected, inside are accepted', async () => {
  const { computeSignature, verifyInboundSignature, REPLAY_WINDOW_SECONDS } = await import(
    '../src/lib/webhooks/inbound-auth'
  );
  const secret = 'k'.repeat(64);
  const body = JSON.stringify({ action: 'fetch_clients' });
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  const freshTimestamp = String(Math.floor(now / 1000));
  const freshSignature = computeSignature(freshTimestamp, body, secret);

  assert.deepEqual(
    verifyInboundSignature({ rawBody: body, signature: freshSignature, timestamp: freshTimestamp, secret, now }),
    { ok: true },
  );

  // One second inside the window still passes.
  const edge = String(Math.floor(now / 1000) - REPLAY_WINDOW_SECONDS + 1);
  assert.deepEqual(
    verifyInboundSignature({
      rawBody: body,
      signature: computeSignature(edge, body, secret),
      timestamp: edge,
      secret,
      now,
    }),
    { ok: true },
  );

  // Just outside it fails, and fails specifically as `stale`.
  const stale = String(Math.floor(now / 1000) - REPLAY_WINDOW_SECONDS - 1);
  assert.deepEqual(
    verifyInboundSignature({
      rawBody: body,
      signature: computeSignature(stale, body, secret),
      timestamp: stale,
      secret,
      now,
    }),
    { ok: false, reason: 'stale' },
  );

  // A future timestamp is equally unacceptable.
  const future = String(Math.floor(now / 1000) + REPLAY_WINDOW_SECONDS + 5);
  assert.deepEqual(
    verifyInboundSignature({
      rawBody: body,
      signature: computeSignature(future, body, secret),
      timestamp: future,
      secret,
      now,
    }),
    { ok: false, reason: 'stale' },
  );
});

test('a missing signature, a malformed timestamp and a tampered body all fail', async () => {
  const { computeSignature, verifyInboundSignature } = await import('../src/lib/webhooks/inbound-auth');
  const secret = 'k'.repeat(64);
  const body = '{"action":"fetch_metrics"}';
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const timestamp = String(Math.floor(now / 1000));

  assert.deepEqual(
    verifyInboundSignature({ rawBody: body, signature: null, timestamp, secret, now }),
    { ok: false, reason: 'missing' },
  );
  assert.deepEqual(
    verifyInboundSignature({ rawBody: body, signature: computeSignature(timestamp, body, secret), timestamp: null, secret, now }),
    { ok: false, reason: 'missing' },
  );
  assert.deepEqual(
    verifyInboundSignature({
      rawBody: body,
      signature: computeSignature(timestamp, body, secret),
      timestamp: 'not-a-timestamp',
      secret,
      now,
    }),
    { ok: false, reason: 'malformed' },
  );

  // Signed one body, sent another: the classic body-swap attack.
  const signed = computeSignature(timestamp, body, secret);
  assert.deepEqual(
    verifyInboundSignature({
      rawBody: '{"action":"send_sms"}',
      signature: signed,
      timestamp,
      secret,
      now,
    }),
    { ok: false, reason: 'mismatch' },
  );

  // A different secret must not verify.
  assert.deepEqual(
    verifyInboundSignature({
      rawBody: body,
      signature: computeSignature(timestamp, body, 'z'.repeat(64)),
      timestamp,
      secret,
      now,
    }),
    { ok: false, reason: 'mismatch' },
  );
});

test('the route requires a key id for HMAC and records a delivery receipt', () => {
  assert.match(route, /HMAC requests must send X-OMNI-Key-Id/);
  assert.match(route, /webhook_inbound_receipts/);
  assert.match(route, /on conflict \(delivery_id\) do nothing/);
  // A replay is a 409 and says so, rather than silently succeeding twice.
  assert.match(route, /failure\(409, 'replay'/);
  // Rate limiting runs before authentication, so a flood cannot exhaust the DB.
  // Measured inside POST, because the helper definitions sit above the handler.
  const post = route.slice(route.indexOf('export async function POST'));
  const limiterIndex = post.indexOf('limiter.allow');
  const authIndex = post.indexOf('await authenticateBearer');
  assert.ok(limiterIndex > 0, 'the handler must rate limit');
  assert.ok(authIndex > limiterIndex, 'rate limit must precede authentication');
  // And authentication precedes validation, so errors cannot be used to probe
  // which actions exist without a credential.
  const validateIndex = post.indexOf('InboundWebhookPayloadSchema.safeParse');
  assert.ok(validateIndex > authIndex, 'authentication must precede validation');
});

// -----------------------------------------------------------------------------
// 2. Action validation
// -----------------------------------------------------------------------------

const TENANT = '11111111-1111-4111-8111-111111111111';

test('every documented action has a schema and no unknown action validates', async () => {
  const { AGENCY_ACTIONS, InboundWebhookPayloadSchema } = await import('../src/lib/webhooks/inbound-contract');

  assert.equal(AGENCY_ACTIONS.length, 12);
  for (const action of AGENCY_ACTIONS) {
    // Minimum viable payload per action, so the union is proven routable.
    const minimal: Record<string, unknown> = { action, tenantId: TENANT };
    if (action === 'fetch_calendar_slots') minimal.date = '2026-01-15';
    if (action === 'create_lead') Object.assign(minimal, { name: 'A', phone: '+4527441802' });
    if (action === 'dispatch_call') Object.assign(minimal, { phone: '+4527441802' });
    if (action === 'send_sms') Object.assign(minimal, { to: '+4527441802', message: 'Hej' });
    if (action === 'book_appointment') Object.assign(minimal, {
      slotStart: '2026-01-15T09:00:00.000Z',
      slotEnd: '2026-01-15T09:30:00.000Z',
      customerName: 'A',
      customerPhone: '+4527441802',
    });
    if (action === 'ask_copilot') minimal.query = 'Hvor mange kunder?';

    const parsed = InboundWebhookPayloadSchema.safeParse(minimal);
    assert.equal(parsed.success, true, `${action} must accept a minimal valid payload`);
  }

  for (const bad of [
    { action: 'delete_everything' },
    { action: 'FETCH_LEADS' },
    { action: '' },
    {},
    null,
    [],
  ]) {
    assert.equal(InboundWebhookPayloadSchema.safeParse(bad).success, false, `${JSON.stringify(bad)} must not validate`);
  }
});

test('malformed payloads fail with a located, actionable message', async () => {
  const { InboundWebhookPayloadSchema, describeIssues } = await import('../src/lib/webhooks/inbound-contract');

  const cases: [string, Record<string, unknown>][] = [
    ['fetch_leads', { action: 'fetch_leads', limit: 0 }],
    ['fetch_leads', { action: 'fetch_leads', limit: 101 }],
    ['fetch_calls', { action: 'fetch_calls', limit: 51 }],
    ['fetch_client_detail', { action: 'fetch_client_detail', tenantId: 'not-a-uuid' }],
    ['fetch_calendar_slots', { action: 'fetch_calendar_slots', tenantId: TENANT, date: '15-01-2026' }],
    ['create_lead', { action: 'create_lead', tenantId: TENANT, name: '', phone: '+4527441802' }],
    ['create_lead', { action: 'create_lead', tenantId: TENANT, name: 'A', phone: '123' }],
    ['send_sms', { action: 'send_sms', tenantId: TENANT, to: '+4527441802', message: '' }],
    ['send_sms', { action: 'send_sms', tenantId: TENANT, to: '+4527441802', message: 'x'.repeat(481) }],
    ['ask_copilot', { action: 'ask_copilot', tenantId: TENANT, query: '' }],
  ];

  for (const [label, payload] of cases) {
    const parsed = InboundWebhookPayloadSchema.safeParse(payload);
    assert.equal(parsed.success, false, `${label} must reject ${JSON.stringify(payload)}`);
    if (!parsed.success) {
      const message = describeIssues(parsed.error.issues);
      assert.ok(message.length > 0, `${label} must produce a readable message`);
      assert.ok(message.length < 600, `${label} message must stay short`);
    }
  }
});

test('defaults are applied rather than left undefined', async () => {
  const { InboundWebhookPayloadSchema } = await import('../src/lib/webhooks/inbound-contract');

  // `parse` returns the union member, so narrow before reading a field.
  const leads = InboundWebhookPayloadSchema.parse({ action: 'fetch_leads' });
  assert.equal(leads.action, 'fetch_leads');
  assert.equal(leads.action === 'fetch_leads' && leads.limit, 50, 'fetch_leads defaults to 50');

  const calls = InboundWebhookPayloadSchema.parse({ action: 'fetch_calls' });
  assert.equal(calls.action === 'fetch_calls' && calls.limit, 20, 'fetch_calls defaults to 20');

  const lead = InboundWebhookPayloadSchema.parse({
    action: 'create_lead', tenantId: TENANT, name: 'A', phone: '+4527441802',
  });
  assert.equal(
    lead.action === 'create_lead' && lead.triggerSms,
    false,
    'triggerSms defaults to false, never true',
  );
});

test('update_client accepts a recursive record on Zod 4', async () => {
  // The spec's z.record(z.any()) no longer compiles; this guards the fix.
  const { InboundWebhookPayloadSchema } = await import('../src/lib/webhooks/inbound-contract');
  const parsed = InboundWebhookPayloadSchema.safeParse({
    action: 'update_client',
    tenantId: TENANT,
    businessHours: { mon: { open: '08:00', close: '16:30', closed: false } },
  });
  assert.equal(parsed.success, true);
  assert.match(contract, /z\.record\(z\.string\(\), z\.unknown\(\)\)/);
});

// -----------------------------------------------------------------------------
// 3. Dispatch routing — no action may fall through
// -----------------------------------------------------------------------------

test('the dispatcher handles every action and has an exhaustiveness guard', () => {
  const { AGENCY_ACTIONS } = { AGENCY_ACTIONS: [
    'fetch_leads', 'fetch_calls', 'fetch_clients', 'fetch_client_detail',
    'fetch_calendar_slots', 'fetch_metrics', 'create_lead', 'dispatch_call',
    'send_sms', 'book_appointment', 'update_client', 'ask_copilot',
  ] };

  for (const action of AGENCY_ACTIONS) {
    assert.match(dispatch, new RegExp(`case '${action}':`), `${action} must have a case`);
  }
  // A missing case must be a compile error, not a silent undefined.
  assert.match(dispatch, /const never: never = payload/);
});

test('reads go through RLS-scoped helpers; the owner connection is used only pre-identity', () => {
  // Every read/write helper names the acting user first.
  for (const call of [
    'listContacts(ctx.actingUserId',
    'listTenants(ctx.actingUserId',
    'getTenantFacts(ctx.actingUserId',
    'getTenantOverview(ctx.actingUserId',
    'listBusyIntervals(ctx.actingUserId',
    'withUser(ctx.actingUserId',
  ]) {
    assert.ok(dispatch.includes(call), `dispatch must scope ${call} through the acting user`);
  }

  // adminSql may appear only inside resolveActingUser's existence check.
  const adminUses = [...dispatch.matchAll(/adminSql`/g)].length;
  assert.equal(adminUses, 1, 'exactly one owner-connection statement is permitted');
  const identityStart = dispatch.indexOf('export async function resolveActingUser');
  const adminIndex = dispatch.indexOf('adminSql`');
  const identityEnd = dispatch.indexOf('/** Which tenants this credential may read');
  assert.ok(adminIndex > identityStart && adminIndex < identityEnd, 'and it must sit inside resolveActingUser');
});

test('a key pinned to one workspace cannot be widened by the payload', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/lib/webhooks/inbound-dispatch.ts', import.meta.url), 'utf8');
  // The conflict check must exist and must precede any tenant use.
  assert.match(source, /This API key is pinned to a different workspace\./);
  assert.ok(
    source.indexOf('keyTenantId && requestedTenantId && keyTenantId !== requestedTenantId') <
      source.indexOf('const tenantId = keyTenantId ?? requestedTenantId'),
    'the pin must be checked before the tenant is chosen',
  );
});

test('capabilities the platform does not have are reported, not faked', () => {
  // No outbound dial exists: the worker can only transfer an existing SIP participant.
  assert.match(dispatch, /dispatch: 'staged'/);
  assert.match(dispatch, /no outbound SIP dial/);
  assert.doesNotMatch(dispatch, /dispatch: 'connected'/);

  // No SMS carrier is configured: the response must say so.
  assert.match(dispatch, /delivery: 'simulated'/);
  assert.match(dispatch, /No SMS carrier is configured in this build/);
});

test('ask_copilot is grounded and never reaches an LLM', () => {
  // The grounded engine is the only path used by the inbound action.
  assert.match(dispatch, /buildCopilotContext\(/);
  assert.match(dispatch, /respondToClient\(/);
  assert.match(dispatch, /grounded: true/);
  // No provider/streaming call may appear in the gateway.
  assert.doesNotMatch(dispatch, /streamReceptionistReply|OpenAI|chat\.completions/);
});

test('dispatch_call validates that the workspace is actually active', () => {
  assert.match(dispatch, /if \(facts\.status !== 'active'\)/);
  assert.match(dispatch, /calls are not accepted/);
});

// -----------------------------------------------------------------------------
// 4. Vision AI bridge
// -----------------------------------------------------------------------------

test('Vision payloads satisfy the Vision contract schemas', async () => {
  const {
    AlarmSchema, TaskSchema, CallStatusSchema, ChatMessageSchema,
    toVisionAlarm, toVisionTask, toVisionCallStatus, toVisionChatMessage,
  } = await import('../src/lib/vision/bridge');

  const event = {
    id: 'evt-1',
    type: 'call.missed',
    tenantId: TENANT,
    createdAt: '2026-01-15T09:00:00.000Z',
    data: { phone: '+4527441802', callId: 'call-1', direction: 'inbound', durationSeconds: 0 },
  };

  const alarm = toVisionAlarm(event, { now: new Date('2026-01-15T09:00:05.000Z'), tenantName: 'Byg ApS' });
  assert.equal(AlarmSchema.safeParse(alarm).success, true);
  assert.equal(alarm.severity, 'critical', 'a missed call is critical');
  assert.equal(alarm.fireAt, '2026-01-15T09:00:05.000Z', 'alarms fire immediately');
  assert.match(alarm.title, /Mistet opkald/);
  assert.equal(alarm.metadata.omniEventId, 'evt-1');

  const task = toVisionTask(
    { ...event, type: 'lead.created', data: { name: 'Jens', estimatedValueDkk: 145_000 } },
    { now: new Date('2026-01-15T09:00:05.000Z'), tenantName: 'Byg ApS' },
  );
  assert.equal(TaskSchema.safeParse(task).success, true);
  assert.equal(task.priority, 'high', 'a 145 000 DKK lead is high priority');
  assert.equal(task.done, false);
  assert.ok(task.tags.includes('lead-created'));

  const call = toVisionCallStatus(event);
  assert.equal(CallStatusSchema.safeParse(call).success, true);
  assert.equal(call.status, 'missed');

  const chat = toVisionChatMessage({ id: 'm1', role: 'assistant', content: 'Der er 12 kunder.' });
  assert.equal(ChatMessageSchema.safeParse(chat).success, true);
});

test('only missed calls, urgent escalations and high-value leads reach Vision', async () => {
  const { routeEvent, ALARM_URGENCY_FLOOR, HIGH_VALUE_LEAD_DKK } = await import('../src/lib/vision/bridge');

  const base = { id: 'e', tenantId: TENANT, createdAt: '2026-01-15T09:00:00.000Z' };

  assert.equal(routeEvent({ ...base, type: 'call.missed', data: {} }), 'alarm');
  assert.equal(routeEvent({ ...base, type: 'call.completed', data: {} }), 'none');
  assert.equal(routeEvent({ ...base, type: 'call.started', data: {} }), 'none');

  assert.equal(routeEvent({ ...base, type: 'escalation.created', data: { urgency: ALARM_URGENCY_FLOOR } }), 'alarm');
  assert.equal(routeEvent({ ...base, type: 'escalation.created', data: { urgency: ALARM_URGENCY_FLOOR - 1 } }), 'task');

  assert.equal(routeEvent({ ...base, type: 'lead.created', data: { estimatedValueDkk: HIGH_VALUE_LEAD_DKK } }), 'task');
  assert.equal(routeEvent({ ...base, type: 'lead.created', data: { estimatedValueDkk: HIGH_VALUE_LEAD_DKK - 1 } }), 'none');

  // Unknown events are never routed: silence is better than noise.
  assert.equal(routeEvent({ ...base, type: 'webhook.test', data: {} }), 'none');
});

test('the bridge refuses to push when unconfigured and never claims success', async () => {
  const { pushEventToVision, visionConfigFromEnv, probeVision } = await import('../src/lib/vision/push');

  const event = { id: 'e1', type: 'call.missed', tenantId: TENANT, createdAt: new Date().toISOString(), data: {} };

  const unconfigured = await pushEventToVision(null, event);
  assert.equal(unconfigured.ok, false);
  assert.match(unconfigured.error, /not configured/);

  const below = await pushEventToVision(
    { baseUrl: 'https://vision.example.com', secret: 's'.repeat(32) },
    { ...event, type: 'call.completed' },
  );
  assert.equal(below.ok, false);
  assert.match(below.error, /below the Vision notification threshold/);

  // No env means no config, never a silent default endpoint.
  assert.equal(visionConfigFromEnv({}), null);
  assert.equal(visionConfigFromEnv({ VISION_AI_BASE_URL: 'https://v.example.com' }), null);
  const configured = visionConfigFromEnv({ VISION_AI_BASE_URL: 'https://v.example.com', VISION_AI_SECRET: 's'.repeat(32) });
  assert.equal(configured?.baseUrl, 'https://v.example.com');
  assert.equal(configured?.allowPrivate, false, 'private targets are opt-in only');

  const probe = await probeVision(null);
  assert.equal(probe.configured, false);
  assert.equal(probe.reachable, false);
});

// -----------------------------------------------------------------------------
// 5. Schema, UI and wiring
// -----------------------------------------------------------------------------

test('migration 0020 defines both tables with RLS and unique prefixes', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS webhook_api_keys/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS webhook_inbound_receipts/);
  // Prefixes must be unique or a lookup could return two candidate rows.
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS idx_webhook_api_keys_prefix/);
  assert.match(migration, /ALTER TABLE webhook_api_keys ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE webhook_inbound_receipts ENABLE ROW LEVEL SECURITY/);
  // Only the hash is stored, never the key.
  assert.match(migration, /key_hash\s+CHAR\(64\) NOT NULL/);
  assert.doesNotMatch(migration, /api_key\s+TEXT NOT NULL/i);
});

test('the hub exposes both surfaces and the console can execute a request', () => {
  assert.match(gatewayUi, /Outbound Streams/);
  assert.match(gatewayUi, /Universal Inbound & Vision Gateway/);
  assert.match(gatewayUi, /role="tabpanel"/);

  // The simulator must actually POST to the gateway.
  assert.match(gatewayUi, /method: 'POST'/);
  assert.match(gatewayUi, /Authorization: `Bearer \$\{keyInput\.trim\(\)\}`/);
  // And must show the raw response, not a summary.
  assert.match(gatewayUi, /response\.text\(\)/);
  // Mutating actions must be visibly flagged.
  assert.match(gatewayUi, /This action writes to the database/);
});

test('every action has a prefilled sample so the console is usable immediately', async () => {
  const { AGENCY_ACTIONS } = await import('../src/lib/webhooks/inbound-contract');
  for (const action of AGENCY_ACTIONS) {
    assert.ok(gatewayUi.includes(`${action}: {`), `${action} needs a sample payload`);
  }
});

test('the gateway never echoes the plaintext key back in a response body', () => {
  // The key is returned once from a server action, never from the API route.
  // Assert on the response builders, not on helper signatures that merely
  // describe a parameter named `key`.
  const responseBuilders = route
    .split('\n')
    .filter((line) => /NextResponse\.json|const body: GatewaySuccess/.test(line))
    .join('\n');
  assert.doesNotMatch(responseBuilders, /\bkey\s*:|apiKey\s*:/);
  // A delivery id is minted for every response, success or failure.
  assert.match(route, /deliveryId \?\? newDeliveryId\(\)/);
  assert.match(route, /const deliveryId = newDeliveryId\(\)/);
});

test('the success envelope carries ok, action, deliveryId and timestamp', async () => {
  const { InboundWebhookPayloadSchema } = await import('../src/lib/webhooks/inbound-contract');
  const parsed = InboundWebhookPayloadSchema.parse({ action: 'fetch_clients' });
  assert.equal(parsed.action, 'fetch_clients');

  assert.match(route, /const body: GatewaySuccess = \{/);
  for (const field of ['ok: true', 'action,', 'deliveryId', 'timestamp:', 'data: outcome.data']) {
    assert.ok(route.includes(field), `the envelope must include ${field}`);
  }
});

test('the GET probe documents the endpoint without exposing data', () => {
  assert.match(route, /export async function GET\(\)/);
  assert.match(route, /documentation probe/);
  // No authentication is needed to read the documentation, and it returns no rows.
  assert.doesNotMatch(route.slice(route.indexOf('export async function GET'), route.length), /adminSql|withUser/);
});
