import { AudioTurnGate, type ElevenLabsConversation } from './elevenlabs';
import { BargeInController, deriveBargeInPolicy, type BargeInCommit, type BargeInTelemetry } from './barge-in';
import { appendTurn, observeLatency, transitionTo, type TransitionResult } from './session-machine';
import {
  LATENCY_BUDGETS,
  SPEECH_TO_SPEECH_BUDGET_MS,
  roundTripOf,
  type LatencyBreakdown,
  type TelephonySession,
  type TelephonySessionStatus,
  type TelephonyTranscriptRole,
} from './types';

/**
 * The LiveKit room: one WebRTC room per call attempt, one SIP participant, one
 * agent participant, and this orchestrator as the only thing allowed to decide
 * what the room's state *means*.
 *
 * Room shape (mirrors `lib/livekit/policy.ts`, which owns the browser-side
 * identity rules): `${slug}_call_${subject}_${attempt}` — attempt-scoped, so a
 * retried call cannot reuse a room that still has a stale agent in it.
 *
 * Why an orchestrator rather than a bag of event handlers: the interesting call
 * failures are all cross-cutting. A caller who hears silence is either "waiting
 * for the agent", "the agent left", or "audio subscribed but muted by a barge-in
 * that never resolved" — and each needs a different user-visible outcome. Those
 * cannot be told apart from any single LiveKit event, only from the joint state of
 * participants, tracks and the interruption latch, which is exactly what this
 * class owns.
 */

export const TELEPHONY_DATA_TOPIC = 'nordic.telephony.v1';
export const LIVEKIT_SIP_PARTICIPANT_PREFIX = 'sip_';
export const LIVEKIT_AGENT_PARTICIPANT_PREFIX = 'agent-';
export const LIVEKIT_OWNER_PARTICIPANT_PREFIX = 'owner_';

/** Matches the browser: no agent audio inside this window means the call is not live. */
export const AGENT_JOIN_TIMEOUT_MS = 30_000;
/** How long a warm transfer waits for a human before handing the caller back. */
export const OWNER_JOIN_TIMEOUT_MS = 20_000;

export function telephonyRoomName(tenantSlug: string, callId: string): string {
  const slug =
    tenantSlug
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'tenant';
  // The call id already begins with `call_`, so the separator is only added when it
  // is missing: a room named `slug_call_call_…` is legal but makes every log line
  // and dispatch rule harder to read.
  // `newCallId()` already reads `call_<hhmmss>_<rand>`, so the separator is only
  // added when the id does not look like a call. Both spellings land on one room name,
  // which is what makes a replayed webhook idempotent instead of forking a call.
  const id = callId.trim().replace(/[^a-zA-Z0-9_-]+/gu, '-') || 'unknown';
  return id.startsWith('call') ? `${slug}_${id}` : `${slug}_call_${id}`;
}

export function sipCallerIdentity(callerNumber: string, attempt: string): string {
  const digits = callerNumber.replace(/\D/g, '').slice(-8) || 'anonymous';
  return `${LIVEKIT_SIP_PARTICIPANT_PREFIX}${digits}_${attempt}`;
}

export function agentParticipantIdentity(agentName: string): string {
  const normalised = agentName.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '-') || 'receptionist';
  return `${LIVEKIT_AGENT_PARTICIPANT_PREFIX}${normalised}`;
}

export function ownerParticipantIdentity(userId: string, attempt: string): string {
  return `${LIVEKIT_OWNER_PARTICIPANT_PREFIX}${userId.slice(0, 8)}_${attempt}`;
}

// -----------------------------------------------------------------------------
// Data-channel protocol
// -----------------------------------------------------------------------------

export interface RoomTranscriptMessage {
  readonly type: 'transcript';
  readonly role: TelephonyTranscriptRole;
  readonly text: string;
  readonly timestampMs: number;
  readonly language: string;
}

export interface RoomBargeInMessage {
  readonly type: 'barge_in';
  readonly latencyMs: number;
  readonly withinBudget: boolean;
  readonly path: BargeInCommit['path'];
  readonly atMs: number;
}

export interface RoomStateMessage {
  readonly type: 'session_state';
  readonly status: TelephonySessionStatus;
  readonly latencyMs: number;
  readonly roundTripBudgetMs: number;
  readonly agentListening: boolean;
}

export interface RoomTelemetryMessage {
  readonly type: 'telemetry';
  readonly sttMs: number;
  readonly llmFirstTokenMs: number;
  readonly ttsFirstByteMs: number;
  readonly roundTripMs: number;
  readonly budgetMs: number;
  readonly discardedAudioEvents: number;
  readonly overBudgetCommits: number;
}

export type RoomOutboundMessage =
  | RoomTranscriptMessage
  | RoomBargeInMessage
  | RoomStateMessage
  | RoomTelemetryMessage;

export type RoomInboundMessage =
  | { readonly type: 'caller_transcript'; readonly text: string }
  | { readonly type: 'request_transfer'; readonly reason: string }
  | { readonly type: 'end_call'; readonly reason: string | null };

export interface EncodedRoomMessage {
  readonly topic: string;
  readonly payload: string;
}

/** Inbound text cap: a participant must not be able to stream a novel into a room. */
const MAX_INBOUND_TEXT = 4_000;

export function encodeRoomMessage(message: RoomOutboundMessage): EncodedRoomMessage {
  return { topic: TELEPHONY_DATA_TOPIC, payload: JSON.stringify(message) };
}

/**
 * Strict decode. The room's data channel is reachable by any participant the token
 * admitted, so a malformed or unexpected frame is dropped rather than trusted.
 */
export function decodeRoomMessage(raw: string): RoomInboundMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  switch (record.type) {
    case 'caller_transcript': {
      if (typeof record.text !== 'string') return null;
      const text = record.text.trim();
      // An empty transcript is not a turn, and a long one is a channel-flooding
      // attempt; both are dropped at the boundary rather than downstream.
      if (!text || text.length > MAX_INBOUND_TEXT) return null;
      return { type: 'caller_transcript', text };
    }
    case 'request_transfer':
      return typeof record.reason === 'string' ? { type: 'request_transfer', reason: record.reason } : null;
    case 'end_call':
      return { type: 'end_call', reason: typeof record.reason === 'string' ? record.reason : null };
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Room state
// -----------------------------------------------------------------------------

export type RoomStage =
  | 'empty'
  | 'waiting_for_agent'
  | 'live'
  | 'interrupted'
  | 'transferring'
  | 'degraded'
  | 'closed';

export interface RoomDeps {
  readonly publishMessage: (message: EncodedRoomMessage) => void;
  /**
   * Stop the caller hearing anything, right now. Called *before* the provider turn
   * is cut, and it must be synchronous: a mute that waits a frame is a frame of
   * the agent talking over the caller, which is the exact thing being prevented.
   */
  readonly muteAgentAudio: () => void;
  readonly unmuteAgentAudio: () => void;
  readonly now: () => number;
}

export interface OrchestratorConfig {
  readonly vadThreshold: number;
  readonly bargeInSensitivity: number;
  readonly echoTailMs?: number;
  readonly agentTimeoutMs?: number;
  readonly ownerTimeoutMs?: number;
}

export interface RoomEventResult {
  readonly changed: boolean;
  readonly session: TelephonySession;
  readonly stage: RoomStage;
  readonly transition: TransitionResult | null;
}

/**
 * The bridge's room-side brain.
 *
 * It never owns a socket. The caller — the agent worker, or the browser hook —
 * forwards LiveKit events in and carries out the side effects it publishes, so one
 * policy runs identically on the server and in the page. That symmetry is the
 * point: a barge-in budget measured in the browser and enforced by the worker is
 * two budgets, and the caller only experiences one of them.
 */
export class LiveKitRoomOrchestrator {
  private session: TelephonySession;
  private stage: RoomStage = 'empty';
  private readonly gate = new AudioTurnGate();
  private readonly bargeIn: BargeInController;
  private readonly conversation: ElevenLabsConversation | null;
  private readonly agentTimeoutMs: number;
  private readonly ownerTimeoutMs: number;
  private callerPublished = false;
  private agentSubscribed = false;
  private agentSpeaking = false;
  private ownerPresent = false;
  private mutedByBargeIn = false;
  private lastInterruptAtMs = 0;
  private agentJoinedAtMs: number | null = null;
  private ownerRequestedAtMs: number | null = null;
  private readyAtMs = 0;
  private lastRoundTrip: LatencyBreakdown = { ...LATENCY_BUDGETS };
  private closedReason: string | null = null;
  private interrupts = 0;
  private lastAudioEventId = 0;

  constructor(
    session: TelephonySession,
    private readonly room: RoomDeps,
    config: OrchestratorConfig,
    conversation: ElevenLabsConversation | null = null,
  ) {
    this.session = session;
    this.agentTimeoutMs = positiveOr(config.agentTimeoutMs, AGENT_JOIN_TIMEOUT_MS);
    this.ownerTimeoutMs = positiveOr(config.ownerTimeoutMs, OWNER_JOIN_TIMEOUT_MS);
    this.bargeIn = new BargeInController({
      policy: deriveBargeInPolicy({
        vadThreshold: config.vadThreshold,
        bargeInSensitivity: config.bargeInSensitivity,
        ...(config.echoTailMs === undefined ? {} : { echoTailMs: config.echoTailMs }),
      }),
      onCommit: (commit) => {
        this.onBargeInCommit(commit);
      },
    });
    this.conversation = conversation;
  }

  get currentStage(): RoomStage {
    return this.stage;
  }

  get currentSession(): TelephonySession {
    return this.session;
  }

  get bargeInTelemetry(): BargeInTelemetry {
    return this.bargeIn.telemetry();
  }

  // --- LiveKit event surface ---------------------------------------------------

  onParticipantJoined(identity: string, atMs = this.room.now()): RoomEventResult {
    if (identity.startsWith(LIVEKIT_AGENT_PARTICIPANT_PREFIX)) {
      this.agentJoinedAtMs = atMs;
      return this.setStage('waiting_for_agent', false);
    }
    if (identity.startsWith(LIVEKIT_OWNER_PARTICIPANT_PREFIX)) {
      this.ownerPresent = true;
      this.ownerRequestedAtMs = null;
      // A human answered: the session returns to `active` (the only legal move out
      // of `transferring` that is not `completed`) so the agent stops answering.
      return this.advance('active', 'live');
    }
    return this.setStage(this.stage, false);
  }

  onParticipantLeft(identity: string): RoomEventResult {
    if (identity.startsWith(LIVEKIT_AGENT_PARTICIPANT_PREFIX)) {
      this.agentSubscribed = false;
      this.agentSpeaking = false;
      this.agentJoinedAtMs = null;
      // The agent leaving mid-call is a *failed* call, not a silent one. A caller
      // held in an empty room for two minutes is the worst outcome available.
      return this.advance('failed', 'degraded');
    }
    if (identity.startsWith(LIVEKIT_OWNER_PARTICIPANT_PREFIX)) {
      this.ownerPresent = false;
      return this.advance('active', 'live');
    }
    // The caller hung up on us.
    return this.advance('completed', 'closed');
  }

  onCallerAudioPublished(published: boolean): RoomEventResult {
    this.callerPublished = published;
    return this.refreshConnectivity();
  }

  onAgentAudioSubscribed(subscribed: boolean): RoomEventResult {
    this.agentSubscribed = subscribed;
    if (!subscribed) {
      this.agentSpeaking = false;
      this.bargeIn.endAgentTurn(this.room.now());
    }
    return this.refreshConnectivity();
  }

  /**
   * One frame of caller-side loudness. Returns the commit when a barge-in
   * happened, so a browser can update its meter without another round trip.
   */
  onCallerLevel(atMs: number, rms: number): BargeInCommit | null {
    const event = this.bargeIn.push({ atMs, rms });
    return event.type === 'committed' ? event.commit : null;
  }

  onAgentLevelChanged(speaking: boolean, atMs = this.room.now()): void {
    if (speaking === this.agentSpeaking) return;
    this.agentSpeaking = speaking;
    if (speaking) {
      this.bargeIn.beginAgentTurn(atMs);
      if (this.mutedByBargeIn) {
        this.mutedByBargeIn = false;
        this.room.unmuteAgentAudio();
      }
      this.setStage('live', false);
      return;
    }
    this.bargeIn.endAgentTurn(atMs);
    this.conversation?.finishTurn();
  }

  /** Caller speech that has already been transcribed (typed chat, DTMF, worker VAD). */
  onCallerTranscript(text: string, atMs = this.room.now()): RoomEventResult {
    const added = appendTurn(this.session, 'caller', text, atMs - this.session.startedAtMs);
    if (added.appended) this.session = added.session;
    return this.setStage(this.stage, added.appended);
  }

  onAgentText(text: string, atMs = this.room.now()): RoomEventResult {
    const added = appendTurn(this.session, 'agent', text, atMs - this.session.startedAtMs);
    if (!added.appended) return this.setStage(this.stage, false);
    this.session = added.session;

    const measured = this.conversation?.finishTurn();
    const firstByte = measured ? measured.firstAudioByteMs : null;
    if (firstByte !== null) this.session = observeLatency(this.session, firstByte);

    this.publishMessage({
      type: 'transcript',
      role: 'agent',
      text,
      timestampMs: atMs - this.session.startedAtMs,
      language: this.session.language,
    });
    this.publishTelemetry();
    return this.setStage('live', true);
  }

  onInboundMessage(raw: string, atMs = this.room.now()): RoomEventResult {
    const message = decodeRoomMessage(raw);
    if (!message) return this.setStage(this.stage, false);
    switch (message.type) {
      case 'caller_transcript':
        return this.onCallerTranscript(message.text, atMs);
      case 'request_transfer':
        return this.requestTransfer(message.reason);
      case 'end_call':
        return this.close(message.reason ?? 'caller_hangup');
    }
  }

  // --- Warm transfer -----------------------------------------------------------

  /**
   * Ask for a human. The session moves to `transferring` immediately, which is what
   * stops the agent from continuing to answer while the owner's phone rings. If
   * nobody joins, `tick()` hands the call back rather than leaving the caller in a
   * room with no one in it.
   */
  requestTransfer(reason: string): RoomEventResult {
    this.ownerRequestedAtMs = this.room.now();
    const result = this.advance('transferring', 'transferring');
    this.publishMessage({
      type: 'session_state',
      status: this.session.status,
      latencyMs: this.session.latencyMs,
      roundTripBudgetMs: SPEECH_TO_SPEECH_BUDGET_MS,
      agentListening: false,
    });
    void reason;
    return result;
  }

  /** Called on a timer by whoever owns the room: enforces both join deadlines. */
  tick(nowMs = this.room.now()): RoomEventResult {
    if (this.stage === 'closed') return this.setStage('closed', false);

    if (this.ownerRequestedAtMs !== null && !this.ownerPresent) {
      if (nowMs - this.ownerRequestedAtMs >= this.ownerTimeoutMs) {
        this.ownerRequestedAtMs = null;
        return this.advance('active', 'live');
      }
    }

    if (this.stage === 'waiting_for_agent' && this.agentJoinedAtMs === null) {
      if (nowMs - this.readyAtMs >= this.agentTimeoutMs) {
        return this.advance('failed', 'degraded');
      }
    }
    return this.setStage(this.stage, false);
  }

  // --- Interruption ------------------------------------------------------------

  /**
   * Commit a barge-in from outside the energy detector (a worker-side VAD, a
   * hardware key press). Still measured by the controller, so a forced commit is
   * metered identically to a detected one.
   */
  forceInterrupt(atMs = this.room.now()): BargeInCommit | null {
    const event = this.bargeIn.forceCommit(atMs);
    return event.type === 'committed' ? event.commit : null;
  }

  /** Forward one agent audio frame; stale frames are dropped, never queued. */
  onAgentAudioChunk(audioBase64: string, eventId: number): boolean {
    this.lastAudioEventId = Math.max(this.lastAudioEventId, eventId);
    if (this.mutedByBargeIn) return false;
    return audioBase64.length > 0 && this.gate.accept(eventId);
  }

  /** Commit the interrupt the provider reported, keeping the local latch in step. */
  onProviderInterruption(eventId: number | null): void {
    if (eventId !== null) this.gate.interruptAt(eventId);
    this.mutedByBargeIn = false;
    this.room.unmuteAgentAudio();
    this.setStage('live', false);
  }

  // --- Close -------------------------------------------------------------------

  /**
   * Ordered teardown: conversation first (so nothing further is synthesised for a
   * caller who has gone), then the interruption latch, then the session's terminal
   * state, then one final state message. A consumer that only calls `close()`
   * cannot leave a half-open provider session behind.
   */
  close(reason: string): RoomEventResult {
    if (this.stage === 'closed') return this.setStage('closed', false);
    this.conversation?.close(reason);
    this.room.muteAgentAudio();
    this.mutedByBargeIn = false;
    this.callerPublished = false;
    this.agentSubscribed = false;
    this.agentSpeaking = false;
    this.closedReason = reason;

    const result = this.advance(reason === 'call_failed' ? 'failed' : 'completed', 'closed');
    this.publishMessage({
      type: 'session_state',
      status: this.session.status,
      latencyMs: this.session.latencyMs,
      roundTripBudgetMs: SPEECH_TO_SPEECH_BUDGET_MS,
      agentListening: false,
    });
    return result;
  }

  get closedBy(): string | null {
    return this.closedReason;
  }

  snapshot(): {
    stage: RoomStage;
    callerPublished: boolean;
    agentSubscribed: boolean;
    ownerPresent: boolean;
    muted: boolean;
    interrupts: number;
    lastInterruptAtMs: number;
  } {
    return {
      stage: this.stage,
      callerPublished: this.callerPublished,
      agentSubscribed: this.agentSubscribed,
      ownerPresent: this.ownerPresent,
      muted: this.mutedByBargeIn,
      interrupts: this.interrupts,
      lastInterruptAtMs: this.lastInterruptAtMs,
    };
  }

  /** Measured stage cost, against the streaming budget rather than a guess. */
  reportStageLatency(stage: keyof LatencyBreakdown, measuredMs: number): void {
    if (!Number.isFinite(measuredMs) || measuredMs < 0) return;
    const rounded = Math.round(measuredMs);
    this.lastRoundTrip = { ...this.lastRoundTrip, [stage]: rounded };
    if (stage === 'ttsFirstByteMs') this.session = observeLatency(this.session, rounded);
    this.publishTelemetry();
  }

  // --- Internals ---------------------------------------------------------------

  /**
   * A call is live only when *both* directions are proven: the caller's audio is
   * published and the agent's audio is subscribed. Anything less stays
   * `waiting_for_agent`, which the UI renders as "connecting" and never as a live
   * call — the single most important lie this codebase refuses to tell.
   */
  private refreshConnectivity(): RoomEventResult {
    if (!this.callerPublished || !this.agentSubscribed) {
      this.readyAtMs = this.room.now();
      if (this.stage === 'live' || this.stage === 'interrupted') {
        return this.setStage('degraded', false);
      }
      return this.setStage('waiting_for_agent', false);
    }
    const result = this.advance('active', 'live');
    this.publishMessage({
      type: 'session_state',
      status: this.session.status,
      latencyMs: this.session.latencyMs,
      roundTripBudgetMs: SPEECH_TO_SPEECH_BUDGET_MS,
      agentListening: true,
    });
    this.publishTelemetry();
    return result;
  }

  private advance(
    to: TelephonySessionStatus,
    nextStage: RoomStage,
  ): RoomEventResult {
    const transition = transitionTo(this.session, to);
    if (!transition.ok) {
      if (to === 'failed') this.setStage('degraded', false);
      return {
        changed: false,
        session: this.session,
        stage: this.stage,
        transition,
      };
    }
    this.session = transition.session;
    const changed = this.setStage(nextStage, false).changed;
    if (nextStage === 'live') this.readyAtMs = this.room.now();
    return { changed, session: this.session, stage: this.stage, transition };
  }

  private setStage(stage: RoomStage, changed: boolean): RoomEventResult {
    const moved = this.stage !== stage;
    this.stage = stage;
    return {
      changed: changed || moved,
      session: this.session,
      stage: this.stage,
      transition: null,
    };
  }

  private onBargeInCommit(commit: BargeInCommit): void {
    this.interrupts += 1;
    this.lastInterruptAtMs = commit.committedAtMs;
    this.mutedByBargeIn = true;
    // Order matters, and it is the whole point: silence the sink *first*, then cut
    // the provider's turn. The caller's ear only ever receives the mute.
    this.room.muteAgentAudio();
    this.gate.interruptAt(this.lastAudioEventId);
    this.conversation?.interrupt();
    this.publishMessage({
      type: 'barge_in',
      latencyMs: commit.latencyMs,
      withinBudget: commit.withinBudget,
      path: commit.path,
      atMs: commit.committedAtMs - this.session.startedAtMs,
    });
    this.session = observeLatency(this.session, commit.latencyMs);
    this.stage = 'interrupted';
  }

  private publishMessage(message: RoomOutboundMessage): void {
    this.room.publishMessage(encodeRoomMessage(message));
  }

  private publishTelemetry(): void {
    const { overBudget } = this.bargeInTelemetry;
    this.publishMessage({
      type: 'telemetry',
      sttMs: this.lastRoundTrip.sttMs,
      llmFirstTokenMs: this.lastRoundTrip.llmFirstTokenMs,
      ttsFirstByteMs: this.lastRoundTrip.ttsFirstByteMs,
      roundTripMs: roundTripOf(this.lastRoundTrip),
      budgetMs: SPEECH_TO_SPEECH_BUDGET_MS,
      discardedAudioEvents: this.gate.stats().discarded,
      overBudgetCommits: overBudget,
    });
  }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}
