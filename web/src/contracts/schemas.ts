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
  'web_chat',
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
  'PROJECT_ESTIMATE_RECORDED',
  'INSPECTION_REQUESTED',
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

export const EstimateModelSchema = z.enum(['fixed', 'per_square_meter']);

export const PricingItemSchema = z
  .object({
    id: z.string().min(1),
    service: z.string().min(2),
    price_dkk: z.number().finite().nonnegative(),
    // Danish catalog units are human-facing text, not an English enum.
    unit: z.string().trim().min(1).max(240),
    estimate_model: EstimateModelSchema.optional(),
    estimate_min_dkk: z.number().finite().positive().optional(),
    estimate_max_dkk: z.number().finite().positive().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.estimate_model) {
      if (item.estimate_min_dkk === undefined || item.estimate_max_dkk === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Estimate brackets require both minimum and maximum DKK values',
          path: ['estimate_min_dkk'],
        });
      }
    }
    if (
      item.estimate_min_dkk !== undefined &&
      item.estimate_max_dkk !== undefined &&
      item.estimate_min_dkk > item.estimate_max_dkk
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Estimate minimum cannot exceed its maximum',
        path: ['estimate_max_dkk'],
      });
    }
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
  customer_system_prompt: z.string().nullable().optional(),
  copilot_system_prompt: z.string().nullable().optional(),
  client_passkey: z.string().nullable().optional(),
  active_broadcast_message: z.string().nullable().optional(),
  ai_auto_reply_default: z.boolean().default(true),
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
  ai_auto_reply_enabled: z.boolean().default(true),
  last_human_takeover_at: z.string().nullable().optional(),
  shared_memory_summary: z.string().default(''),
  sentiment_score: z.number().min(0).max(10).default(7.5),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ProjectEstimateSchema = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    contact_id: z.string().uuid(),
    call_log_id: z.string().uuid().nullable(),
    project_type: z.string().min(1),
    scope_details: z.string().min(1),
    square_meters: z.number().finite().positive().max(100_000).nullable(),
    estimated_min_dkk: z.number().finite().nonnegative(),
    estimated_max_dkk: z.number().finite().nonnegative(),
    estimated_value_dkk: z.number().finite().nonnegative(),
    followup_notes: z.string().default(''),
    created_at: z.string(),
  })
  .refine((estimate) => estimate.estimated_max_dkk >= estimate.estimated_min_dkk, {
    message: 'Estimated maximum must be greater than or equal to the minimum',
    path: ['estimated_max_dkk'],
  });

export const InspectionStatusSchema = z.enum([
  'requested',
  'confirmed',
  'completed',
  'cancelled',
]);

export const InspectionRequestSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  call_log_id: z.string().uuid().nullable(),
  requested_time_text: z.string().min(1),
  address: z.string().default(''),
  notes: z.string().default(''),
  status: InspectionStatusSchema.default('requested'),
  created_at: z.string(),
  updated_at: z.string(),
});

export const RecordProjectEstimateInputSchema = z.object({
  catalog_item_id: z.string().min(1),
  project_type: z.string().min(1),
  scope_details: z.string().min(1),
  square_meters: z.number().finite().positive().max(100_000).nullable(),
  followup_notes: z.string().default(''),
});

export const OmnichannelMessageSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  channel: ChannelSchema,
  direction: z.enum(['inbound', 'outbound', 'system']),
  content: z.string().min(1),
  media_url: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
});

const TranscriptTimingSchema = z.object({
  timestamp_ms: z.number().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
});

// The worker persists role/content; legacy owner transcripts use speaker/text.
export const TranscriptTurnSchema = z.union([
  TranscriptTimingSchema.extend({
    role: z.enum(['assistant', 'user']),
    content: z.string(),
  }),
  TranscriptTimingSchema.extend({
    speaker: z.enum(['caller', 'agent', 'owner', 'ai']),
    text: z.string(),
  }),
]);

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
  payload: z.record(z.string(), z.unknown()).default({}),
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
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ProvisionWizardRequestSchema = z.object({
  mode: z.enum(['interview', 'generate']),
  notes: z.string().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      })
    )
    .optional()
    .default([]),
});

export const ProvisionTenantPayloadSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  owner_name: z.string().min(1),
  owner_phone: z.string().min(1),
  owner_email: z.string().email(),
  default_language: LanguageSchema.default('da-DK'),
  telephony_mode: TelephonyModeSchema.default('zero_cost_webrtc'),
  flynumber_did: z.string().nullable().optional(),
  client_passkey: z.string().min(6),
  customer_system_prompt: z.string().min(10),
  copilot_system_prompt: z.string().min(10),
  active_broadcast_message: z.string().nullable().optional(),
  business_hours: BusinessHoursSchema,
  pricing_catalog: z.array(PricingItemSchema).default([]),
  knowledge_items: z
    .array(
      z.object({
        category: z.string(),
        title: z.string(),
        content: z.string(),
      })
    )
    .default([]),
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
export type EstimateModel = z.infer<typeof EstimateModelSchema>;
export type PricingItem = z.infer<typeof PricingItemSchema>;

export type Tenant = z.infer<typeof TenantSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type ProjectEstimate = z.infer<typeof ProjectEstimateSchema>;
export type InspectionStatus = z.infer<typeof InspectionStatusSchema>;
export type InspectionRequest = z.infer<typeof InspectionRequestSchema>;
export type RecordProjectEstimateInput = z.infer<typeof RecordProjectEstimateInputSchema>;
export type OmnichannelMessage = z.infer<typeof OmnichannelMessageSchema>;
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;
export type CallLog = z.infer<typeof CallLogSchema>;
export type UICommandEvent = z.infer<typeof UICommandEventSchema>;

export type LeadFormWebhookPayload = z.infer<typeof LeadFormWebhookPayloadSchema>;
export type MetaWebhookPayload = z.infer<typeof MetaWebhookPayloadSchema>;
export type WarmTransferAction = z.infer<typeof WarmTransferActionSchema>;
export type OwnerCopilotCommand = z.infer<typeof OwnerCopilotCommandSchema>;
export type LiveKitTokenRequest = z.infer<typeof LiveKitTokenRequestSchema>;
export type ProvisionWizardRequest = z.infer<typeof ProvisionWizardRequestSchema>;
export type ProvisionTenantPayload = z.infer<typeof ProvisionTenantPayloadSchema>;

// ==============================================================================
// 6. TELEPHONY SMS DISPATCH SCHEMAS
// ==============================================================================
export const SmsMessageTypeSchema = z.enum([
  'customer_followup',
  'lead_alert',
  'inspection_confirm',
  'booking_confirm',
  'custom',
]);

export const SmsStatusSchema = z.enum([
  'queued',
  'sending',
  'delivered',
  'failed',
]);

export const SmsDispatchRecordSchema = z.object({
  id: z.string(),
  recipient: z.string(),
  messageType: SmsMessageTypeSchema,
  body: z.string(),
  callLogId: z.string().nullable(),
  contactId: z.string().nullable(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  status: SmsStatusSchema,
  carrier: z.string(),
  segments: z.number().int().positive(),
  deliveryLatencyMs: z.number().int().nonnegative(),
  createdAt: z.string(),
  error: z.string().optional(),
});

export const SmsSummaryMetricsSchema = z.object({
  totalSent24h: z.number().int().nonnegative(),
  deliveredCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  deliveryRatePct: z.number().min(0).max(100),
  avgLatencyMs: z.number().int().nonnegative(),
  carrierStatus: z.enum(['healthy', 'degraded']),
});

export const SmsSendRequestSchema = z.object({
  recipient: z.string().min(1),
  messageType: SmsMessageTypeSchema.optional().default('custom'),
  body: z.string().optional(),
  callLogId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  workspaceId: z.string().optional(),
});


// ==============================================================================
// 7. UNIVERSAL CALENDAR BOOKING SCHEMAS
// ==============================================================================
// Danish reception bookings are evaluated in Europe/Copenhagen, held for ten
// minutes while the caller is on the phone, then confirmed into whichever
// calendar the caller actually uses. The hold is the concurrency primitive: an
// unexpired hold on a slot makes it unavailable to everyone else.
// ==============================================================================

export const CalendarProviderSchema = z.enum([
  'google',
  'apple_icloud',
  'outlook',
  'calcom',
  'ics_universal',
]);

export const BookingStatusSchema = z.enum(['held', 'confirmed', 'expired', 'released']);

/** ISO instant. Kept as a string so the contract matches the wire format. */
const IsoInstantSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be an ISO-8601 instant')
  .refine((value) => /T.*(Z|[+-]\d{2}:\d{2})$/.test(value), 'Must carry an explicit offset');

/** Ten minutes, the optimistic hold window during a live call. */
export const SLOT_HOLD_SECONDS = 600;

export const BookingSlotSchema = z
  .object({
    id: z.string().min(1),
    startIso: IsoInstantSchema,
    endIso: IsoInstantSchema,
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
    localStart: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM'),
    localEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM'),
    durationMinutes: z.number().int().positive(),
    label: z.string().min(1),
    available: z.boolean(),
    blockedBy: z.enum(['booked', 'held', 'past']).optional(),
  })
  .superRefine((slot, ctx) => {
    const start = Date.parse(slot.startIso);
    const end = Date.parse(slot.endIso);
    if (end <= start) {
      ctx.addIssue({ code: 'custom', message: 'Slot must end after it starts', path: ['endIso'] });
      return;
    }
    const minutes = Math.round((end - start) / 60_000);
    if (minutes !== slot.durationMinutes) {
      ctx.addIssue({
        code: 'custom',
        message: 'durationMinutes must match the start/end instant',
        path: ['durationMinutes'],
      });
    }
    if (slot.localEnd <= slot.localStart) {
      ctx.addIssue({ code: 'custom', message: 'localEnd must be after localStart', path: ['localEnd'] });
    }
  });

export const SlotSlotQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(60).optional(),
  provider: CalendarProviderSchema.optional(),
});

export const SlotHoldRequestSchema = z.object({
  /** Absent on first enquiry; the workspace always comes from the session. */
  tenantId: z.string().uuid().optional(),
  contactId: z.string().uuid().nullish(),
  callLogId: z.string().uuid().nullish(),
  startIso: IsoInstantSchema,
  endIso: IsoInstantSchema,
  provider: CalendarProviderSchema.default('ics_universal'),
  /** Danish subject matter, echoed into the invitation. */
  topic: z.string().trim().min(2).max(180).default('Møde'),
  notes: z.string().trim().max(1000).default(''),
  holdSeconds: z.number().int().min(60).max(SLOT_HOLD_SECONDS * 3).default(SLOT_HOLD_SECONDS),
  /** Calendar connection handle for the owner's calendar, when configured. */
  calcomLink: z.string().url().optional(),
});

export const BookingConfirmationSchema = z.object({
  tenantId: z.string().uuid(),
  contactId: z.string().uuid().nullish(),
  callLogId: z.string().uuid().nullish(),
  startIso: IsoInstantSchema,
  endIso: IsoInstantSchema,
  provider: CalendarProviderSchema.default('ics_universal'),
  /** When present the hold is claimed; when absent the slot is checked fresh. */
  holdId: z.string().min(1).nullish(),
  attendeeName: z.string().trim().min(2).max(160),
  attendeeEmail: z.string().email().nullish(),
  attendeePhone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 format e.g. +4520123456')
    .nullish(),
  topic: z.string().trim().min(2).max(180).default('Møde'),
  notes: z.string().trim().max(1000).default(''),
  location: z.string().trim().max(240).default(''),
  calcomLink: z.string().url().optional(),
  /** Dispatch the Danish confirmation SMS after confirming. */
  sendSms: z.boolean().default(true),
});

export const BookingHoldRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  callLogId: z.string().uuid().nullable(),
  provider: CalendarProviderSchema,
  status: BookingStatusSchema,
  startIso: IsoInstantSchema,
  endIso: IsoInstantSchema,
  topic: z.string(),
  notes: z.string(),
  /** Instant the optimistic lock lapses; never extended retroactively. */
  expiresAtIso: IsoInstantSchema,
  /** Danish, e.g. `man. 18. nov. 08:00–08:30`. */
  label: z.string(),
  createdAtIso: IsoInstantSchema,
});

export const BookingRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  callLogId: z.string().uuid().nullable(),
  provider: CalendarProviderSchema,
  startIso: IsoInstantSchema,
  endIso: IsoInstantSchema,
  label: z.string(),
  topic: z.string(),
  attendeeName: z.string(),
  attendeeEmail: z.string().email().nullable(),
  attendeePhone: z.string().nullable(),
  /** RFC 5545 payload the booking was confirmed with. */
  icsUid: z.string().min(1),
  createdAtIso: IsoInstantSchema,
});

export const CalendarLinksSchema = z.object({
  google: z.string().url(),
  outlook: z.string().url(),
  apple: z.string().startsWith('data:text/calendar'),
  calcom: z.string().url(),
  webcal: z.string().startsWith('webcal://'),
});

export const SlotHoldResponseSchema = z.object({
  ok: z.literal(true),
  hold: BookingHoldRecordSchema,
  slot: BookingSlotSchema,
  /** Seconds remaining on the hold, as the caller's countdown. */
  expiresInSeconds: z.number().int().nonnegative(),
});

export const BookingConfirmationResponseSchema = z.object({
  ok: z.literal(true),
  booking: BookingRecordSchema,
  links: CalendarLinksSchema,
  sms: z
    .object({
      queued: z.boolean(),
      recipient: z.string().nullable(),
      body: z.string(),
    })
    .optional(),
});

export type CalendarProvider = z.infer<typeof CalendarProviderSchema>;
export type BookingStatus = z.infer<typeof BookingStatusSchema>;
export type BookingSlot = z.infer<typeof BookingSlotSchema>;
export type SlotSlotQuery = z.infer<typeof SlotSlotQuerySchema>;
export type SlotHoldRequest = z.infer<typeof SlotHoldRequestSchema>;
export type BookingConfirmation = z.infer<typeof BookingConfirmationSchema>;
export type BookingHoldRecord = z.infer<typeof BookingHoldRecordSchema>;
export type BookingRecord = z.infer<typeof BookingRecordSchema>;
export type CalendarLinks = z.infer<typeof CalendarLinksSchema>;
export type SlotHoldResponse = z.infer<typeof SlotHoldResponseSchema>;
export type BookingConfirmationResponse = z.infer<typeof BookingConfirmationResponseSchema>;

export type SmsMessageType = z.infer<typeof SmsMessageTypeSchema>;
export type SmsStatus = z.infer<typeof SmsStatusSchema>;
export type SmsDispatchRecord = z.infer<typeof SmsDispatchRecordSchema>;
export type SmsSummaryMetrics = z.infer<typeof SmsSummaryMetricsSchema>;
export type SmsSendRequest = z.infer<typeof SmsSendRequestSchema>;

// ==============================================================================
// 8. DIRECT AGENCY <-> CLIENT CHAT & CO-PILOT BRIDGE (trekants-kommunikation)
// ==============================================================================

/**
 * Strict actor identity for a three-way thread.
 *
 * The role is never inferred from a display name or a client-supplied string:
 * the server stamps it from the authenticated session, so a client cannot
 * impersonate the agency operator by posting `sender_role: 'agency_operator'`.
 */
export const SenderRoleSchema = z.enum(['agency_operator', 'client', 'ai_copilot']);
export type SenderRole = z.infer<typeof SenderRoleSchema>;

/** Chat channels. Reuses the channel vocabulary the rest of the app already uses. */
export const ChatChannelSchema = z.enum(['web_chat', 'whatsapp', 'voice_inbound', 'portal']);
export type ChatChannel = z.infer<typeof ChatChannelSchema>;

export const MessageKindSchema = z.enum(['message', 'delegation', 'system']);
export type MessageKind = z.infer<typeof MessageKindSchema>;

export const CopilotDelegationStatusSchema = z.enum([
  'pending', // created by the operator, awaiting dispatch
  'sent', // question delivered to the client
  'answered', // client replied; copilot has summarised
  'closed', // operator closed it out
]);
export type CopilotDelegationStatus = z.infer<typeof CopilotDelegationStatusSchema>;

export const AgencyClientMessageSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    /** Who wrote it. Stamped server-side from the session, never trusted from input. */
    senderRole: SenderRoleSchema,
    /** The user or contact id behind the role, for audit. Null for the copilot. */
    senderRef: z.string().uuid().nullable(),
    channel: ChatChannelSchema,
    kind: MessageKindSchema.default('message'),
    body: z.string().trim().min(1).max(4000),
    /** Set when this message belongs to a delegation thread. */
    delegationId: z.string().uuid().nullable(),
    attachments: z.array(z.record(z.string(), z.unknown())).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
    createdAt: z.string(),
  })
  .strict();
export type AgencyClientMessage = z.infer<typeof AgencyClientMessageSchema>;

/** Body the agency (or client) posts. Role is deliberately absent. */
export const PostChatMessageSchema = z
  .object({
    body: z.string().trim().min(1, 'Skriv en besked').max(4000, 'Beskeden er for lang'),
    kind: MessageKindSchema.default('message'),
    delegationId: z.string().uuid().nullish(),
    attachments: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  })
  .strict();
export type PostChatMessage = z.infer<typeof PostChatMessageSchema>;

/**
 * Operator instruction to the co-pilot, e.g.
 * "Spørg Hans om de tager opgaver i Roskilde".
 *
 * `instruction` is the raw Danish direction; `topic` is the short subject the
 * co-pilot may extract so the question can be generated and later matched to
 * the client's reply.
 */
export const CopilotDelegationRequestSchema = z
  .object({
    instruction: z.string().trim().min(4, 'Skriv en instruks til co-piloten').max(600),
    contactId: z.string().uuid().nullish(),
    channel: ChatChannelSchema.default('web_chat'),
    topic: z.string().trim().min(2).max(160).nullish(),
  })
  .strict();
export type CopilotDelegationRequest = z.infer<typeof CopilotDelegationRequestSchema>;

export const CopilotDelegationSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    contactId: z.string().uuid().nullable(),
    status: CopilotDelegationStatusSchema,
    /** The operator's original Danish instruction, kept verbatim for audit. */
    instruction: z.string(),
    topic: z.string().nullable(),
    /** The polite Danish question the co-pilot generated and sent. */
    question: z.string().nullable(),
    /** The client's reply, verbatim. */
    answer: z.string().nullable(),
    /** The co-pilot's Danish summary of the answer, for the operator. */
    summary: z.string().nullable(),
    /** True when the co-pilot detected the answer was not grounded in our data. */
    needsAgencyInput: z.boolean().default(false),
    createdAt: z.string(),
    resolvedAt: z.string().nullable(),
  })
  .strict();
export type CopilotDelegation = z.infer<typeof CopilotDelegationSchema>;

/**
 * A mutation the co-pilot wants to make, staged for human approval.
 *
 * Nothing here has been applied. `diff` is the human-readable before/after that
 * the operator approves; `apply` is the machine change. This is the only shape
 * in which the co-pilot may express a write.
 */
export const StagedMutationSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['pricing', 'business_hours', 'owner_contact', 'broadcast']),
    /** Danish, one line, e.g. "Pris for 'Tagrens' ændres fra 2.500 til 2.800 kr." */
    summary: z.string().min(1),
    diff: z.array(z.object({ field: z.string(), before: z.string(), after: z.string() })),
    requiresApproval: z.literal(true),
  })
  .strict();
export type StagedMutation = z.infer<typeof StagedMutationSchema>;

/**
 * Co-pilot intent classification.
 *
 * `ungrounded` is a first-class outcome: the question could not be answered from
 * the agency database. It is not an error and must never fall back to a guess.
 */
export const CopilotIntentSchema = z.enum([
  'metrics',
  'settings',
  'pricing',
  'delegation',
  'ungrounded',
  'smalltalk',
]);
export type CopilotIntent = z.infer<typeof CopilotIntentSchema>;

export const CopilotReplySchema = z
  .object({
    intent: CopilotIntentSchema,
    /** Danish reply text, ready to post. */
    body: z.string().min(1),
    /** Present when the intent was `settings`/`pricing`. Never applied automatically. */
    mutation: StagedMutationSchema.nullable().default(null),
    /** Present when the intent was `delegation`. */
    delegation: CopilotDelegationSchema.nullable().default(null),
    /**
     * True when the co-pilot could not ground the answer and says so. The body
     * then promises verification with the operator rather than inventing facts.
     */
    needsAgencyInput: z.boolean().default(false),
  })
  .strict();
export type CopilotReply = z.infer<typeof CopilotReplySchema>;

/** Per-tenant latch controlling automated replies. */
export const ChatStateSchema = z
  .object({
    tenantId: z.string().uuid(),
    aiEnabled: z.boolean().default(true),
    /** Why the latch is off, for the UI banner. */
    pausedReason: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strict();
export type ChatState = z.infer<typeof ChatStateSchema>;

export type AgencyClientMessageInput = z.infer<typeof AgencyClientMessageSchema>;
