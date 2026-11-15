/**
 * The inbound voice receptionist telephony bridge.
 *
 * Layout — the import graph only points one way, from `bridge.ts` down:
 *
 *   types.ts            the spine: session, language, latency budgets
 *   session-machine.ts  monotonic lifecycle + transcript window + capacity registry
 *   barge-in.ts         sub-150 ms interruption gating (pure, clock-injected)
 *   elevenlabs.ts       bilingual Conversational AI protocol + stale-audio gate
 *   calcom.ts           slot synchronisation and booking
 *   grounding.ts        tenant grounding: prompt rendering, DID routing, open hours
 *   livekit-room.ts     WebRTC room meaning: participants, tracks, data channel
 *   tenant-grounding.ts the only SQL (RLS-scoped reads + the call ledger)
 *   bridge.ts           the composition root the API routes call
 */

export * from './types';
export * from './session-machine';
export * from './barge-in';
export * from './session-control';
export * from './grounding';
export * from './calcom';
export {
  AudioTurnGate,
  BROWSER_AUDIO_PROFILE,
  TELEPHONY_AUDIO_PROFILE,
  buildInitiationFrame,
  decodeServerEvent,
  defaultTurnHandling,
  encodeClientEvent,
  isPlausibleBase64,
  mintSignedConversationUrl,
  resolveElevenLabsConfig,
  ElevenLabsConversation,
  type ElevenLabsClientEvent,
  type ElevenLabsConfig,
  type ElevenLabsServerEvent,
} from './elevenlabs';
export {
  AGENT_JOIN_TIMEOUT_MS,
  OWNER_JOIN_TIMEOUT_MS,
  TELEPHONY_DATA_TOPIC,
  agentParticipantIdentity,
  decodeRoomMessage,
  encodeRoomMessage,
  ownerParticipantIdentity,
  sipCallerIdentity,
  telephonyRoomName,
  LiveKitRoomOrchestrator,
  type RoomEventResult,
  type RoomOutboundMessage,
  type RoomStage,
} from './livekit-room';
export {
  bookingIdempotencyKey,
  buildSlotsUrl,
  parseSlotsPayload,
  subtractBusy,
  syncSlots,
  type CalComSlot,
  type SlotSyncResult,
} from './calcom';
export {
  bindLiveCall,
  bookCallSlotFromBridge,
  dispatchInboundCall,
  endInboundCall,
  endLiveCall,
  forgetLiveCall,
  liveCallBinding,
  liveCallSnapshot,
  recordTurnOnLiveCall,
  reportBargeInOnLiveCall,
  telephonyRegistry,
  type BargeInDescriptor,
  type BridgeDeps,
  type BridgeOutcome,
  type BridgeTelemetry,
  type CalendarDescriptor,
  type InboundDispatchInput,
  type LatencySource,
  type LiveCallBinding,
  type PersistContext,
  type SlotBookingResult,
  type TrunkLineProfile,
  type TurnReceipt,
  type VoiceDispatchDescriptor,
} from './bridge';
export {
  actingUserForTenant,
  countOpenCalls,
  loadGroundingForDialledNumber,
  loadTelephonyCallSession,
  loadTenantGrounding,
  resolveInboundTenantByDid,
  upsertTelephonyCallSession,
  type GroundingActor,
  type InboundTenantRecord,
  type LedgerRow,
} from './tenant-grounding';
export {
  BookSlotBodySchema,
  DispatchBodySchema,
  EndCallBodySchema,
  LineProfileSchema,
  SessionBargeInBodySchema,
  SessionControlSchema,
  SessionQuerySchema,
  SessionTurnBodySchema,
  TelephonySessionSchema,
  TelephonyTranscriptEntrySchema,
  type DispatchBody,
  type LineProfileInput,
  type SessionBargeInBody,
  type SessionControl,
  type SessionTurnBody,
  type TelephonyLanguageInput,
} from './contracts';
