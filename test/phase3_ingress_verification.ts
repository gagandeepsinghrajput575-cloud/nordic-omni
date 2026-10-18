import { LeadFormWebhookPayloadSchema, WarmTransferActionSchema, LiveKitTokenRequestSchema } from '../web/src/contracts/schemas.js';

console.log('--- Phase 3 Ingress & Contract Verification ---');

// 1. Verify Lead Form Contract
const leadFormPayload = {
  tenantSlug: 'kbh-vvs',
  fullName: 'Jørgen Skov',
  phoneNumber: '+4520334455',
  email: 'jorgen.skov@mail.dk',
  channelPreference: 'whatsapp',
  inquiryText: 'Akut sprængt vandrør i vaskerummet! Vandet fosser.',
  language: 'da',
};

const leadFormParsed = LeadFormWebhookPayloadSchema.safeParse(leadFormPayload);
if (!leadFormParsed.success) {
  console.error('❌ LeadFormWebhookPayloadSchema failed:', leadFormParsed.error);
  process.exit(1);
}
console.log('✅ LeadFormWebhookPayloadSchema verified successfully');

// 2. Verify Warm Transfer Action Contract
const warmTransferPayload = {
  callLogId: '99999999-9999-4999-8999-999999999999',
  tenantId: '11111111-1111-4111-8111-111111111111',
  action: 'START_PRIVATE_CONSULT',
  ownerInstruction: 'Fortæl kunden at montør Peter ankommer om 20 minutter.',
};

const warmTransferParsed = WarmTransferActionSchema.safeParse(warmTransferPayload);
if (!warmTransferParsed.success) {
  console.error('❌ WarmTransferActionSchema failed:', warmTransferParsed.error);
  process.exit(1);
}
console.log('✅ WarmTransferActionSchema verified successfully');

// 3. Verify LiveKit Token Request Contract
const tokenRequestPayload = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  roomName: 'kbh-vvs_call_jorgen',
  participantIdentity: 'customer_jorgen',
  participantName: 'Jørgen Skov',
  role: 'customer',
  metadata: { priority: 'high' },
};

const tokenParsed = LiveKitTokenRequestSchema.safeParse(tokenRequestPayload);
if (!tokenParsed.success) {
  console.error('❌ LiveKitTokenRequestSchema failed:', tokenParsed.error);
  process.exit(1);
}
console.log('✅ LiveKitTokenRequestSchema verified successfully');

console.log('--- All Phase 3 Ingress Contracts Passed Verification! ---');
