import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AgencyClientMessageSchema,
  ChatStateSchema,
  CopilotDelegationRequestSchema,
  CopilotDelegationSchema,
  CopilotReplySchema,
  PostChatMessageSchema,
  SenderRoleSchema,
  StagedMutationSchema,
} from '../src/contracts/schemas';
import {
  buildDelegationQuestion,
  classifyIntent,
  formatCount,
  formatDkk,
  respondToClient,
  stagePricingMutation,
  summariseDelegationAnswer,
  ungroundedReply,
  type CopilotContext,
} from '../src/lib/copilot/engine';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';

function context(overrides: Partial<CopilotContext> = {}): CopilotContext {
  return {
    tenantId: TENANT,
    tenantName: 'Murermester Åse Østergaard ApS',
    ownerName: 'Åse Østergaard',
    language: 'da-DK',
    metrics: {
      contacts: 42,
      calls: 137,
      booked: 9,
      messages: 512,
      pipelineDkk: 184_000,
      openEscalations: 2,
    },
    catalog: [
      { id: 'srv-1', service: 'Tagrens', price_dkk: 2500, unit: 'per opgave' },
      { id: 'srv-2', service: 'Facaderens', price_dkk: 4200, unit: 'per opgave' },
    ],
    businessHours: {
      monday: { open: '07:00', close: '16:00', closed: false },
      tuesday: { open: '07:00', close: '16:00', closed: false },
      sunday: { open: '00:00', close: '00:00', closed: true },
    },
    ownerPhone: '+4527441802',
    ownerEmail: 'ase@murermester.dk',
    activeBroadcast: null,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// 1. Actor role validation
// -----------------------------------------------------------------------------

test('sender_role is a closed enum and rejects any other actor', () => {
  assert.deepEqual(SenderRoleSchema.options, ['agency_operator', 'client', 'ai_copilot']);

  for (const valid of SenderRoleSchema.options) {
    assert.equal(SenderRoleSchema.parse(valid), valid);
  }
  for (const invalid of [
    'operator', 'agency', 'admin', 'system', 'AI_COPILOT', 'ai-copilot',
    'agency operator', '', 'client ', 'owner',
  ]) {
    assert.equal(SenderRoleSchema.safeParse(invalid).success, false, invalid);
  }
});

test('a message row requires a real uuid and a non-empty body', () => {
  const base = {
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: TENANT,
    senderRole: 'client',
    senderRef: null,
    channel: 'web_chat',
    kind: 'message',
    body: 'Hej, hvad koster en tagrens?',
    delegationId: null,
    metadata: {},
    createdAt: new Date().toISOString(),
  };

  assert.equal(AgencyClientMessageSchema.safeParse(base).success, true);

  // Not a uuid.
  assert.equal(
    AgencyClientMessageSchema.safeParse({ ...base, id: 'not-a-uuid' }).success,
    false,
  );
  // Empty and whitespace-only bodies carry no meaning.
  assert.equal(AgencyClientMessageSchema.safeParse({ ...base, body: '' }).success, false);
  assert.equal(AgencyClientMessageSchema.safeParse({ ...base, body: '   ' }).success, false);
  // Unknown keys are refused rather than silently dropped.
  assert.equal(
    AgencyClientMessageSchema.safeParse({ ...base, injected: 'x' }).success,
    false,
  );
  // An unknown role is refused.
  assert.equal(
    AgencyClientMessageSchema.safeParse({ ...base, senderRole: 'admin' }).success,
    false,
  );
});

test('the posted-message contract has no role field, so a client cannot claim one', () => {
  const parsed = PostChatMessageSchema.parse({ body: 'Hej' });
  assert.equal('senderRole' in parsed, false);
  assert.equal('sender_role' in parsed, false);

  // Even if a caller supplies one, it is stripped by .strict() rejection — the
  // route stamps the role from the session instead.
  assert.equal(
    PostChatMessageSchema.safeParse({ body: 'Hej', senderRole: 'agency_operator' }).success,
    false,
  );
});

test('routes stamp the role from the session and never read it from the body', () => {
  const agency = source('../src/app/api/agency/clients/[id]/chat/route.ts');
  // The literal is the source of truth for an agency post.
  assert.match(agency, /const senderRole: SenderRole = 'agency_operator'/);
  assert.match(agency, /senderRef: session\.userId/);
  // The co-pilot is always attributed with a null ref.
  assert.match(agency, /senderRole: 'ai_copilot',\s*\n\s*senderRef: null/);

  const portal = source('../src/app/api/portal/chat/route.ts');
  assert.match(portal, /senderRole: 'client'/);

  // Neither route may derive a role from the request body.
  for (const [name, body] of [
    ['agency', agency],
    ['portal', portal],
  ] as const) {
    assert.doesNotMatch(body, /senderRole:\s*(body|payload)\./, name);
  }
});

// -----------------------------------------------------------------------------
// 2. RLS tenant isolation
// -----------------------------------------------------------------------------

test('every chat table carries tenant RLS with the active-user guard', () => {
  const migration = source('../../db/migrations/0019_agency_client_chat.sql');

  for (const table of [
    'agency_client_messages',
    'copilot_delegations',
    'copilot_mutations',
    'agency_client_chat_state',
  ]) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE ${table}\\s+ENABLE ROW LEVEL SECURITY`),
      table,
    );
  }

  // Every policy scopes to the tenant and refuses deactivated users.
  const policies = migration.match(/CREATE POLICY [\s\S]*?;/g) ?? [];
  assert.ok(policies.length >= 10, `expected at least 10 policies, got ${policies.length}`);
  for (const policy of policies) {
    assert.match(policy, /is_agency\(\) OR public\.is_tenant_owner\(tenant_id\)/, policy);
    assert.match(policy, /u\.id = public\.app_user_id\(\) AND u\.is_active/, policy);
  }

  // No policy may be permissive without a tenant predicate.
  assert.doesNotMatch(migration, /FOR SELECT USING \(true\)/);
  assert.doesNotMatch(migration, /USING \(true\)/);
});

test('chat persistence never bypasses RLS through the owner pool', () => {
  const chat = source('../src/lib/db/client-chat.ts');
  // The owner-pool importer allowlist in rls-contract.test.ts is exact; a chat
  // read has no business appearing in it.
  assert.doesNotMatch(chat, /adminSql/);
  assert.match(chat, /import \{ withUser \} from '@\/lib\/db\/client'/);

  // Every exported reader/writer is scoped by withUser.
  const exported = chat.match(/export async function \w+/g) ?? [];
  assert.ok(exported.length >= 8, `expected the full surface, got ${exported.length}`);
  const withUserCalls = chat.match(/return withUser\(/g) ?? [];
  assert.equal(withUserCalls.length, exported.length, 'every function must run inside withUser');

  // The client-facing route gates on tenant membership, not on a body field.
  const portal = source('../src/app/api/portal/chat/route.ts');
  assert.match(portal, /apiRequireTenant\(/);
  const agency = source('../src/app/api/agency/clients/[id]/chat/route.ts');
  assert.match(agency, /apiRequireAgency\(\)/);
});

test('a portal session cannot read another tenant because the id comes from the session', () => {
  const portal = source('../src/app/api/portal/chat/route.ts');
  // The requested tenant is validated against membership before use...
  assert.match(portal, /await apiRequireTenant\(requested\)/);
  // ...and falls back to the session's own workspace, never an arbitrary id.
  assert.match(portal, /const tenantId = requested \|\| session\.tenantIds\[0\]/);

  // The client page pins the tenant from the session too.
  const page = source('../src/app/(client)/portal/chat/page.tsx');
  assert.match(page, /const tenantId = session\.tenantIds\[0\]/);
  assert.doesNotMatch(page, /params|searchParams/);
});

test('messages are append-only and tenant_id is immutable', () => {
  const migration = source('../../db/migrations/0019_agency_client_chat.sql');
  assert.match(migration, /FUNCTION guard_chat_message_immutable/);
  assert.match(migration, /RAISE EXCEPTION 'chat messages are append-only'/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON agency_client_messages/);
  // No UPDATE grant: the table cannot be rewritten even if the trigger were lost.
  assert.match(migration, /GRANT SELECT, INSERT ON public\.agency_client_messages TO omni_app/);
  assert.doesNotMatch(migration, /GRANT[^;]*UPDATE[^;]*ON public\.agency_client_messages/);
});

test('the migration blocks a non-agency session from claiming an agency role', () => {
  const migration = source('../../db/migrations/0019_agency_client_chat.sql');
  assert.match(migration, /FUNCTION guard_chat_sender_role/);
  assert.match(migration, /NEW\.sender_role IN \('agency_operator', 'ai_copilot'\) AND NOT public\.is_agency\(\)/);
  // The co-pilot is a system actor and must never be attributed to a person.
  assert.match(migration, /sender_role <> 'ai_copilot' OR sender_ref IS NULL/);
  // Delegations move forward only.
  assert.match(migration, /FUNCTION guard_delegation_transition/);
  assert.match(migration, /a closed delegation cannot be reopened/);
});

// -----------------------------------------------------------------------------
// 3. Grounding: never invent, never promise
// -----------------------------------------------------------------------------

test('ungrounded questions route to verification rather than a guess', () => {
  const ctx = context();

  const questions = [
    'Dækker I også Roskilde?',
    'Hvor lang tid tager en tagrens?',
    'Kan I garantere at taget holder i 20 år?',
    'Giver I rabat ved to opgaver?',
    'Hvordan fungerer jeres forsikring?',
    'Do you cover Roskilde?',
  ];

  for (const question of questions) {
    const reply = respondToClient(ctx, question);
    assert.equal(reply.intent, 'ungrounded', question);
    assert.equal(reply.needsAgencyInput, true, question);
    assert.equal(reply.mutation, null, question);
    // The Danish copy must promise to check, not assert a fact.
    assert.match(reply.body, /ikke svare på med sikkerhed/);
    assert.match(reply.body, /sendt spørgsmålet videre/);
    assert.match(reply.body, /vender tilbage/);
    // It must name the owner who will follow up.
    assert.match(reply.body, /Åse Østergaard/);
  }
});

test('a commitment question wins over a matching price keyword', () => {
  // "Hvad koster det at få garanti?" mentions price but asks for a guarantee.
  assert.equal(classifyIntent('Hvad koster det at få garanti?'), 'ungrounded');
  assert.equal(classifyIntent('Koster I det samme i Roskilde?'), 'ungrounded');
  // A plain price question stays answerable from the catalog.
  assert.equal(classifyIntent('Hvad koster en tagrens?'), 'pricing');
});

test('an empty catalog produces an admission, not a zero price', () => {
  const reply = respondToClient(context({ catalog: [] }), 'Hvad koster en tagrens?');
  assert.equal(reply.intent, 'pricing');
  // No price is fabricated anywhere in the body.
  assert.doesNotMatch(reply.body, /\d+\s*kr\./);
  assert.match(reply.body, /ingen priser|opfinde en pris/i);
  assert.match(reply.body, /Åse Østergaard/);
});

test('an unreadable metrics source is reported as unknown, never as zero', () => {
  const ctx = context({
    metrics: {
      contacts: null,
      calls: null,
      booked: null,
      messages: null,
      pipelineDkk: null,
      openEscalations: null,
    },
  });
  const reply = respondToClient(ctx, 'Hvor mange opkald har vi haft?');
  assert.equal(reply.intent, 'metrics');
  assert.match(reply.body, /kan ikke læse statistikken/);
  // Crucially, it must not claim "0 opkald".
  assert.doesNotMatch(reply.body, /\b0\b/);
});

test('grounded metrics are rendered from the injected numbers in Danish', () => {
  const reply = respondToClient(context(), 'Hvor mange kunder har vi?');
  assert.equal(reply.intent, 'metrics');
  assert.equal(reply.needsAgencyInput, false);
  // 42 contacts, 9 booked, 137 calls, 512 messages.
  assert.match(reply.body, /42/);
  assert.match(reply.body, /137/);
  assert.match(reply.body, /512/);
  // Two open escalations are called out.
  assert.match(reply.body, /2 åbne sager/);
});

test('every factual reply is derived only from the injected context', () => {
  // A tenant with no owner phone/email must not produce invented contact details.
  const ctx = context({ ownerPhone: null, ownerEmail: null, businessHours: null });
  const reply = respondToClient(ctx, 'Hvornår har I åbent?');
  assert.equal(reply.intent, 'settings');
  assert.match(reply.body, /ingen åbningstider registreret/);
  assert.match(reply.body, /ingen kontaktoplysninger registreret/);
  assert.doesNotMatch(reply.body, /\+45/);
});

test('the engine is pure: it imports no I/O and performs no writes', () => {
  const engine = source('../src/lib/copilot/engine.ts');
  // No database, no session, no network.
  assert.doesNotMatch(engine, /@\/lib\/db/);
  assert.doesNotMatch(engine, /await |fetch\(|process\.env/);
  assert.doesNotMatch(engine, /insert |update |delete /i);
  // Context arrives by injection.
  assert.match(engine, /export interface CopilotContext/);
});

// -----------------------------------------------------------------------------
// 4. Staged mutations (approval required)
// -----------------------------------------------------------------------------

test('a pricing change is staged with a reviewable diff and never applied', () => {
  const ctx = context();
  const { mutation, unknownIds } = stagePricingMutation(ctx, { 'srv-1': 2800 });

  assert.ok(mutation);
  assert.equal(mutation.kind, 'pricing');
  assert.equal(mutation.requiresApproval, true);
  assert.deepEqual(mutation.diff, [
    { field: 'pris.Tagrens', before: '2.500 kr.', after: '2.800 kr.' },
  ]);
  assert.equal(unknownIds.length, 0);

  // The contract enforces requiresApproval: true — it cannot be constructed false.
  assert.equal(
    StagedMutationSchema.safeParse({ ...mutation, requiresApproval: false }).success,
    false,
  );
});

test('staging ignores unknown catalog ids instead of inventing a service', () => {
  const { mutation, unknownIds } = stagePricingMutation(context(), { 'srv-404': 999 });
  assert.equal(mutation, null);
  assert.deepEqual(unknownIds, ['srv-404']);
});

test('a no-op price change stages nothing at all', () => {
  const { mutation } = stagePricingMutation(context(), { 'srv-1': 2500 });
  assert.equal(mutation, null);
});

test('the co-pilot explicitly refuses to apply a price change without approval', () => {
  const reply = respondToClient(context(), 'Sæt prisen for tagrens op til 2800', {
    stagedPricing: { 'srv-1': 2800 },
  });
  assert.ok(reply.mutation);
  assert.match(reply.body, /til godkendelse/);
  assert.match(reply.body, /ændrer først priserne, når der er givet grønt lys/);
  assert.equal(reply.needsAgencyInput, true);
});

test('nothing in the codebase applies a mutation automatically', () => {
  const migration = source('../../db/migrations/0019_agency_client_chat.sql');
  // Mutations start life as proposals, and only a human decision moves them.
  assert.match(migration, /status\s+VARCHAR\(16\) NOT NULL DEFAULT 'proposed'/);
  assert.match(migration, /CHECK \(status IN \('proposed', 'approved', 'rejected'\)\)/);

  // The engine never emits an applied state.
  const engine = source('../src/lib/copilot/engine.ts');
  assert.doesNotMatch(engine, /'approved'/);
  assert.doesNotMatch(engine, /updateTenantFacts/);
});

// -----------------------------------------------------------------------------
// 5. Delegations
// -----------------------------------------------------------------------------

test('an operator instruction becomes a polite Danish question', () => {
  const { question, topic } = buildDelegationQuestion(
    context(),
    'Spørg Hans om de tager opgaver i Roskilde',
    'Hans Møller',
  );
  assert.equal(topic, 'de tager opgaver i Roskilde');
  assert.equal(
    question,
    'Hej Hans! Åse Østergaard spørger, om de tager opgaver i Roskilde. Kan du bekræfte det?',
  );
});

test('a delegation without a known contact still greets neutrally', () => {
  const { question } = buildDelegationQuestion(context(), 'Spørg om de tager opgaver i Roskilde', null);
  assert.match(question, /^Hej!/);
  assert.doesNotMatch(question, /undefined|null/);
});

test('delegation answers are summarised extractively with a yes/no verdict', () => {
  const yes = summariseDelegationAnswer('Tager I opgaver i Roskilde?', 'Ja, det gør vi sagtens.');
  assert.match(yes, /bekræftende/);
  assert.match(yes, /Ja, det gør vi sagtens/);

  const no = summariseDelegationAnswer('Tager I opgaver i Roskilde?', 'Nej, desværre ikke.');
  assert.match(no, /afkræftende/);

  const unclear = summariseDelegationAnswer('Tager I opgaver i Roskilde?', 'Det kommer an på opgaven.');
  assert.match(unclear, /ikke et klart ja eller nej/);

  // The client's own words are quoted, never paraphrased into a new claim.
  assert.match(unclear, /Det kommer an på opgaven/);
});

test('long delegation answers are truncated rather than dropped', () => {
  const long = 'Ja. '.repeat(200);
  const summary = summariseDelegationAnswer('Spørgsmål?', long);
  assert.ok(summary.length < 400, `summary too long: ${summary.length}`);
  assert.match(summary, /…/);
  assert.match(summary, /bekræftende/);
});

test('delegation contracts enforce length and strictness', () => {
  assert.equal(CopilotDelegationRequestSchema.safeParse({ instruction: 'Hej' }).success, false);
  assert.equal(
    CopilotDelegationRequestSchema.safeParse({ instruction: 'Spørg Hans om Roskilde' }).success,
    true,
  );
  assert.equal(
    CopilotDelegationRequestSchema.safeParse({ instruction: 'x'.repeat(601) }).success,
    false,
  );
});

test('an answered delegation cannot exist without both question and answer', () => {
  const base = {
    id: '44444444-4444-4444-8444-444444444444',
    tenantId: TENANT,
    contactId: CONTACT,
    status: 'answered',
    instruction: 'Spørg Hans om Roskilde',
    topic: 'Roskilde',
    question: 'Tager I opgaver i Roskilde?',
    answer: 'Ja',
    summary: 'Kunden svarede bekræftende',
    needsAgencyInput: false,
    createdAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
  };
  assert.equal(CopilotDelegationSchema.safeParse(base).success, true);

  const migration = source('../../db/migrations/0019_agency_client_chat.sql');
  assert.match(
    migration,
    /status <> 'answered' OR \(question IS NOT NULL AND answer IS NOT NULL\)/,
  );
});

test('the portal route only matches a delegation that was actually delivered', () => {
  const db = source('../src/lib/db/client-chat.ts');
  const body = db.split('export async function findOpenDelegation')[1] ?? '';
  // A 'pending' delegation was never sent, so a reply cannot belong to it.
  assert.match(body, /and status = 'sent'/);
});

// -----------------------------------------------------------------------------
// 6. Human takeover
// -----------------------------------------------------------------------------

test('an agency message mutes the co-pilot; only an explicit toggle revives it', () => {
  const agency = source('../src/app/api/agency/clients/[id]/chat/route.ts');
  // Posting as the operator latches the AI off...
  assert.match(agency, /action === 'toggle_ai'/);
  assert.match(agency, /setChatAiEnabled\(\s*session\.userId,\s*tenantId,\s*false,/);
  // ...and the message path is what turns it off, not a client request.
  const messageBranch = agency.split('// Default: a plain operator message.')[1] ?? '';
  assert.match(messageBranch, /setChatAiEnabled\([\s\S]*?false,/);
});

test('the portal auto-reply loop is gated on the takeover latch', () => {
  const portal = source('../src/app/api/portal/chat/route.ts');
  // The latch is read before any reply is generated.
  assert.match(portal, /const state = await getChatState\(session\.userId, tenantId\)/);
  assert.match(portal, /if \(!state\.aiEnabled\) \{[\s\S]*?replied: false/);
});

test('a muted co-pilot still captures the client answer to an open delegation', () => {
  const portal = source('../src/app/api/portal/chat/route.ts');
  const beforeLatch = portal.split('const state = await getChatState')[0] ?? '';
  // The delegation answer is recorded *before* the latch is consulted, so the
  // operator still gets the reply they asked for.
  assert.match(beforeLatch, /recordDelegationAnswer/);
});

test('chat state defaults to enabled and is a validated contract', () => {
  const state = ChatStateSchema.parse({
    tenantId: TENANT,
    pausedReason: null,
    updatedAt: new Date().toISOString(),
  });
  assert.equal(state.aiEnabled, true);

  assert.equal(
    ChatStateSchema.safeParse({ tenantId: 'nope', aiEnabled: true, pausedReason: null, updatedAt: '' }).success,
    false,
  );
  // An unknown key is rejected rather than silently ignored.
  assert.equal(
    ChatStateSchema.safeParse({
      tenantId: TENANT,
      aiEnabled: true,
      pausedReason: null,
      updatedAt: new Date().toISOString(),
      extra: 1,
    }).success,
    false,
  );
});

// -----------------------------------------------------------------------------
// 7. Contract integration
// -----------------------------------------------------------------------------

test('CopilotReply round-trips and rejects an unknown intent', () => {
  const reply = respondToClient(context(), 'Hej med jer');
  assert.equal(CopilotReplySchema.safeParse(reply).success, true);

  assert.equal(
    CopilotReplySchema.safeParse({ ...reply, intent: 'answer_everything' }).success,
    false,
  );
  // A reply must always carry usable text.
  assert.equal(CopilotReplySchema.safeParse({ ...reply, body: '' }).success, false);
});

test('Danish number and currency formatting uses Danish separators', () => {
  assert.equal(formatDkk(2500), '2.500 kr.');
  assert.equal(formatDkk(184_000), '184.000 kr.');
  // Null is an explicit unknown, not a zero.
  assert.equal(formatCount(null), 'kan ikke læses');
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(1234), '1.234');
});

test('intent classification covers the Danish vocabulary the agency actually uses', () => {
  const cases: Array<[string, string]> = [
    ['Hvor mange opkald har vi haft?', 'metrics'],
    ['Vis mig et overblik', 'metrics'],
    ['Hvad koster en facaderens?', 'pricing'],
    ['Hvornår har I åbent?', 'settings'],
    ['Spørg Hans om de tager opgaver i Roskilde', 'delegation'],
    ['Kan I garantere kvaliteten?', 'ungrounded'],
    ['Hej!', 'smalltalk'],
    ['', 'smalltalk'],
  ];
  for (const [message, expected] of cases) {
    assert.equal(classifyIntent(message), expected, message);
  }
});

test('the ungrounded reply names the owner and makes no claim of its own', () => {
  const body = ungroundedReply(context());
  assert.match(body, /Åse Østergaard/);
  // No currency, no dates, no hard numbers: those would be invented facts.
  assert.doesNotMatch(body, /\d+\s*kr\./);
  assert.doesNotMatch(body, /\d{1,2}\.\s*\w+\s*\d{4}/);
});

test('the agency console distinguishes all three actors without relying on colour', () => {
  const panel = source('../src/components/agency/AgencyClientChatPanel.tsx');
  // Every role has a label and an icon, not just a hue.
  assert.match(panel, /agency_operator:\s*\{[\s\S]*?label: 'Agentur'/);
  assert.match(panel, /ai_copilot:\s*\{[\s\S]*?label: 'Co-pilot'/);
  assert.match(panel, /client:\s*\{[\s\S]*?label: 'Kunde'/);
  // The delegate affordance exists.
  assert.match(panel, /Delegér til co-pilot/);
  // Optimistic rows are reconciled against the server copy, never left behind.
  assert.match(panel, /optimistic-\$\{Date\.now\(\)\}/);
});

test('the client panel is mobile-first and cannot post as another actor', () => {
  const panel = source('../src/components/portal/ClientDirectChatPanel.tsx');
  // A 44px tap target for the send control.
  assert.match(panel, /h-11 w-11/);
  // The client sends only its own body; the tenant comes from the session.
  assert.match(panel, /body: JSON\.stringify\(\{ tenantId, contactId, body \}\)/);
  // The panel only ever *writes* its own role, on the optimistic row. Everything
  // else is a comparison against a server-provided value.
  const assignedRoles = panel.match(/senderRole:\s*'/g) ?? [];
  assert.equal(assignedRoles.length, 1, 'exactly one role is ever asserted');
  assert.match(panel, /senderRole: 'client',/);
  // No role is ever taken from request-shaped data.
  assert.doesNotMatch(panel, /senderRole:\s*(body|payload|data)\./);
});
