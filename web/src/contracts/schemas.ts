import { z } from 'zod';

// ==============================================================================
// 1. CORE ENUMS & DOMAIN SCALARS
// ==============================================================================
export const LanguageSchema = z.enum(['da-DK', 'en-US']);
export const ShortLanguageSchema = z.enum(['da', 'en']);
export const TelephonyModeSchema = z.enum(['zero_cost_webrtc', 'paid_sip_trunk']);

export const PipelineStageSchema = z.enum([
  'new_lead',
  'contacted',
  'qualified',
  'booked',
  'dire_escalated',
  'closed_won',
  'closed_lost',
]);

export const ChannelSchema = z.enum([
  'lead_form',
  'whatsapp',
  'instagram',
  'voice_inbound',
  'voice_instant_webrtc',
  'owner_whisper',
]);

export const CallStatusSchema = z.enum([
  'ringing',
  'in_progress',
  'dire_hold_for_owner',
  'owner_consulting_ai',
  'merged_live_with_owner',
  'ai_relaying_owner_instruction',
  'completed',
  'missed',
]);

export const DireReasonSchema = z.enum([
  'angry_customer',
  'high_value_emergency',
  'ai_unanswered_question',
]);

export const UICommandTypeSchema = z.enum([
  'FOCUS_SCORECARD',
  'FILTER_PIPELINE',
  'OPEN_CONTACT_DRAWER',
  'HIGHLIGHT_AVAILABILITY',
  'HIGHLIGHT_PRICING',
  'TRIGGER_DIRE_MODAL',
  'PULSE_METRIC',
]);

// ==============================================================================
// 2. KNOWLEDGE & BUSINESS SETTINGS SCHEMAS
// ==============================================================================
export const BusinessDayHoursSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  close: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  closed: z.boolean(),
});

export const BusinessHoursSchema = z.object({
  mon: BusinessDayHoursSchema,
  tue: BusinessDayHoursSchema,
  wed: BusinessDayHoursSchema,
  thu: BusinessDayHoursSchema,
  fri: BusinessDayHoursSchema,
  sat: BusinessDayHoursSchema,
  sun: BusinessDayHoursSchema,
});

export const PricingItemSchema = z.object({
  id: z.string(),
  service: z.string().min(2),
  price_dkk: z.number().nonnegative(),
  unit: z.enum(['hour', 'call-out', 'package', 'fixed']),
});

// ==============================================================================
// 3. RELATIONAL ENTITY SCHEMAS
// ==============================================================================
export const TenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  flynumber_did: z.string().nullable().optional(),
  owner_name: z.string().min(1),
  owner_phone: z.string().min(1),
  owner_email: z.string().email(),
  owner_pin: z.string().min(4).default('1234'),
  default_language: LanguageSchema.default('da-DK'),
  telephony_mode: TelephonyModeSchema.default('zero_cost_webrtc'),
  system_prompt_overrides: z.string().nullable().optional(),
  active_broadcast_message: z.string().nullable().optional(),
  business_hours: BusinessHoursSchema,
  pricing_catalog: z.array(PricingItemSchema).default([]),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ContactSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  phone_number: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  full_name: z.string().nullable().optional(),
  instagram_handle: z.string().nullable().optional(),
  preferred_channel: ChannelSchema.default('whatsapp'),
  preferred_language: ShortLanguageSchema.default('da'),
  lead_score: z.number().int().min(0).max(100).default(50),
  estimated_value_dkk: z.number().default(0),
  pipeline_stage: PipelineStageSchema.default('new_lead'),
  shared_memory_summary: z.string().default(''),
  sentiment_score: z.number().min(0).max(10).default(7.5),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
});

export const OmnichannelMessageSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  channel: ChannelSchema,
  direction: z.enum(['inbound', 'outbound', 'system']),
  content: z.string().min(1),
  media_url: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string(),
});

export const TranscriptTurnSchema = z.object({
  speaker: z.enum(['caller', 'agent', 'owner', 'ai']),
  text: z.string(),
  timestamp_ms: z.number().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
});

export const CallLogSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  contact_id: z.string().uuid().nullable().optional(),
  room_name: z.string().min(1),
  channel: z.enum(['voice_inbound', 'voice_instant_webrtc']),
  status: CallStatusSchema.default('ringing'),
  dire_reason: DireReasonSchema.nullable().optional(),
  recording_url: z.string().nullable().optional(),
  duration_seconds: z.number().int().nonnegative().default(0),
  transcript_full: z.array(TranscriptTurnSchema).default([]),
  summary: z.string().nullable().optional(),
  detected_intent: z.string().nullable().optional(),
  owner_consult_transcript: z.array(TranscriptTurnSchema).default([]),
  owner_instructions: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const UICommandEventSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  command_type: UICommandTypeSchema,
  payload: z.record(z.unknown()).default({}),
  created_at: z.string(),
});

// ==============================================================================
// 4. INGRESS, WEBHOOK & INTER-SERVICE CONTRACTS
// ==============================================================================
export const LeadFormWebhookPayloadSchema = z.object({
  tenantSlug: z.string().min(1),
  fullName: z.string().min(1),
  phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 format e.g. +4520123456'),
  email: z.string().email().optional(),
  channelPreference: z.enum(['whatsapp', 'instagram']).default('whatsapp'),
  instagramHandle: z.string().optional(),
  inquiryText: z.string().min(2),
  language: ShortLanguageSchema.default('da'),
});

export const MetaWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.string().optional(),
            metadata: z.object({
              display_phone_number: z.string().optional(),
              phone_number_id: z.string().optional(),
            }).optional(),
            contacts: z.array(
              z.object({
                profile: z.object({
                  name: z.string(),
                }),
                wa_id: z.string(),
              })
            ).optional(),
            messages: z.array(
              z.object({
                from: z.string(),
                id: z.string(),
                timestamp: z.string(),
                text: z.object({
                  body: z.string(),
                }).optional(),
                type: z.string(),
              })
            ).optional(),
          }),
          field: z.string(),
        })
      ),
    })
  ),
});

export const WarmTransferActionSchema = z.object({
  callLogId: z.string().uuid(),
  tenantId: z.string().uuid(),
  action: z.enum([
    'START_PRIVATE_CONSULT',
    'RELAY_OWNER_INSTRUCTION',
    'MERGE_OWNER_INTO_CALL',
    'RESOLVE_AND_END',
  ]),
  ownerInstruction: z.string().optional(),
});

export const OwnerCopilotCommandSchema = z.object({
  tenantId: z.string().uuid(),
  inputMode: z.enum(['voice', 'text']),
  utterance: z.string().min(1),
});

export const LiveKitTokenRequestSchema = z.object({
  tenantId: z.string().uuid(),
  roomName: z.string().min(1),
  participantIdentity: z.string().min(1),
  participantName: z.string().min(1),
  role: z.enum(['customer', 'owner_consult', 'owner_merged']),
  metadata: z.record(z.unknown()).optional(),
});

// ==============================================================================
// 5. INFERRED TYPESCRIPT TYPES
// ==============================================================================
export type Language = z.infer<typeof LanguageSchema>;
export type ShortLanguage = z.infer<typeof ShortLanguageSchema>;
export type TelephonyMode = z.infer<typeof TelephonyModeSchema>;
export type PipelineStage = z.infer<typeof PipelineStageSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type CallStatus = z.infer<typeof CallStatusSchema>;
export type DireReason = z.infer<typeof DireReasonSchema>;
export type UICommandType = z.infer<typeof UICommandTypeSchema>;

export type BusinessDayHours = z.infer<typeof BusinessDayHoursSchema>;
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;
export type PricingItem = z.infer<typeof PricingItemSchema>;

export type Tenant = z.infer<typeof TenantSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type OmnichannelMessage = z.infer<typeof OmnichannelMessageSchema>;
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;
export type CallLog = z.infer<typeof CallLogSchema>;
export type UICommandEvent = z.infer<typeof UICommandEventSchema>;

export type LeadFormWebhookPayload = z.infer<typeof LeadFormWebhookPayloadSchema>;
export type MetaWebhookPayload = z.infer<typeof MetaWebhookPayloadSchema>;
export type WarmTransferAction = z.infer<typeof WarmTransferActionSchema>;
export type OwnerCopilotCommand = z.infer<typeof OwnerCopilotCommandSchema>;
export type LiveKitTokenRequest = z.infer<typeof LiveKitTokenRequestSchema>;
