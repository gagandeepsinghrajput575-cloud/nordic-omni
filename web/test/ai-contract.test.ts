import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogItem } from '../src/lib/estimation';

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.DATABASE_ADMIN_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.NEXT_PUBLIC_LIVEKIT_URL ||= 'ws://localhost:7880';
process.env.LIVEKIT_API_KEY ||= 'test-key';
process.env.LIVEKIT_API_SECRET ||= 'test-secret';

const validPayload = {
  business_summary: 'Dansk Byg arbejder med badeværelser, køkkener, tilbygninger og tage i Storkøbenhavn.',
  services: { Badeværelse: 'Komplet renovering med vådrumssikring.' },
  faqs: { 'Hvor lang tid tager det?': 'Det afhænger af omfanget; en kollega bekræfter tidsplanen.' },
  policies: { Garanti: 'Der gives aldrig garantier uden en skriftlig aftale.' },
  qualification_questions: { 'Antal m2': { question: 'Hvor mange kvadratmeter drejer det sig om?', why: 'Scope' } },
  estimate_rules: 'Alle priser er vejledende og ikke bindende.',
  guardrails: ['Vær altid høflig.', 'Lov aldrig en fast pris.'],
  escalation_triggers: ['vandskade', 'kunden beder om en person'],
  tone_notes: 'Kort, rolig og konkret.',
  uncertainties: ['Åbningstider mangler i kilden.'],
};

test('brain parser accepts object-shaped model output without inventing facts', async () => {
  const { parseBrainPayload, brainKnowledgeItems } = await import('../src/lib/ai/brain');
  const parsed = parseBrainPayload(validPayload);
  assert.equal(parsed.services.length, 1);
  assert.equal(parsed.faqs.length, 1);
  assert.equal(parsed.policies.length, 1);
  assert.equal(parsed.estimate_rules.length, 1);
  assert.equal(parsed.qualification_questions[0].key, 'Antal m2');
  const items = brainKnowledgeItems(parsed);
  assert.ok(items.some((item) => item.category === 'guardrail'));
  assert.ok(items.some((item) => item.category === 'escalation'));
});

test('compiler refuses to mark an inference failure as approvable', async () => {
  const { compileBusinessBrain } = await import('../src/lib/ai/brain');
  const failed = await compileBusinessBrain({
    tenantName: 'Test',
    language: 'da',
    sources: [{ kind: 'notes', title: 'Notes', location: null, rawText: 'Fakta om virksomheden.' }],
    infer: async () => {
      throw new Error('gateway down');
    },
  });
  assert.equal(failed.model, 'fallback');
  assert.ok(failed.warnings.includes('inference_failed'));
});

test('website text extraction strips executable content and decodes Danish entities', async () => {
  const { extractReadableHtml } = await import('../src/lib/ai/website');
  const { title, text } = extractReadableHtml(
    '<html><head><title>Dansk Byg &amp; Renovering</title><script>steal()</script></head>' +
      '<body><h1>Badeværelse</h1><p>Fast pris? Nej, vejledende.</p></body></html>',
  );
  assert.equal(title, 'Dansk Byg & Renovering');
  assert.ok(text.includes('Badeværelse'));
  assert.ok(text.includes('vejledende'));
  assert.ok(!text.includes('steal'));
});

test('estimate calculation is catalog-grounded and rejects unsupported work', async () => {
  const { calculateEstimate } = await import('../src/lib/estimation');
  const catalog: CatalogItem[] = [
    { id: 'bath', service: 'Bathroom', price_dkk: 130000, unit: 'fixed', estimate_model: 'fixed', estimate_min_dkk: 95000, estimate_max_dkk: 165000 },
    { id: 'roof', service: 'Roof', price_dkk: 1900, unit: 'm²', estimate_model: 'per_square_meter', estimate_min_dkk: 1400, estimate_max_dkk: 2400 },
  ];
  const bath = calculateEstimate(catalog, 'bath', 8);
  assert.equal(bath.minimum, 95000);
  assert.equal(bath.maximum, 165000);
  const roof = calculateEstimate(catalog, 'roof', 50);
  assert.equal(roof.minimum, 70000);
  assert.throws(() => calculateEstimate(catalog, 'unknown', null));
});

test('chat prompt carries cross-channel memory and hard guardrails', async () => {
  const { buildChatPrompt, parseChatResult } = await import('../src/lib/ai/customer-chat');
  const context = {
    contact: {
      id: 'c1',
      tenant_id: 't1',
      full_name: 'Henrik',
      phone_number: '+4511111111',
      email: null,
      preferred_language: 'da',
      pipeline_stage: 'contacted',
      lead_score: 60,
      estimated_value_dkk: 0,
      ai_auto_reply_enabled: true,
      shared_memory_summary: 'Kunden har talt om et nyt tag.',
    },
    tenant: {
      id: 't1',
      name: 'Dansk Byg',
      slug: 'dansk-byg',
      status: 'active',
      default_language: 'da-DK',
      owner_name: 'Morten',
      owner_phone: '+4522222222',
      owner_email: 'm@example.dk',
      business_hours: {},
      pricing_catalog: [
        { id: 'roof', service: 'Nyt tag', price_dkk: 1900, estimate_min_dkk: 1400, estimate_max_dkk: 2400, unit: 'm²' },
      ],
      active_broadcast_message: null,
    },
    agent: { customer_system_prompt: 'Du er receptionist.', escalation_policy: {} },
    knowledge: 'Tagarbejde kræver besigtigelse.',
  };
  const prompt = buildChatPrompt(context, [
    {
      id: 'm1',
      channel: 'voice_instant_webrtc',
      direction: 'inbound',
      sender: 'customer',
      content: 'Jeg spurgte om et nyt tag i går.',
      created_at: new Date().toISOString(),
    },
  ]);
  assert.match(prompt.system, /Kunden har talt om et nyt tag/);
  assert.match(prompt.system, /Jeg spurgte om et nyt tag/);
  assert.match(prompt.system, /Never argue/);
  assert.match(prompt.system, /never claim to transfer/i);
  assert.ok(prompt.user.includes('JSON'));

  const parsed = parseChatResult({
    reply: 'Det er et vejledende overslag, ikke et bindende tilbud. Skal vi se på taget?',
    intent: 'estimate',
    stage: 'qualified',
    lead_score: 80,
    memory_update: 'Kunden vil have et nyt tag.',
    estimate: {
      catalog_item_id: 'roof',
      project_type: 'Nyt tag',
      scope_details: '50 m2 tag',
      square_meters: 50,
      followup_notes: '',
    },
    inspection_request: null,
    escalation: null,
  });
  assert.equal(parsed.stage, 'qualified');
  assert.equal(parsed.estimate?.catalog_item_id, 'roof');

  const human = parseChatResult({
    reply: 'Jeg noterer din anmodning til kontoret.',
    intent: 'human',
    stage: 'contacted',
    lead_score: 50,
    memory_update: 'Kunden vil tale med en person.',
    estimate: null,
    inspection_request: null,
    escalation: {
      needed: true,
      reason: 'human_requested',
      urgency: 'medium',
      briefing: 'Kunden vil tale med en person om garanti.',
    },
  });
  assert.equal(human.escalation?.urgency, 3);
  assert.equal(human.escalation?.needed, true);
});

test('website importer blocks IPv4-mapped IPv6 SSRF targets and invalid HTML entities', async () => {
  const { isPrivateAddress, extractReadableHtml } = await import('../src/lib/ai/website');

  for (const addr of [
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.5',
    '::ffff:172.16.0.1',
  ]) {
    assert.equal(isPrivateAddress(addr), true, `Expected ${addr} to be blocked`);
  }
  assert.equal(isPrivateAddress('::ffff:8.8.8.8'), false);
  assert.equal(isPrivateAddress('8.8.8.8'), false);

  const parsed = extractReadableHtml(
    '<title>Dansk &#x110000; Byg &amp; Tag &#xD800;</title><p>Pris &#999999999; fra &#230;gte fagfolk</p>'
  );
  assert.match(parsed.title, /&#x110000;/);
  assert.match(parsed.title, /&#xD800;/);
  assert.match(parsed.title, /& Tag/);
  assert.match(parsed.text, /æg/);
});
