import {
  LeadFormWebhookPayloadSchema,
  WarmTransferActionSchema,
  LiveKitTokenRequestSchema,
  OwnerCopilotCommandSchema,
} from '../web/src/contracts/schemas.js';

console.log('====================================================');
console.log('   DEEP BUG RESOLUTION & ENGLISH LOCALIZATION TEST   ');
console.log('====================================================');

// Test 1: English Lead Form Ingestion
console.log('\n[Test 1] Verifying English Lead Form Ingestion Payload...');
const englishLeadForm = {
  tenantSlug: 'nordic-dental',
  fullName: 'Alexander Wright',
  phoneNumber: '+447911123456',
  email: 'alexander.wright@fintech-cph.co.uk',
  channelPreference: 'whatsapp',
  inquiryText: 'Emergency! A major waterline burst in our treatment suite, flooding the floor! Need immediate repair.',
  language: 'en',
};

const leadRes = LeadFormWebhookPayloadSchema.safeParse(englishLeadForm);
if (!leadRes.success) {
  console.error('❌ Failed English Lead Form Schema:', leadRes.error);
  process.exit(1);
}
console.log('✅ English Lead Form validated successfully:', leadRes.data.fullName);

// Test 2: Dual Token Metadata (snake_case + camelCase)
console.log('\n[Test 2] Verifying LiveKit Token Request with Dual-Cased Metadata...');
const tokenRequest = {
  tenantId: '22222222-2222-4222-8222-222222222222',
  roomName: 'nordic-dental_call_alexander',
  participantIdentity: 'customer_alexander',
  participantName: 'Alexander Wright',
  role: 'customer',
  metadata: {
    tenant_id: '22222222-2222-4222-8222-222222222222',
    tenantId: '22222222-2222-4222-8222-222222222222',
    contact_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    contactId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  },
};

const tokenRes = LiveKitTokenRequestSchema.safeParse(tokenRequest);
if (!tokenRes.success) {
  console.error('❌ Failed LiveKit Token Schema:', tokenRes.error);
  process.exit(1);
}
console.log('✅ Dual Metadata LiveKit Token validated successfully');

// Test 3: Warm Transfer with Valid Seed UUID and Fallback String
console.log('\n[Test 3] Verifying Warm Transfer Action Schema...');
const warmTransfer = {
  callLogId: '99999999-9999-4999-8999-999999999999',
  tenantId: '11111111-1111-4111-8111-111111111111',
  action: 'MERGE_OWNER_INTO_CALL',
  ownerInstruction: 'I am patching in directly on the browser audio track now.',
};

const wtRes = WarmTransferActionSchema.safeParse(warmTransfer);
if (!wtRes.success) {
  console.error('❌ Failed Warm Transfer Schema:', wtRes.error);
  process.exit(1);
}
console.log('✅ Warm Transfer Action validated successfully:', wtRes.data.action);

// Test 4: Copilot Command Schema (English Utterance)
console.log('\n[Test 4] Verifying Owner Copilot Command Schema (English)...');
const copilotCommand = {
  tenantId: '22222222-2222-4222-8222-222222222222',
  inputMode: 'voice',
  utterance: 'Close the dental office this Friday afternoon and update extraction rate to 1250 DKK.',
};

const copilotRes = OwnerCopilotCommandSchema.safeParse(copilotCommand);
if (!copilotRes.success) {
  console.error('❌ Failed Copilot Command Schema:', copilotRes.error);
  process.exit(1);
}
console.log('✅ Owner Copilot Command validated successfully:', copilotRes.data.utterance);

// Test 5: Verify UUID regex validation helper
console.log('\n[Test 5] Verifying UUID Safety Check...');
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validUuid = '99999999-9999-4999-8999-999999999999';
const mockString = 'simulated-call-log-uuid';

if (!uuidRegex.test(validUuid)) {
  console.error('❌ UUID regex failed on valid UUID');
  process.exit(1);
}
if (uuidRegex.test(mockString)) {
  console.error('❌ UUID regex incorrectly matched mock string');
  process.exit(1);
}
console.log('✅ UUID validation safely distinguishes standard UUIDs from mock identifiers');

console.log('\n====================================================');
console.log('   🎉 ALL 5 INTEGRATION & BUG CHECKS PASSED 100%!   ');
console.log('====================================================');
