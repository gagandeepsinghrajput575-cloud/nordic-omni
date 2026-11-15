import { z } from 'zod';

/**
 * Wire contracts for the telephony bridge.
 *
 * Two rules govern everything here.
 *
 * First, **the inbound body is permissive and the outbound shape is strict.** A
 * LiveKit SIP webhook is a machine posting fields this codebase does not control
 * (`sipCallID`, `trunk_region`, `participant_identity`, and whatever the carrier
 * adds next quarter), so the schema picks the fields it understands and discards
 * the rest rather than rejecting a live call over an unknown key. The response, by
 * contrast, is a contract the console and the agent worker both compile against.
 *
 * Second, **no tenant selector comes from the caller's side.** `did` /
 * `tr_sip_to` is the identity of the *line*, and that is the only thing allowed to
 * pick a tenant on a PSTN call. `tenantId` is accepted only from an authenticated
 * console request, and is re-checked against the session's own scope in the route —
 * never trusted because it parsed.
 */

export const TelephonyLanguageSchema = z.enum(['da-DK', 'en-GB']);
export type TelephonyLanguageInput = z.infer<typeof TelephonyLanguageSchema>;

export const TelephonySessionStatusSchema = z.enum([
  'connecting',
  'active',
  'transferring',
  'completed',
  'failed',
]);

export const TelephonyTranscriptEntrySchema = z.object({
  role: z.enum(['agent', 'caller']),
  text: z.string().min(1).max(4000),
  timestampMs: z.number().finite().nonnegative(),
});

export const TelephonySessionSchema = z.object({
  callId: z.string().min(1).max(120),
  tenantId: z.string().uuid(),
  callerNumber: z.string().min(1).max(32),
  language: TelephonyLanguageSchema,
  status: TelephonySessionStatusSchema,
  latencyMs: z.number().finite().nonnegative().max(600_000),
  transcript: z.array(TelephonyTranscriptEntrySchema),
});

export const RingBehaviourSchema = z.enum(['immediate', 'one-ring', 'two-rings']);
export const SipCodecSchema = z.enum(['PCMA', 'PCMU', 'OPUS', 'AMR-WB']);

/** The states an operator (or a webhook) may report for a call. */
export const InboundStateSchema = z.enum(['ringing', 'connected', 'completed', 'failed', 'missed']);

export const DispatchBodySchema = z.object({
  event: z.string().min(1).max(80).default('dispatch.simulate'),
  did: z.string().min(1).max(40).optional(),
  tr_sip_to: z.string().min(1).max(120).optional(),
  called_number: z.string().min(1).max(120).optional(),
  caller: z.string().min(1).max(120).optional(),
  tr_sip_from: z.string().min(1).max(120).optional(),
  caller_number: z.string().min(1).max(120).optional(),
  roomName: z.string().min(1).max(200).optional(),
  state: InboundStateSchema.default('connected'),
  /** Console-only: the operator is testing a specific workspace. */
  tenantId: z.string().uuid().optional(),
  language: TelephonyLanguageSchema.optional(),
  transcriptPreview: z.string().max(2000).optional(),
});

export type DispatchBody = z.infer<typeof DispatchBodySchema>;

/**
 * The line profile a console test bench may supply.
 *
 * A real SIP INVITE never carries these: the values come from the DID record. The
 * dial-in bench supplies them because an operator is deliberately testing "what
 * happens on a paused line" or "what does AMR-WB sound like", and the response must
 * reflect the answer rather than a default.
 */
export const LineProfileSchema = z.object({
  codec: SipCodecSchema.default('PCMA'),
  sampleRateHz: z.number().int().min(8000).max(48000).default(16000),
  ringBehavior: RingBehaviourSchema.default('one-ring'),
  jitterMs: z.number().finite().min(0).max(2000).default(6),
  packetLossPct: z.number().finite().min(0).max(100).default(0),
  status: z.enum(['active', 'paused', 'pool']).default('active'),
  dispatchRuleId: z.string().max(80).nullable().default(null),
  sipTrunkHost: z.string().min(1).max(200).default('sip.livekit.cloud'),
  sipUsername: z.string().min(1).max(200).default('omni'),
  forwardTo: z.string().max(40).nullable().default(null),
});

export type LineProfileInput = z.infer<typeof LineProfileSchema>;

export const DispatchRequestSchema = z.object({
  body: DispatchBodySchema,
  line: LineProfileSchema.nullable().optional(),
});

// -----------------------------------------------------------------------------
// Live-call control plane (`/api/telephony/session`)
// -----------------------------------------------------------------------------

export const SessionQuerySchema = z.object({
  callId: z.string().min(1).max(120),
  tenantId: z.string().uuid(),
});

export const EndCallBodySchema = z.object({
  callId: z.string().min(1).max(120),
  tenantId: z.string().uuid(),
  reason: z.enum(['hangup', 'caller_gave_up', 'call_failed', 'transferred']).default('hangup'),
  transcript: z.array(TelephonyTranscriptEntrySchema).max(400).default([]),
  latencyMs: z.number().finite().nonnegative().max(600_000).optional(),
});

export const BookSlotBodySchema = z.object({
  callId: z.string().min(1).max(120),
  tenantId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  language: TelephonyLanguageSchema.default('da-DK'),
  startIso: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(10).max(240).default(30),
  attendee: z.object({
    name: z.string().min(1).max(180),
    email: z.string().email().optional(),
    phone: z.string().min(6).max(32).optional(),
  }),
});

export const SessionTurnBodySchema = z.object({
  callId: z.string().min(1).max(120),
  tenantId: z.string().uuid(),
  /** The caller's words, or the agent's — the ledger keeps both sides. */
  role: z.enum(['agent', 'caller']),
  text: z.string().min(1).max(4000),
  /** Monotonic ms since the session origin, not a wall clock. */
  atMs: z.number().finite().nonnegative(),
  /** Round trip the reporter measured for this turn, when it can measure one. */
  measuredRoundTripMs: z.number().finite().min(0).max(600_000).optional(),
  language: TelephonyLanguageSchema.optional(),
});

/**
 * One interruption, as measured by whoever detected it.
 *
 * Deliberately small. The client supplies *when* the caller broke in and how loud
 * the echo guard had to work; `withinBudget`, the commit count and the worst case
 * are all recomputed server-side, because the party reporting a metric is never
 * allowed to grade it.
 */
export const SessionBargeInBodySchema = z.object({
  callId: z.string().min(1).max(120),
  tenantId: z.string().uuid(),
  /** Speech became unambiguous → agent audio actually stopped, in ms. */
  latencyMs: z.number().finite().min(0).max(600_000),
  path: z.enum(['sustained', 'double_talk', 'forced']).default('sustained'),
  /** Times the echo guard refused a candidate that never reached the commit stage. */
  echoGuardBlocks: z.number().int().min(0).max(100_000).optional(),
  atMs: z.number().finite().nonnegative().optional(),
});

/**
 * One body for every live-call control, discriminated on `action`.
 *
 * Each variant is built by *spreading* the schema above it rather than re-listing
 * fields, so the console and the bridge cannot drift: a field added to
 * `SessionBargeInBodySchema` is available on the wire in the same commit. Unknown keys
 * are stripped, not rejected — a client that sends `withinBudget`, a commit count, or
 * a `tenantId` for somebody else's call is asserting something this server computes,
 * and the answer is that the assertion never reaches the computation. A deploy where
 * the console is a day ahead of the bridge still works.
 */
export const SessionControlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('turn'), ...SessionTurnBodySchema.shape }),
  z.object({ action: z.literal('barge_in'), ...SessionBargeInBodySchema.shape }),
  z.object({ action: z.literal('end'), ...EndCallBodySchema.shape }),
  z.object({ action: z.literal('book'), ...BookSlotBodySchema.shape }),
]);

export type EndCallBody = z.infer<typeof EndCallBodySchema>;
export type SessionTurnBody = z.infer<typeof SessionTurnBodySchema>;
export type SessionBargeInBody = z.infer<typeof SessionBargeInBodySchema>;
export type BookSlotBody = z.infer<typeof BookSlotBodySchema>;
export type SessionControl = z.infer<typeof SessionControlSchema>;

/** What a browser may send as one caller-side turn. */
export const CallerTurnSchema = z.object({
  callId: z.string().min(1).max(120),
  tenantId: z.string().uuid(),
  text: z.string().min(1).max(4000),
  atMs: z.number().finite().nonnegative(),
});

export const TelephonySessionExportSchema = TelephonySessionSchema;
