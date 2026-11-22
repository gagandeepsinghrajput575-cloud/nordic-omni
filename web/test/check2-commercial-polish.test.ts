import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { PostChatMessageSchema } from '../src/contracts/schemas';
import { BrainSchema, brainKnowledgeItems } from '../src/lib/ai/brain';

process.env.SESSION_SECRET ||= '024e8d23c9bd203300bcb3ae2e4e075507305f2b1b63f2cc7d776650ee76a7fe';

const read = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');

test('Check 2 Item 1: Database Migration 0023 is strictly additive', () => {
  const sql = read('../db/migrations/0023_check2_commercial_polish.sql');

  // Verify additive statements only
  assert.match(sql, /create table if not exists public\.followup_sequences/i);
  assert.match(sql, /alter table public\.client_chat_messages\s+add column if not exists attachments jsonb/i);
  assert.match(sql, /alter table public\.agency_client_messages\s+add column if not exists attachments jsonb/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /omni_app/i);
  assert.match(sql, /prevent_tenant_reassignment/i);

  // Strict check: zero destructive operations
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /drop column/i);
});

test('Check 2 Item 2: Dedicated Brand-Safety Policy exists and is versioned', () => {
  const policyPath = new URL('../../shared/guardrails/brand_safety_policy.md', import.meta.url);
  assert.ok(existsSync(policyPath), 'brand_safety_policy.md must exist in shared/guardrails');

  const policy = readFileSync(policyPath, 'utf8');
  assert.match(policy, /Version: 1\.0\.0/);
  assert.match(policy, /Calm, Polite [&and]+ Neutral Posture/i);
  assert.match(policy, /Zero Reciprocation of Hostility/i);
  assert.match(policy, /Competitive Neutrality/i);
  assert.match(policy, /De-escalation/i);
  assert.match(policy, /Immediate Human Takeover|Straight-to-Owner Escape Hatch/i);
  assert.match(policy, /Remodeler Hidden Conditions & Budget Alignment/i);

  // Check integration in web customer chat
  const customerChatCode = read('src/lib/ai/customer-chat.ts');
  assert.match(customerChatCode, /loadBrandSafetyPolicy/);
  assert.match(customerChatCode, /brand_safety_policy\.md/);
});

test('Check 2 Item 3: Remodeler Hidden-Conditions & Budget Alignment in Quote Assistant', () => {
  const quoteAssistantCode = read('src/lib/quotes/quote-assistant.ts');

  // Must mention hidden conditions that cannot be seen on photos/video
  assert.match(quoteAssistantCode, /skjulte forhold/i);
  assert.match(quoteAssistantCode, /fugtskader under gulv/i);
  assert.match(quoteAssistantCode, /fysisk besigtigelse/i);

  // Must include budget alignment question
  assert.match(
    quoteAssistantCode,
    /Passer det vejledende prisspænd nogenlunde med det budget, du havde i tankerne\?/i,
  );

  // Must auto-schedule follow-up sequence
  assert.match(quoteAssistantCode, /scheduleFollowupSequenceAdmin/);
});

test('Check 2 Item 4: Follow-up Sequences Library & Logic', () => {
  const seqCode = read('src/lib/followup/sequences.ts');
  const trustedCode = read('src/lib/db/trusted-records.ts');

  // Must contain step 1 (+3.5h) and step 2 (+24h)
  assert.match(seqCode, /step1DelayHours = 3\.5/);
  assert.match(seqCode, /step2DelayHours = 24/);
  assert.match(seqCode, /scheduleFollowupSequence/);
  assert.match(seqCode, /scheduleFollowupSequenceAdmin/);
  assert.match(seqCode, /cancelPendingFollowups/);
  assert.match(seqCode, /cancelPendingFollowupsAdmin/);
  assert.match(seqCode, /sweepPendingFollowups/);
  assert.match(trustedCode, /for update skip locked/i);
});

test('Check 2 Item 4: /api/followup/sweep Route Security', () => {
  const sweepCode = read('src/app/api/followup/sweep/route.ts');

  // Must verify bearer secret with timing-safe comparison
  assert.match(sweepCode, /timingSafeEqual/);
  assert.match(sweepCode, /verifyCronBearer/);
  assert.match(sweepCode, /isCronAuthorized/);

  // Must reject unauthenticated callers without valid session or CRON_SECRET
  assert.match(sweepCode, /const session = await apiSession\(\)/);
  assert.match(sweepCode, /if \(!session\)[\s\S]*?return jsonError\('Unauthorized: valid agency session or CRON_SECRET required', 401\)/);

  // Must reject authenticated callers who are not agency operators
  assert.match(sweepCode, /if \(!session\.isAgency\)[\s\S]*?return jsonError\('Forbidden: agency administrator access required', 403\)/);
});

test('Check 2 Item 4: /api/followup/cancel Route Security', () => {
  const cancelCode = read('src/app/api/followup/cancel/route.ts');

  // Must reject unauthenticated callers with 401
  assert.match(cancelCode, /const session = await apiSession\(\)/);
  assert.match(cancelCode, /if \(!session\)[\s\S]*?return jsonError\('Unauthorized: please sign in', 401\)/);

  // Must reject cross-tenant callers with 403
  assert.match(cancelCode, /if \(!session\.isAgency && !session\.tenantIds\.includes\(contactTenantId\)\)/);
  assert.match(cancelCode, /jsonError\('Forbidden: contact belongs to another workspace', 403\)/);
});

test('Check 2 Item 5: Owner-to-Agent File Passing & Schemas', () => {
  // PostChatMessageSchema allows attachments
  const parsed = PostChatMessageSchema.safeParse({
    body: 'Se venligst vedhæftede billeder af badeværelset',
    attachments: [
      { type: 'photo', id: 'photo-1', url: '/api/media/file/photo-1?token=mock' },
    ],
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data.attachments.length, 1);

  // POST /api/portal/chat attaches signed tokens
  const chatRouteCode = read('src/app/api/portal/chat/route.ts');
  assert.match(chatRouteCode, /signMediaUploadToken\(tenantId, contactId\)/);
  assert.match(chatRouteCode, /\/api\/media\/file\/\$\{media\.id\}\?token=\$\{signedToken\}/);
});

test('Check 2 Item 6: One-URL Self-Training Importer handles Projects & Extended Schema', () => {
  const websiteCode = read('src/lib/ai/website.ts');

  // Must discover projects, references, gallery, and cases pages up to 8 pages
  assert.match(websiteCode, /MAX_PAGES = 8/);
  assert.match(websiteCode, /projekter\|projekt\|referencer\|reference\|galleri\|gallery\|cases/);

  // BrainSchema contains pricing_catalog_draft, proof_points, and brand_safety_prep
  const sampleBrain = {
    business_summary: 'Aarhus Håndværk er et murer- og tømrerfirma i Aarhus med fokus på kvalitet og kundetilfredshed.',
    services: [
      {
        name: 'Badeværelsesrenovering',
        description: 'Komplet renovering af badeværelser med vådrumssikring og flisearbejde.',
        price_note: 'Fra 85.000 kr inkl. moms',
      },
    ],
    faqs: [
      {
        question: 'Giver I garanti på arbejdet?',
        answer: 'Ja, vi er medlem af Byg Garanti, så du er dækket op til 50.000 kr.',
      },
    ],
    policies: ['Betaling 14 dage netto efter aflevering.'],
    qualification_questions: [
      {
        key: 'm2',
        question: 'Hvor mange kvadratmeter drejer projektet sig om?',
        why: 'For at beregne et vejledende prisestimat.',
      },
    ],
    estimate_rules: ['Alle overslag er vejledende og inkl. 25% moms.'],
    guardrails: ['Vi udfører ikke asbestsanering uden forudgående miljørapport.'],
    escalation_triggers: ['Kunden er utilfreds eller beder om ejer.'],
    tone_notes: ['Imødekommende, professionel og faglig tone.'],
    uncertainties: ['Rørføringens stand i ældre ejendomme.'],
    pricing_catalog_draft: [
      {
        service: 'Badeværelsesrenovering',
        price_dkk: 85000,
        unit: 'projekt',
        estimate_min_dkk: 75000,
        estimate_max_dkk: 125000,
      },
    ],
    proof_points: [
      {
        project_type: 'Totalrenovering af badeværelse',
        location: 'Risskov',
        description: 'Komplet ombygning af 12m2 badeværelse i murermestervilla inkl. gulvvarme.',
      },
    ],
    brand_safety_prep: [
      'Anerkend altid konkurrenten høfligt og fokusér udelukkende på vores egne styrker.',
      'Eskaler straks til Morten hvis kunden ønsker en fysisk besigtigelse.',
    ],
  };

  const parsedBrain = BrainSchema.safeParse(sampleBrain);
  assert.ok(parsedBrain.success, 'BrainSchema should successfully parse the extended fields');

  const knowledge = brainKnowledgeItems(parsedBrain.data);
  const titles = knowledge.map((k) => k.title);
  assert.ok(titles.some((t) => t.startsWith('Priskatalog:')));
  assert.ok(titles.some((t) => t.startsWith('Reference:')));
  assert.ok(titles.some((t) => t.startsWith('Brand-Safety Regel')));
});


test('Check 2 Polish: Instant Global EN | DA i18n & Client Access Handoff', () => {
  // Verify i18n locale normalization and dictionary integrity
  const { normalizeLocale, LOCALE_COOKIE, getDictionary } = require('../src/lib/i18n/locale');
  assert.equal(LOCALE_COOKIE, 'omni_locale');
  assert.equal(normalizeLocale('da'), 'da');
  assert.equal(normalizeLocale('da-DK'), 'da');
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale(null), 'en');

  const enDict = getDictionary('en');
  const daDict = getDictionary('da');
  assert.ok(enDict.shell.agencyConsole);
  assert.ok(daDict.shell.agencyConsole);
  assert.ok(enDict.clientAccess.title);
  assert.ok(daDict.clientAccess.title);

  // Verify ClientAccessCard implementation
  const accessCardCode = read('src/components/agency/ClientAccessCard.tsx');
  assert.match(accessCardCode, /export function ClientAccessCard/);
  assert.match(accessCardCode, /useLocale/);
  assert.match(accessCardCode, /navigator\.clipboard\.writeText/);
  // Zero hex color literals in UI component
  assert.doesNotMatch(accessCardCode, /#[0-9a-fA-F]{3,6}/);
});
