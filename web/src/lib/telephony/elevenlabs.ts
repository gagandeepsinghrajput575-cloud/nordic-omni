import type { TelephonyLanguage } from './types';
import { isDanish } from './types';

/**
 * ElevenLabs Conversational AI — the synthesizer side of the bridge.
 *
 * The bridge speaks the provider's realtime protocol, it does not wrap an SDK:
 * the wire is a single WebSocket carrying base64 PCM in both directions, and the
 * interesting behaviour (whose turn is it, and what should be thrown away) is
 * entirely about ordering events on that socket.
 *
 * **Endpoint.** `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=…`. A
 * browser cannot put `xi-api-key` on a WebSocket handshake, so the server mints a
 * short-lived signed URL through `get_signed_url` and hands *that* to the room
 * participant. `mintSignedConversationUrl` is that call, with the fetch
 * implementation injected so it can be exercised without leaving the process.
 *
 * **Client → orchestrator.** The complete union the platform accepts:
 * `pong`, `user_audio_chunk`, `user_message`, `contextual_update`, `feedback`,
 * `client_tool_result`, `user_activity`, `conversation_initiation_client_data`.
 * There is deliberately no "flush audio / end of turn" client message — the
 * provider's own VAD closes a turn on the audio→silence transition, which is why
 * `pushCallerAudio` keeps a silence cadence rather than trying to signal an end.
 *
 * **Orchestrator → client.** `conversation_initiation_metadata`, `audio`,
 * `agent_response`, `agent_response_correction`, `user_transcript`,
 * `interruption`, `vad_score`, `ping`, `client_error`.
 *
 * **Bilingual.** One agent handles both languages; what the bridge overrides per
 * turn is `language`, `first_message` and the grounded prompt. A mid-call switch
 * is a `contextual_update` plus a flushed audio queue, because the audio already
 * in flight is in the language the caller has just left.
 */

export const ELEVENLABS_DEFAULT_BASE_URL = 'https://api.elevenlabs.io/v1';
export const ELEVENLABS_CONVERSATION_PATH = '/convai/conversation';
export const ELEVENLABS_SIGNED_URL_PATH = '/convai/conversation/get_signed_url';
export const ELEVENLABS_API_KEY_HEADER = 'xi-api-key';

/** Signed URLs are single-use and expire in ~60 s; do not cache them. */
export const SIGNED_URL_TTL_MS = 55_000;

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export interface ElevenLabsEnvironment {
  readonly ELEVENLABS_API_KEY?: string;
  readonly ELEVENLABS_BASE_URL?: string;
  readonly ELEVENLABS_AGENT_ID?: string;
  readonly ELEVENLABS_AGENT_ID_EN?: string;
  readonly ELEVENLABS_VOICE_ID?: string;
}

export interface ElevenLabsAudioProfile {
  /**
   * `pcm_16000` is the telephony render: G.711 at 8 kHz upstream loses every
   * consonant above 3.4 kHz, so a 48 kHz Opus render just wastes a resampler.
   */
  readonly outputSampleRateHz: number;
  readonly inputSampleRateHz: number;
  readonly channels: 1 | 2;
}

export const TELEPHONY_AUDIO_PROFILE: ElevenLabsAudioProfile = {
  outputSampleRateHz: 16000,
  inputSampleRateHz: 16000,
  channels: 1,
};

export const BROWSER_AUDIO_PROFILE: ElevenLabsAudioProfile = {
  outputSampleRateHz: 48000,
  inputSampleRateHz: 48000,
  channels: 1,
};

export type ElevenLabsConfig =
  | {
      readonly configured: false;
      readonly reason: 'missing_api_key' | 'missing_agent_id';
      readonly message: string;
      readonly baseUrl: string;
    }
  | {
      readonly configured: true;
      readonly apiKey: string;
      readonly baseUrl: string;
      readonly agentId: string;
      readonly voiceId: string | null;
      readonly audio: ElevenLabsAudioProfile;
    };

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A tenant may pin its own agent; the environment agent is the agency default.
 * English-only callers can be routed to a dedicated agent when the operator has
 * provisioned one, which is the only honest way to "switch language" for a
 * tenant whose Danish agent is not tuned for English back-channels.
 */
export function resolveElevenLabsConfig(
  environment: ElevenLabsEnvironment,
  options: {
    readonly language?: TelephonyLanguage;
    readonly tenantAgentId?: string | null;
    readonly tenantVoiceId?: string | null;
    readonly audio?: ElevenLabsAudioProfile;
  } = {},
): ElevenLabsConfig {
  const baseUrl = trimmed(environment.ELEVENLABS_BASE_URL) || ELEVENLABS_DEFAULT_BASE_URL;
  const apiKey = trimmed(environment.ELEVENLABS_API_KEY);
  if (!apiKey) {
    return {
      configured: false,
      reason: 'missing_api_key',
      baseUrl,
      message:
        'ELEVENLABS_API_KEY is not set. The receptionist falls back to the browser speech synthesiser; no conversation is claimed.',
    };
  }

  const language = options.language ?? 'da-DK';
  const preferred =
    language === 'en-GB' ? trimmed(environment.ELEVENLABS_AGENT_ID_EN) : '';
  const agentId =
    trimmed(options.tenantAgentId) || preferred || trimmed(environment.ELEVENLABS_AGENT_ID);
  if (!agentId) {
    return {
      configured: false,
      reason: 'missing_agent_id',
      baseUrl,
      message:
        'No ElevenLabs agent is provisioned for this tenant. Add ELEVENLABS_AGENT_ID, or set an agent on the workspace, before live conversations.',
    };
  }

  return {
    configured: true,
    apiKey,
    baseUrl,
    agentId,
    voiceId: trimmed(options.tenantVoiceId) || null,
    audio: options.audio ?? TELEPHONY_AUDIO_PROFILE,
  };
}

export function conversationUrl(
  config: Extract<ElevenLabsConfig, { configured: true }>,
  agentId: string = config.agentId,
): string {
  const base = config.baseUrl.replace(/\/+$/u, '').replace(/^http/u, 'ws');
  return `${base}${ELEVENLABS_CONVERSATION_PATH}?agent_id=${encodeURIComponent(agentId)}`;
}

// -----------------------------------------------------------------------------
// Wire protocol: client → provider
// -----------------------------------------------------------------------------

export interface ConversationGrounding {
  readonly tenantName: string;
  readonly agentName: string;
  readonly systemPrompt: string;
  readonly greeting: string;
  readonly escalationPhone: string;
  readonly knowledgeCount: number;
  readonly timezone: string;
}

export interface TurnHandling {
  /** Silence that ends the caller's turn. Lower is snappier, chattier is safer. */
  readonly endOfTurnMs: number;
  /** Idle timeout before the receptionist offers to call back. */
  readonly idlePromptAfterMs: number;
  /** Whether the provider's own VAD may cut the agent off. */
  readonly allowInterruptions: boolean;
  /** Barge-in sensitivity in the provider's 0..1 domain. */
  readonly bargeInSensitivity: number;
}

export interface ConversationOverrides {
  readonly language: TelephonyLanguage;
  readonly grounding: ConversationGrounding;
  readonly voiceId: string | null;
  readonly turnHandling: TurnHandling;
  readonly outputSampleRateHz: number;
}

/** The provider's `language` field for our two supported locales. */
export function providerLanguage(language: TelephonyLanguage): string {
  return language;
}

export function defaultTurnHandling(bargeInSensitivity: number): TurnHandling {
  const sensitivity = Math.min(100, Math.max(0, Math.round(bargeInSensitivity || 0)));
  return {
    // 700 ms of trailing silence is the receptionist-appropriate compromise: short
    // enough that a pause does not look like a hang-up, long enough that a caller
    // reading out a CPR number mid-sentence is not cut off.
    endOfTurnMs: Math.round(820 - sensitivity * 1.6),
    idlePromptAfterMs: 12_000,
    allowInterruptions: true,
    bargeInSensitivity: Number((sensitivity / 100).toFixed(3)),
  };
}

export type ElevenLabsClientEvent =
  | { readonly type: 'pong'; readonly event_id: number }
  | { readonly user_audio_chunk: string }
  | { readonly type: 'user_message'; readonly text: string }
  | {
      readonly type: 'contextual_update';
      readonly context: { readonly type: 'text'; readonly text: string };
    }
  | { readonly type: 'user_activity' }
  | {
      readonly type: 'client_tool_result';
      readonly tool_call_id: string;
      readonly error?: string;
      result?: unknown;
    }
  | {
      readonly type: 'feedback';
      readonly conversation_id: string;
      readonly source: string;
      readonly feedback: 'like' | 'dislike';
    }
  | {
      readonly type: 'conversation_initiation_client_data';
      conversation_config_override?: ConversationConfigOverride;
      dynamic_variables?: { readonly [name: string]: string };
    };

export interface ConversationConfigOverride {
  /**
   * Server VAD decides the end of a turn. With it off, "the caller has finished"
   * is a timeout guess, and a guess costs 700 ms of dead air on every turn — which
   * is also the number a barge-in budget has to fit inside.
   */
  readonly vad_and_end_of_turn_enabled?: boolean;
  /** Trailing silence treated as end-of-turn, in ms. */
  readonly end_of_turn_candidate_end_timeout_ms?: number;
  /** Turn-level handling, at the root as well as under `agent_override`. */
  readonly turn_handling?: {
    readonly turn_timeout_ms?: number;
    readonly stop_speech_allow_interruptions?: boolean;
  };
  readonly agent_override?: {
    readonly first_message?: string;
    readonly language?: string;
    readonly prompt?: { readonly prompt?: string };
    readonly voice?: { readonly voice_id?: string };
    readonly turn_handling?: {
      readonly turn_timeout_ms?: number;
      readonly stop_speech_allow_interruptions?: boolean;
    };
  };
  readonly tts_override?: {
    readonly model_id?: string;
    /** The voice is a TTS property: `tts_override.voice_id` is what the API reads. */
    readonly voice_id?: string;
    readonly voice_settings?: {
      readonly stability?: number;
      readonly similarity_boost?: number;
      readonly speed?: number;
    };
  };
  readonly client_events?: readonly string[];
}

/**
 * Pure on purpose: the initiation frame is the single place the tenant's grounding,
 * the caller's language and the barge-in policy meet, so it is asserted directly
 * rather than through a socket.
 */
export function buildInitiationFrame(
  overrides: ConversationOverrides,
  dynamicVariables: Record<string, string> = {},
): Extract<ElevenLabsClientEvent, { type: 'conversation_initiation_client_data' }> {
  const danish = isDanish(overrides.language);
  const turn = overrides.turnHandling;

  return {
    type: 'conversation_initiation_client_data',
    conversation_config_override: {
      // Server VAD owns end-of-turn. There is no client event that says "I am
      // finished", so any other arrangement is a timeout guess — and the guess is
      // what a caller hears as dead air before the receptionist replies.
      vad_and_end_of_turn_enabled: true,
      end_of_turn_candidate_end_timeout_ms: turn.endOfTurnMs,
      turn_handling: {
        turn_timeout_ms: turn.endOfTurnMs,
        stop_speech_allow_interruptions: turn.allowInterruptions,
      },
      agent_override: {
        first_message: overrides.grounding.greeting,
        language: providerLanguage(overrides.language),
        prompt: {
          prompt: [
            overrides.grounding.systemPrompt,
            danish
              ? 'Svar på dansk. Skift til engelsk i det øjeblik calleren gør, og bliv i engelsk.'
              : 'Answer in English. Switch to Danish the moment the caller does, and stay in Danish.',
            `Escalation number for a human: ${overrides.grounding.escalationPhone}.`,
            `Grounded knowledge items available: ${overrides.grounding.knowledgeCount}. Never invent prices, availability or clinical advice.`,
          ].join('\n\n'),
        },
        ...(overrides.voiceId
          ? { voice: { voice_id: overrides.voiceId } }
          : {}),
        turn_handling: {
          turn_timeout_ms: turn.endOfTurnMs,
          stop_speech_allow_interruptions: turn.allowInterruptions,
        },
      },
      tts_override: {
        ...(overrides.voiceId ? { voice_id: overrides.voiceId } : {}),
        voice_settings: {
          // Slightly steady and slightly fast: a receptionist should not emote, and
          // a 2 % faster render buys back a couple of the 150 ms we are spending on
          // the interruption budget.
          stability: 0.42,
          similarity_boost: 0.78,
          speed: danish ? 1.02 : 1,
        },
      },
      client_events: [
        'conversation_initiation_metadata',
        'audio',
        'agent_response',
        'agent_response_correction',
        'user_transcript',
        'interruption',
        'vad_score',
      ],
    },
    // The agent id is a URL query parameter. Putting it in the frame is a protocol
    // error, and `dynamic_variables` is the only place this frame may carry
    // per-call context.
    dynamic_variables: {
      tenant: overrides.grounding.tenantName,
      agent_name: overrides.grounding.agentName,
      timezone: overrides.grounding.timezone,
      output_sample_rate: String(overrides.outputSampleRateHz),
      ...dynamicVariables,
    },
  };
}

export function encodeClientEvent(event: ElevenLabsClientEvent): string {
  return JSON.stringify(event);
}

// -----------------------------------------------------------------------------
// Wire protocol: provider → client
// -----------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export type ElevenLabsServerEvent =
  | {
      readonly type: 'initiation_metadata';
      readonly conversationId: string;
      readonly outputFormat: string | null;
    }
  | { readonly type: 'audio'; readonly eventId: number; readonly audioBase64: string }
  | { readonly type: 'agent_response'; readonly text: string }
  | { readonly type: 'agent_response_correction'; readonly text: string; readonly original: string }
  | { readonly type: 'user_transcript'; readonly text: string }
  | { readonly type: 'interruption'; readonly eventId: number | null; readonly reason: string | null }
  | { readonly type: 'vad_score'; readonly score: number | null; readonly speaking: boolean }
  | { readonly type: 'ping'; readonly eventId: number; readonly replyAfterMs: number }
  | { readonly type: 'conversation_end'; readonly transcript: string | null }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'ignored' };

export function decodeServerEvent(raw: string): ElevenLabsServerEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: 'error', message: 'Malformed provider frame' };
  }
  const root = asRecord(parsed);
  if (!root) return { type: 'error', message: 'Provider frame was not an object' };

  switch (readString(root, 'type')) {
    case 'conversation_initiation_metadata':
    case 'conversation_metadata': {
      return {
        type: 'initiation_metadata',
        conversationId: readString(root, 'conversation_id') ?? '',
        outputFormat: readString(root, 'agent_output_audio_format'),
      };
    }
    case 'audio': {
      const event = asRecord(root.audio_event) ?? root;
      const audioBase64 = readString(event, 'audio_base_64') ?? readString(event, 'chunk') ?? '';
      const eventId = readNumber(event, 'event_id') ?? readNumber(root, 'event_id');
      if (!audioBase64) return { type: 'ignored' };
      return { type: 'audio', eventId: eventId ?? 0, audioBase64 };
    }
    case 'agent_response': {
      const event = asRecord(root.agent_response_event) ?? root;
      return { type: 'agent_response', text: readString(event, 'agent_response') ?? '' };
    }
    case 'agent_response_correction': {
      const event = asRecord(root.agent_response_correction_event) ?? root;
      return {
        type: 'agent_response_correction',
        text: readString(event, 'corrected_agent_response') ?? '',
        original: readString(event, 'original_agent_response') ?? '',
      };
    }
    case 'user_transcript': {
      const event = asRecord(root.user_transcription_event) ?? root;
      return { type: 'user_transcript', text: readString(event, 'user_transcript') ?? '' };
    }
    case 'interruption': {
      const event = asRecord(root.interruption_event) ?? root;
      return {
        type: 'interruption',
        eventId: readNumber(event, 'event_id'),
        reason: readString(event, 'reason'),
      };
    }
    case 'vad_score': {
      const event = asRecord(root.vad_score_event) ?? root;
      return {
        type: 'vad_score',
        score: readNumber(event, 'vad_score'),
        speaking: readString(event, 'state') === 'speaking',
      };
    }
    case 'ping': {
      const event = asRecord(root.ping_event) ?? root;
      return {
        type: 'ping',
        eventId: readNumber(event, 'event_id') ?? readNumber(root, 'event_id') ?? 0,
        replyAfterMs: readNumber(event, 'ping_ms') ?? 0,
      };
    }
    case 'conversation_end': {
      const event = asRecord(root.conversation_end_event) ?? root;
      return { type: 'conversation_end', transcript: readString(event, 'transcript') };
    }
    case 'client_error':
    case 'error': {
      const event = asRecord(root.error) ?? root;
      return {
        type: 'error',
        message:
          readString(event, 'message') ??
          readString(event, 'detail') ??
          'ElevenLabs rejected the conversation',
      };
    }
    default:
      // Heartbeats and events this build does not consume are skipped, not errors.
      return { type: 'ignored' };
  }
}

/**
 * Base64 is a transport detail, and a truncated frame is the failure mode that
 * hurts most: it decodes to garbage audio rather than an error. A cheap length and
 * alphabet check catches it at the edge.
 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

export function isPlausibleBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return BASE64_PATTERN.test(value);
}

// -----------------------------------------------------------------------------
// The stale-turn gate
// -----------------------------------------------------------------------------

/**
 * The half of sub-150 ms barge-in that is not detection: everything the provider
 * synthesised *before* the interruption must never reach the caller's ear.
 *
 * Audio events carry a monotonic `event_id`. Once an interruption is observed (or
 * committed locally), every event up to that id is dead — dropping it here costs
 * one comparison in the hot path, whereas "stop and restart the sink" costs the
 * rebuffer you were trying to avoid.
 */
export class AudioTurnGate {
  private lastInterruptId = -1;
  private discarded = 0;
  private played = 0;

  interruptAt(eventId: number): void {
    this.lastInterruptId = Math.max(this.lastInterruptId, Math.round(eventId));
  }

  accept(eventId: number): boolean {
    if (eventId <= this.lastInterruptId) {
      this.discarded += 1;
      return false;
    }
    this.played += 1;
    return true;
  }

  get lastInterruptEventId(): number {
    return this.lastInterruptId;
  }

  stats(): { readonly discarded: number; readonly played: number } {
    return { discarded: this.discarded, played: this.played };
  }

  /** A new call reuses the provider's id space, so the gate must not carry over. */
  reset(): void {
    this.lastInterruptId = -1;
  }
}

// -----------------------------------------------------------------------------
// Signed URL minting (server side only)
// -----------------------------------------------------------------------------

export type FetchLike = (
  input: string,
  init?: {
    readonly headers?: Record<string, string>;
    readonly method?: string;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<Response>;

export type SignedUrlResult =
  | { readonly ok: true; readonly url: string; readonly expiresAtMs: number }
  | { readonly ok: false; readonly status: number | null; readonly error: string };

/**
 * `GET /v1/convai/conversation/get_signed_url?agent_id=…`
 *
 * Never log or cache the result: a signed URL *is* a credential for one call.
 */
export async function mintSignedConversationUrl(
  config: Extract<ElevenLabsConfig, { configured: true }>,
  deps: { readonly fetchImpl: FetchLike; readonly now?: () => number; readonly signal?: AbortSignal },
): Promise<SignedUrlResult> {
  const now = deps.now?.() ?? Date.now();
  const url = `${config.baseUrl.replace(/\/+$/u, '')}${ELEVENLABS_SIGNED_URL_PATH}?agent_id=${encodeURIComponent(config.agentId)}`;

  let response: Response;
  try {
    response = await deps.fetchImpl(url, {
      method: 'GET',
      headers: { [ELEVENLABS_API_KEY_HEADER]: config.apiKey, Accept: 'application/json' },
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch {
    return { ok: false, status: null, error: 'ElevenLabs signed-URL endpoint is unreachable' };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        response.status === 401 || response.status === 403
          ? 'ElevenLabs rejected the API key'
          : `ElevenLabs signed-URL request failed (${response.status})`,
    };
  }

  const payload = asRecord(await response.json().catch(() => null));
  const signed = payload ? readString(payload, 'signed_url') : null;
  if (!signed) return { ok: false, status: response.status, error: 'No signed_url in the provider response' };
  return { ok: true, url: signed, expiresAtMs: now + SIGNED_URL_TTL_MS };
}

// -----------------------------------------------------------------------------
// Transport + conversation
// -----------------------------------------------------------------------------

export interface ConversationTransport {
  readonly send: (data: string) => void;
  readonly close: () => void;
  readonly isOpen: () => boolean;
}

export interface ConversationHandlers {
  readonly onOpen: () => void;
  readonly onMessage: (raw: string) => void;
  readonly onClose: (info: { readonly reason: string }) => void;
  readonly onError: (message: string) => void;
}

export type ConversationTransportFactory = (
  url: string,
  handlers: ConversationHandlers,
) => ConversationTransport;

/** The real transport. Kept this thin so tests can substitute a scripted one. */
export function createWebSocketTransport(url: string, handlers: ConversationHandlers): ConversationTransport {
  const socket = new WebSocket(url);
  socket.addEventListener('open', () => handlers.onOpen());
  socket.addEventListener('message', (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : '';
    handlers.onMessage(data);
  });
  socket.addEventListener('close', () => handlers.onClose({ reason: 'socket_closed' }));
  socket.addEventListener('error', () => handlers.onError('WebSocket transport failed'));
  return {
    send: (data: string) => {
      socket.send(data);
    },
    close: () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
    isOpen: () => socket.readyState === WebSocket.OPEN,
  };
}

export type ConversationPhase = 'idle' | 'connecting' | 'live' | 'interrupted' | 'ended' | 'failed';

export interface ConversationCallbacks {
  readonly onCallerTranscript?: (text: string) => void;
  readonly onAgentText?: (text: string) => void;
  readonly onAgentAudio?: (audioBase64: string, eventId: number) => void;
  readonly onInterruption?: (eventId: number | null) => void;
  readonly onPhase?: (phase: ConversationPhase) => void;
  readonly onError?: (message: string) => void;
  readonly onReady?: (info: { readonly conversationId: string; readonly outputFormat: string | null }) => void;
}

export interface ConversationOptions {
  readonly language: TelephonyLanguage;
  readonly grounding: ConversationGrounding;
  readonly turnHandling: TurnHandling;
  readonly voiceId: string | null;
  readonly outputSampleRateHz: number;
  readonly callbacks: ConversationCallbacks;
}

/**
 * One conversation, one call.
 *
 * `handle()` is the whole event machine and takes a raw frame, so every state
 * transition below — including the interrupt race that a live socket only shows
 * once in a thousand calls — is reachable from a test without a network.
 */
export class ElevenLabsConversation {
  private transport: ConversationTransport | null = null;
  private phase: ConversationPhase = 'idle';
  private readonly gate = new AudioTurnGate();
  private conversationId = '';
  private lastAgentText = '';
  private pendingInitiation: ElevenLabsClientEvent | null = null;
  private audioChunks = 0;
  private audioBytes = 0;
  private firstAudioAtMs: number | null = null;
  private turnStartedAtMs: number | null = null;
  private lastUserTranscript = '';
  private outputFormat: string | null = null;
  private formatMismatch = false;
  private closed = false;

  constructor(
    private options: ConversationOptions,
    private readonly transportFactory: ConversationTransportFactory,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  get state(): ConversationPhase {
    return this.phase;
  }

  get ready(): boolean {
    return this.phase === 'live' || this.phase === 'interrupted';
  }

  get id(): string {
    return this.conversationId;
  }

  /**
   * True when the provider negotiated a render this profile cannot stream
   * losslessly — reported, never hidden, because the symptom (a caller hearing
   * chipmunk audio) is otherwise invisible in telemetry.
   */
  get audioFormatMismatch(): boolean {
    return this.formatMismatch;
  }

  connect(url: string): void {
    if (this.closed || this.transport) return;
    this.setPhase('connecting');
    this.pendingInitiation = buildInitiationFrame({
      language: this.options.language,
      grounding: this.options.grounding,
      voiceId: this.options.voiceId,
      turnHandling: this.options.turnHandling,
      outputSampleRateHz: this.options.outputSampleRateHz,
    });
    this.transport = this.transportFactory(url, {
      onOpen: () => this.onOpen(),
      onMessage: (raw) => this.handle(raw),
      onClose: ({ reason }) => this.onClose(reason),
      onError: (message) => this.fail(message),
    });
  }

  pushCallerAudio(audioBase64: string): void {
    if (!this.ready || !this.transport) return;
    if (!isPlausibleBase64(audioBase64)) return;
    this.transport.send(encodeClientEvent({ user_audio_chunk: audioBase64 }));
  }

  /**
   * Text commit path. The provider has no audio-flush event, so a transcript sent
   * this way commits the turn deterministically — which is exactly what the
   * typed-chat fallback and the webhook replay need, and exactly what makes it
   * *not* a test of the caller's audio path.
   */
  sendUserMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.ready || !this.transport) return;
    this.transport.send(encodeClientEvent({ type: 'user_message', text: trimmed }));
  }

  /**
   * "The caller is still here." Resets the provider's idle timeout without
   * committing a turn — the difference between a receptionist that waits and one
   * that starts reciting its goodbye on a two-second pause to check a quote.
   */
  markUserActivity(): void {
    if (!this.ready || !this.transport?.isOpen()) return;
    this.transport.send(encodeClientEvent({ type: 'user_activity' }));
  }

  /**
   * Barge-in, provider side. The local audio sink is muted by the caller of this
   * method (the room orchestrator) *before* it runs — this only truncates the
   * turn and drops whatever the provider had already queued.
   */
  interrupt(): void {
    if (this.closed) return;
    // The highest id we have seen is the boundary: everything at or below it is
    // audio for the sentence the caller just interrupted.
    this.gate.interruptAt(this.highestAudioEventId);
    this.setPhase('interrupted');
    this.options.callbacks.onInterruption?.(this.highestAudioEventId);
    if (this.transport?.isOpen()) {
      this.transport.send(
        encodeClientEvent({
          type: 'contextual_update',
          context: {
            type: 'text',
            text: '[caller interrupted — stop the current sentence, listen]',
          },
        }),
      );
    }
  }

  /** Switch the synthesizer's language for the *next* turn, flushing this one. */
  switchLanguage(language: TelephonyLanguage, note: string): void {
    if (this.options.language === language) return;
    this.options = { ...this.options, language };
    this.interrupt();
    if (this.transport?.isOpen()) {
      this.transport.send(
        encodeClientEvent({
          type: 'contextual_update',
          context: { type: 'text', text: note },
        }),
      );
    }
  }

  /**
   * Drive the machine with a raw provider frame. Everything the bridge believes
   * about a conversation is derived here.
   */
  handle(raw: string): void {
    const event = decodeServerEvent(raw);
    switch (event.type) {
      case 'initiation_metadata': {
        this.conversationId = event.conversationId;
        this.outputFormat = event.outputFormat;
        this.formatMismatch =
          event.outputFormat !== null &&
          !event.outputFormat.includes(String(this.options.outputSampleRateHz));
        this.setPhase('live');
        this.options.callbacks.onReady?.({
          conversationId: event.conversationId,
          outputFormat: event.outputFormat,
        });
        return;
      }
      case 'audio': {
        this.highestAudioEventId = Math.max(this.highestAudioEventId, event.eventId);
        if (!this.gate.accept(event.eventId)) return;
        if (this.phase !== 'live') this.setPhase('live');
        const at = this.clock();
        if (this.firstAudioAtMs === null) {
          this.firstAudioAtMs = at;
          if (this.turnStartedAtMs !== null) {
            this.firstAudioByteMs = Math.max(0, Math.round(at - this.turnStartedAtMs));
          }
        }
        this.audioChunks += 1;
        this.audioBytes += event.audioBase64.length;
        this.options.callbacks.onAgentAudio?.(event.audioBase64, event.eventId);
        return;
      }
      case 'agent_response': {
        this.lastAgentText = event.text;
        this.options.callbacks.onAgentText?.(event.text);
        return;
      }
      case 'agent_response_correction': {
        // After a barge-in the provider restates what the agent actually managed
        // to say. Trusting the pre-interruption text would put words the caller
        // never heard in the operator's transcript.
        this.lastAgentText = event.text;
        this.options.callbacks.onAgentText?.(event.text);
        return;
      }
      case 'user_transcript': {
        this.lastUserTranscript = event.text;
        if (this.phase === 'live' && this.turnStartedAtMs === null) {
          this.turnStartedAtMs = this.clock();
          this.firstAudioAtMs = null;
        }
        this.options.callbacks.onCallerTranscript?.(event.text);
        return;
      }
      case 'interruption': {
        if (event.eventId !== null) this.gate.interruptAt(event.eventId);
        this.setPhase('interrupted');
        this.options.callbacks.onInterruption?.(event.eventId);
        return;
      }
      case 'vad_score': {
        // The provider's own VAD is a second opinion on turn ownership. It starts a
        // turn clock so first-byte latency is measured from speech, not from the
        // transcript that arrives a beat later; it never ends one.
        if (event.speaking && this.turnStartedAtMs === null) {
          this.turnStartedAtMs = this.clock();
          this.firstAudioAtMs = null;
        }
        return;
      }
      case 'ping': {
        this.sendPong(event.eventId, event.replyAfterMs);
        return;
      }
      case 'conversation_end': {
        this.setPhase('ended');
        return;
      }
      case 'error': {
        this.fail(event.message);
        return;
      }
      case 'ignored':
        return;
    }
  }

  /** Kept separate from `handle` so the reply can be scheduled by the caller. */
  sendPong(eventId: number, afterMs: number): void {
    const send = (): void => {
      if (!this.transport?.isOpen()) return;
      this.transport.send(encodeClientEvent({ type: 'pong', event_id: eventId }));
    };
    if (afterMs > 0) {
      setTimeout(send, afterMs);
      return;
    }
    send();
  }

  /**
   * Turn accounting for the latency meter: the interval between the caller's
   * transcript landing and the first byte of agent audio surviving the gate.
   */
  finishTurn(): { readonly firstAudioByteMs: number | null } {
    const measured = this.firstAudioByteMs;
    this.turnStartedAtMs = null;
    this.firstAudioAtMs = null;
    this.firstAudioByteMs = null;
    return { firstAudioByteMs: measured };
  }

  beginTurn(): void {
    this.turnStartedAtMs = this.clock();
    this.firstAudioAtMs = null;
    this.firstAudioByteMs = null;
    this.gate.reset();
    this.highestAudioEventId = -1;
  }

  close(reason = 'call_ended'): void {
    if (this.closed) return;
    this.closed = true;
    this.transport?.close();
    this.transport = null;
    this.setPhase(this.phase === 'failed' ? 'failed' : 'ended');
    this.options.callbacks.onPhase?.(this.phase);
    void reason;
  }

  metrics(): {
    readonly audioChunks: number;
    readonly audioBytes: number;
    readonly discardedEvents: number;
    readonly playedEvents: number;
    readonly conversationId: string;
    readonly outputFormat: string | null;
    readonly formatMismatch: boolean;
  } {
    const { discarded, played } = this.gate.stats();
    return {
      audioChunks: this.audioChunks,
      audioBytes: this.audioBytes,
      discardedEvents: discarded,
      playedEvents: played,
      conversationId: this.conversationId,
      outputFormat: this.outputFormat,
      formatMismatch: this.formatMismatch,
    };
  }

  private firstAudioByteMs: number | null = null;
  private highestAudioEventId = -1;

  private onOpen(): void {
    if (!this.transport || !this.pendingInitiation) return;
    this.transport.send(encodeClientEvent(this.pendingInitiation));
    this.pendingInitiation = null;
  }

  private onClose(reason: string): void {
    this.transport = null;
    if (this.closed) return;
    this.setPhase(this.phase === 'live' ? 'ended' : 'failed');
    this.options.callbacks.onError?.(`Conversation socket closed (${reason})`);
  }

  private fail(message: string): void {
    this.setPhase('failed');
    this.options.callbacks.onError?.(message);
  }

  private setPhase(phase: ConversationPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.options.callbacks.onPhase?.(phase);
  }
}
