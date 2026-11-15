import 'server-only';

import { randomUUID } from 'node:crypto';
import { env } from '@/lib/env';
import { claimSlotHold, createSlotHold, insertBooking, listBusyIntervals, releaseSlotHold } from '@/lib/db/calendar';
import {
  agentParticipantIdentity,
  ownerParticipantIdentity,
  sipCallerIdentity,
  telephonyRoomName,
} from './livekit-room';

const REASON_COPY: Record<string, string> = {
  did_paused: 'This line is paused',
  did_unassigned: 'This line has no receptionist assigned',
  after_hours_human: 'The receptionist is off duty outside opening hours',
  no_grounding: 'This tenant has no grounded knowledge to answer from',
  // Not a forwarding failure the caller can wait out: the line has nowhere to go.
  no_forward_target: 'This line has no human number to forward to',
  line_capacity: 'The line is at capacity',
  process_capacity: 'The bridge is at capacity',
  elevenlabs_unconfigured: 'The voice agent is not provisioned',
};
import {
  afterHoursGreeting,
  afterHoursVerdict,
  conversationGrounding,
  greetingFor,
  interpolateGreeting,
  normalizeE164,
  resolveInboundRoute,
  ringDelayFor,
  groundingIsSufficient,
  type TenantGrounding,
} from './grounding';
import {
  BARGE_IN_BUDGET_MS,
  judgeLatency,
  LATENCY_BUDGETS,
  maskCallerNumber,
  roundTripOf,
  type LatencyVerdict,
  type TelephonyLanguage,
  type TelephonySession,
  type TelephonyTranscriptRole,
} from './types';
import {
  appendTurn,
  beginSession,
  observeLatency,
  projectSession,
  type SessionProjection,
  SessionRegistry,
  transitionTo,
} from './session-machine';
import {
  deriveBargeInPolicy,
  mergeBargeInTelemetry,
  type BargeInPolicy,
  type BargeInTelemetry,
} from './barge-in';
import {
  defaultTurnHandling,
  mintSignedConversationUrl,
  resolveElevenLabsConfig,
  type ElevenLabsConfig,
  type FetchLike,
} from './elevenlabs';
import {
  buildBookingPayload,
  chooseEarliest,
  createBooking,
  defaultQueryWindow,
  formatSlotOffer,
  resolveCalComConfig,
  syncSlots,
  type CalComConfig,
  type CalComSlot,
  type SlotSyncResult,
  type TimeInterval,
} from './calcom';
import {
  actingUserForTenant,
  countOpenCalls,
  loadGroundingForDialledNumber,
  loadTenantGrounding,
  upsertTelephonyCallSession,
  type GroundingActor,
} from './tenant-grounding';

/**
 * The bridge: PSTN ingress in, grounded bilingual conversation out.
 *
 * One function per call-lifecycle moment — `dispatchInboundCall`,
 * `bookCallSlotFromBridge`, `endInboundCall` — and each is a *pipeline of pure
 * decisions* over adapters, not a stack of network calls. Read `dispatchInboundCall`
 * top to bottom and you have the product: resolve the DID, ground on the tenant,
 * decide whether the AI may answer, provision the synthesizer, sync Cal.com,
 * reserve the room, measure the budget, persist. Every step either produces a fact
 * or a refusal with a reason. There is no branch anywhere in this file that
 * invents a value to keep going.
 *
 * **Latency honesty.** `telemetry` reports the *budget* the bridge was configured
 * against plus whatever the live turn actually measured. It never reports a random
 * number dressed up as a measurement — the previous dispatch did, and an operator
 * reading a dashboard of invented latencies is worse off than one with no
 * dashboard at all. `source: 'budget' | 'measured'` says which is which.
 */

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

/** The carrier-side facts about the line the call arrived on. */
export interface TrunkLineProfile {
  readonly e164: string;
  readonly codec: 'PCMA' | 'PCMU' | 'OPUS' | 'AMR-WB';
  readonly sampleRateHz: number;
  readonly ringBehavior: 'immediate' | 'one-ring' | 'two-rings';
  readonly jitterMs: number;
  readonly packetLossPct: number;
  readonly dispatchRuleId: string | null;
  readonly sipTrunkHost: string;
  readonly sipUsername: string;
  readonly status: 'active' | 'paused' | 'pool';
  readonly forwardTo: string | null;
}

export interface InboundDispatchInput {
  /** The number the caller dialled — the only legal tenant selector. */
  readonly did: string;
  readonly callerNumber: string | null;
  readonly event?: string;
  readonly requestedState?: string;
  readonly roomName?: string | null;
  /** Last thing either side said, for the SIP ledger preview. Never a transcript. */
  readonly transcriptPreview?: string | null;
  /** A console operator may pin the tenant they are testing (never a caller). */
  readonly tenantIdOverride?: string | null;
  /** Signed-in actor: the console path grounds as itself, not as the tenant owner. */
  readonly actor?: GroundingActor | null;
  readonly line?: TrunkLineProfile | null;
  readonly languageHint?: TelephonyLanguage | null;
}

export interface BridgeDeps {
  readonly now?: () => number;
  readonly fetchImpl?: FetchLike;
  readonly registry?: SessionRegistry;
  /** Test seam: skip the networked provider calls entirely. */
  readonly probeProviders?: boolean;
}

// -----------------------------------------------------------------------------
// Result
// -----------------------------------------------------------------------------

export type LatencySource = 'budget' | 'measured' | 'declined';

export interface BridgeTelemetry {
  readonly ringDelayMs: number;
  readonly sttLatencyMs: number;
  readonly llmFirstTokenMs: number;
  readonly ttsFirstByteMs: number;
  readonly roundTripMs: number;
  readonly jitterMs: number;
  readonly packetLossPct: number;
  readonly mos: number;
  readonly source: LatencySource;
}

export interface VoiceDispatchDescriptor {
  readonly provider: 'elevenlabs' | 'browser_fallback';
  readonly configured: boolean;
  readonly reason: string | null;
  readonly agentId: string | null;
  readonly voiceId: string | null;
  readonly language: TelephonyLanguage;
  readonly greeting: string;
  readonly signedUrl: string | null;
  readonly signedUrlExpiresAtMs: number | null;
  readonly audioFormatExpectation: string;
  readonly turnHandling: {
    readonly endOfTurnMs: number;
    readonly idlePromptAfterMs: number;
    readonly allowInterruptions: boolean;
  };
}

export interface BargeInDescriptor {
  readonly budgetMs: number;
  readonly policy: BargeInPolicy;
  readonly measurementPoint: string;
}

export interface CalendarDescriptor {
  readonly configured: boolean;
  readonly reason: string | null;
  readonly timeZone: string;
  readonly syncedAtIso: string | null;
  readonly staleAfterMs: number;
  readonly availableCount: number;
  readonly nextSlot: { startIso: string; endIso: string; offer: string } | null;
  readonly allHeldLocally: boolean;
  readonly source: SlotSyncResult['source'] | 'skipped';
}

export type BridgeOutcome =
  | {
      readonly ok: true;
      readonly action: 'accept';
      readonly sipStatus: 200;
      readonly callId: string;
      /** Normalised E.164 the caller dialled — the only tenant selector used. */
      readonly dialed: string;
      /** Normalised caller number, or null for a withheld CLI. */
      readonly caller: string | null;
      readonly session: TelephonySession;
      readonly grounding: TenantGrounding;
      readonly room: {
        readonly roomName: string;
        readonly agentName: string;
        readonly callerIdentity: string;
        readonly agentIdentity: string;
        readonly dispatchRuleId: string;
        readonly websocketUrl: string;
        readonly sipEndpoint: string;
        readonly sipUsername: string;
      };
      readonly voice: VoiceDispatchDescriptor;
      readonly bargeIn: BargeInDescriptor;
      readonly calendar: CalendarDescriptor;
      readonly telemetry: BridgeTelemetry;
      readonly open: { readonly isOpen: boolean; readonly localTime: string; readonly reason: string };
      readonly persisted: boolean;
      readonly capacity: { readonly active: number; readonly limit: number };
    }
  | {
      readonly ok: false;
      readonly action: 'forward' | 'reject';
      readonly sipStatus: 302 | 404 | 486;
      readonly reason: string;
      readonly message: string;
      readonly forwardTo: string | null;
      readonly grounding: TenantGrounding | null;
      readonly telemetry: BridgeTelemetry;
      readonly persisted: false;
    };

// -----------------------------------------------------------------------------
// Process-wide live-call registry
// -----------------------------------------------------------------------------

/**
 * The ceiling on simultaneous conversations a single Next.js process will hold.
 *
 * It is a *worker* limit, not a billing one: each live call keeps a WebSocket, a
 * barge-in latch and a bounded transcript alive, and the process that runs out of
 * those must refuse at the SIP layer (486) in milliseconds rather than accept and
 * then time out in the caller's ear.
 */
const registryKey = '__omniTelephonyRegistry' as const;
const registryGlobal = globalThis as typeof globalThis & {
  [registryKey]?: SessionRegistry;
};

export function telephonyRegistry(): SessionRegistry {
  const existing = registryGlobal[registryKey];
  if (existing) return existing;
  const created = new SessionRegistry(env.TELEPHONY_MAX_CONCURRENT_CALLS);
  registryGlobal[registryKey] = created;
  return created;
}

// -----------------------------------------------------------------------------
// Dispatch
// -----------------------------------------------------------------------------

function newCallId(nowMs: number): string {
  // Timestamp prefix for readable logs, UUID suffix for uniqueness: a call id is a
  // primary key in the ledger, so two calls in the same second must not collide.
  return `call_${new Date(nowMs).toISOString().slice(11, 19).replace(/:/gu, '')}_${randomUUID().slice(0, 8)}`;
}

/** Deterministic MOS, ×10 to keep the integer column the ledger already uses. */
function estimateMos(jitterMs: number, packetLossPct: number): number {
  const jitter = Number.isFinite(jitterMs) ? Math.max(0, jitterMs) : 0;
  const loss = Number.isFinite(packetLossPct) ? Math.max(0, packetLossPct) : 0;
  return Math.max(28, Math.min(45, 45 - Math.round(jitter / 3) - loss * 2));
}

export async function dispatchInboundCall(
  input: InboundDispatchInput,
  deps: BridgeDeps = {},
): Promise<BridgeOutcome> {
  const now = deps.now?.() ?? Date.now();
  const registry = deps.registry ?? telephonyRegistry();
  const fetchImpl = deps.fetchImpl;

  const dialed = normalizeE164(input.did);
  const callerNumber = normalizeE164(input.callerNumber);
  const line = input.line ?? null;

  const telemetryFor = (source: LatencySource): BridgeTelemetry => {
    const budget = { ...LATENCY_BUDGETS };
    return {
      ringDelayMs: ringDelayFor(line?.ringBehavior ?? 'one-ring'),
      sttLatencyMs: budget.sttMs,
      llmFirstTokenMs: budget.llmFirstTokenMs,
      ttsFirstByteMs: budget.ttsFirstByteMs,
      roundTripMs: roundTripOf(budget),
      jitterMs: Math.max(0, line?.jitterMs ?? 0),
      packetLossPct: Math.max(0, line?.packetLossPct ?? 0),
      mos: estimateMos(line?.jitterMs ?? 0, line?.packetLossPct ?? 0),
      source,
    };
  };

  if (!dialed) {
    return {
      ok: false,
      action: 'reject',
      sipStatus: 404,
      reason: 'unparseable_dialed_number',
      message:
        'The dialled number could not be normalised to E.164. Provide `did` or `tr_sip_to` as +45… (8-digit Danish numbers are accepted).',
      forwardTo: null,
      grounding: null,
      telemetry: telemetryFor('declined'),
      persisted: false,
    };
  }

  // --- 1 · Grounding. DID first: a caller's number identifies the tenant, never
  // the other way round. ---
  let grounding: TenantGrounding | null = null;
  let actor: GroundingActor | null = input.tenantIdOverride && input.actor ? input.actor : null;

  // A console operator testing their own workspace grounds as themselves, so the
  // RLS policy — not this file — decides what they may hear. The DID path below has
  // no identity to speak for, so it resolves the tenant's own owner instead.
  if (input.tenantIdOverride && input.actor) {
    grounding = await loadTenantGrounding(input.actor, input.tenantIdOverride);
  }

  if (!grounding) {
    const resolved = await loadGroundingForDialledNumber(dialed);
    if (resolved) {
      grounding = resolved.grounding;
      actor = { kind: 'user', userId: resolved.inbound.actingUserId ?? '' };
      if (!actor.userId) actor = null;
    }
  }

  const route = resolveInboundRoute({
    grounding,
    numberStatus: line?.status ?? (grounding ? 'active' : null),
    forwardTo: line?.forwardTo ?? grounding?.forwardToPhone ?? null,
  });

  if (!grounding) {
    return {
      ok: false,
      action: 'reject',
      sipStatus: 404,
      reason: 'unknown_did',
      message: `No tenant is bound to ${dialed}. The call is refused rather than answered by the wrong business.`,
      forwardTo: null,
      grounding: null,
      telemetry: telemetryFor('declined'),
      persisted: false,
    };
  }

  if (route.action !== 'accept') {
    // A known tenant whose line must not be answered by an AI: paused, unassigned,
    // after hours with a human line configured, or too ungrounded to speak from.
    // The number is still answered — by forwarding it — because a caller who dials
    // a paused line still expects a human, not silence.
    return {
      ok: false,
      ...(route.action === 'reject'
        ? {
            action: 'reject' as const,
            sipStatus: 404 as const,
            reason: route.reason,
            forwardTo: null as string | null,
            message:
              route.reason === 'no_forward_target'
                ? `${grounding.name} has no human number configured, so the call is refused instead of forwarded to nowhere.`
                : `No tenant is bound to ${dialed}. The call is refused rather than answered by the wrong business.`,
          }
        : {
            action: 'forward' as const,
            sipStatus: 302 as const,
            reason: route.reason,
            forwardTo: route.forwardTo as string | null,
            message: `${REASON_COPY[route.reason] ?? 'This line is not answering automatically.'} The call is forwarded to ${route.forwardTo}.`,
          }),
      grounding,
      telemetry: telemetryFor('declined'),
      persisted: false,
    };
  }

  const language: TelephonyLanguage = input.languageHint ?? grounding.language;
  const openVerdict = afterHoursVerdict(grounding, now);

  // --- 2 · Capacity, checked twice: the process ceiling and the tenant's own
  // live-call count from the ledger, because two workers each have their own map. ---
  const callId = newCallId(now);
  const session = beginSession({
    callId,
    tenantId: grounding.tenantId,
    callerNumber: callerNumber ?? 'anonymous',
    language,
    startedAtMs: now,
    startedAtIso: new Date(now).toISOString(),
  });

  const admission = registry.acquire(session);
  if (!admission.admitted) {
    const openNow = registry.stats().activeCount;
    return {
      ok: false,
      action: 'reject',
      sipStatus: 486,
      reason: 'capacity',
      message: `This receptionist is on ${openNow} live calls and cannot take another. The caller hears a fast busy rather than a long ring into a dead worker.`,
      forwardTo: grounding.forwardToPhone ?? grounding.escalationPhone,
      grounding,
      telemetry: telemetryFor('declined'),
      persisted: false,
    };
  }

  if (actor) {
    try {
      const openForTenant = await countOpenCalls(actor, grounding.tenantId);
      const perTenantLimit = env.TELEPHONY_MAX_CALLS_PER_TENANT;
      // The registry counted this call already, hence the strict comparison.
      if (openForTenant > perTenantLimit) {
        registry.release(callId);
        return {
          ok: false,
          action: 'reject',
          sipStatus: 486,
          reason: 'tenant_capacity',
          message: `${grounding.name} has ${openForTenant} calls in progress, above the ${perTenantLimit} configured for the workspace.`,
          forwardTo: grounding.forwardToPhone ?? grounding.escalationPhone,
          grounding,
          telemetry: telemetryFor('declined'),
          persisted: false,
        };
      }
    } catch {
      // An unreachable ledger must not stop a caller being answered: the process
      // ceiling above still holds, so the refusal to count is recorded, not ignored.
    }
  }

  // --- 3 · The synthesizer. Configured, then reachable; anything else is a
  // declared fallback, never a silent one. ---
  const elevenLabs = resolveElevenLabsConfig(
    {
      ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY,
      ELEVENLABS_BASE_URL: env.ELEVENLABS_BASE_URL,
      ELEVENLABS_AGENT_ID: env.ELEVENLABS_AGENT_ID,
      ELEVENLABS_AGENT_ID_EN: env.ELEVENLABS_AGENT_ID_EN,
    },
    {
      language,
      tenantAgentId:
        language === 'en-GB'
          ? grounding.voice.elevenLabsAgentIdEn ?? grounding.voice.elevenLabsAgentId
          : grounding.voice.elevenLabsAgentId,
      tenantVoiceId: grounding.voice.voiceId,
    },
  );

  let signedUrl: string | null = null;
  let signedUrlExpiresAtMs: number | null = null;
  let voiceReason: string | null = null;

  if (elevenLabs.configured) {
    if (fetchImpl && deps.probeProviders !== false) {
      const minted = await mintSignedConversationUrl(elevenLabs, {
        fetchImpl,
        now: () => now,
      });
      if (minted.ok) {
        signedUrl = minted.url;
        signedUrlExpiresAtMs = minted.expiresAtMs;
      } else {
        voiceReason = minted.error;
      }
    }
  } else {
    voiceReason = elevenLabs.message;
  }

  const voice: VoiceDispatchDescriptor = {
    provider: elevenLabs.configured && (signedUrl || !fetchImpl) ? 'elevenlabs' : 'browser_fallback',
    configured: elevenLabs.configured,
    reason: voiceReason,
    agentId: elevenLabs.configured ? elevenLabs.agentId : null,
    voiceId: elevenLabs.configured ? elevenLabs.voiceId : null,
    language,
    greeting: interpolateGreeting(
      openVerdict.open
        ? greetingFor(grounding, language)
        : afterHoursGreeting(grounding, language, openVerdict),
      grounding.agentName,
    ),
    signedUrl,
    signedUrlExpiresAtMs,
    audioFormatExpectation: grounding.audioFormatExpectation,
    turnHandling: defaultTurnHandling(grounding.sound.bargeInSensitivity),
  };

  const policy = deriveBargeInPolicy({
    vadThreshold: grounding.sound.vadThreshold,
    bargeInSensitivity: grounding.sound.bargeInSensitivity,
    echoTailMs: grounding.sound.echoTailMs,
    budgetMs: grounding.bargeInBudgetMs,
  });

  // --- 4 · Cal.com. The remote grid is the candidate set; the tenant's own holds
  // subtract from it. A provider that will not answer yields "unavailable", not a
  // confident empty diary. ---
  const calendar = await syncCalendar(grounding, actor, now, fetchImpl, openVerdict.open);

  // --- 5 · The room. Attempt-scoped, one agent dispatch, SIP identity derived from
  // the caller's masked number so a room name cannot leak a subscriber. ---
  const roomName = (input.roomName ?? telephonyRoomName(grounding.slug, callId)).trim();
  const attempt = callId.slice(-6);
  const room = {
    roomName,
    agentName: grounding.agentName,
    callerIdentity: sipCallerIdentity(callerNumber ?? 'anonymous', attempt),
    agentIdentity: agentParticipantIdentity(grounding.agentName),
    dispatchRuleId: line?.dispatchRuleId ?? `SDR_${dialed.replace(/\D/g, '').slice(-6)}`,
    websocketUrl: line ? `wss://${line.sipTrunkHost}/rtc` : '',
    sipEndpoint: line ? `sip:${line.sipUsername}@${line.sipTrunkHost}` : '',
    sipUsername: line?.sipUsername ?? '',
  };

  const activated = transitionTo(session, 'active');
  const opened = activated.ok ? activated.session : session;
  // The greeting is the call's first agent turn. Recording it is not decoration:
  // without an opening line the transcript starts with the caller, and an operator
  // reading it later cannot tell whether the agent ever spoke.
  const liveSession = appendTurn(
    opened,
    'agent',
    input.transcriptPreview?.trim() || voice.greeting,
    0,
  ).session;
  registry.update(liveSession);

  // --- 6 · Persist. A ledger write failure is reported as `persisted: false`; it
  // never turns into a failed call, because the caller is already on the line. ---
  const telemetry = telemetryFor(voice.provider === 'elevenlabs' ? 'budget' : 'declined');
  const projected = projectSession(liveSession, now);
  let persisted = false;
  if (actor) {
    persisted = await persistSession(actor, liveSession, {
      bargeIn: null,
      roomName: room.roomName,
      dispatchRuleId: room.dispatchRuleId,
      dialedNumber: dialed,
      callerNumber,
      grounding,
      telemetry,
      voice,
      calendar,
      projected: projected.turns,
      startedAtIso: liveSession.startedAtIso,
    });
  }

  if (actor) {
    // Bind the call for the rest of its life: the control route writes the ledger as
    // this actor, with the facts captured here, and never accepts either from a body.
    bindLiveCall(callId, {
      actor,
      context: {
        roomName: room.roomName,
        dispatchRuleId: room.dispatchRuleId,
        dialedNumber: dialed,
        callerNumber,
        grounding,
        telemetry,
        voice,
        calendar,
        projected: projected.turns,
        startedAtIso: liveSession.startedAtIso,
        bargeIn: null,
      },
    });
  }

  return {
    ok: true,
    action: 'accept',
    sipStatus: 200,
    callId,
    dialed,
    caller: callerNumber,
    session: liveSession,
    grounding,
    room,
    voice,
    bargeIn: {
      budgetMs: grounding.bargeInBudgetMs || BARGE_IN_BUDGET_MS,
      policy,
      measurementPoint:
        'caller microphone → last agent audio frame dropped; measured by BargeInController, reported per turn over the LiveKit data channel',
    },
    calendar,
    telemetry,
    open: {
      isOpen: openVerdict.open,
      localTime: openVerdict.localTime,
      reason: openVerdict.reason,
    },
    persisted,
    capacity: { active: registry.activeCount, limit: registry.capacityLimit },
  };
}

// -----------------------------------------------------------------------------
// Calendar
// -----------------------------------------------------------------------------

async function syncCalendar(
  grounding: TenantGrounding,
  actor: GroundingActor | null,
  nowMs: number,
  fetchImpl: FetchLike | undefined,
  openNow: boolean,
): Promise<CalendarDescriptor> {
  const config = resolveCalComConfig(
    {
      CALCOM_API_URL: env.CALCOM_API_URL,
      CALCOM_API_KEY: env.CALCOM_API_KEY,
      CALCOM_EVENT_TYPE_ID: env.CALCOM_EVENT_TYPE_ID,
      CALCOM_EVENT_SLUG: env.CALCOM_EVENT_SLUG,
      CALCOM_TIMEZONE: env.CALCOM_TIMEZONE,
    },
    {
      calcomEventTypeId: grounding.calendar.eventTypeId,
      timeZone: grounding.calendar.timeZone,
    },
  );

  const descriptor = (
    source: CalendarDescriptor['source'],
    slots: readonly CalComSlot[],
    sync: SlotSyncResult | null,
    reason: string | null,
  ): CalendarDescriptor => {
    const next = chooseEarliest(slots);
    return {
      configured: config.configured,
      reason,
      timeZone: grounding.calendar.timeZone,
      syncedAtIso: sync ? sync.fetchedAtIso : null,
      staleAfterMs: sync ? sync.staleAfterMs : 0,
      availableCount: slots.length,
      nextSlot: next
        ? { startIso: next.startIso, endIso: next.endIso, offer: formatSlotOffer(next, grounding.language, grounding.calendar.timeZone) }
        : null,
      allHeldLocally: sync ? sync.allHeldLocally : false,
      source,
    };
  };

  if (!config.configured) {
    return descriptor('unconfigured', [], null, config.message);
  }
  // Outside opening hours there is nothing to promise yet, and asking Cal.com for
  // a slot the desk will not honour is how a tenant gets a no-show.
  if (!openNow) {
    return descriptor('skipped', [], null, 'Closed now — availability is offered as a callback instead of a booking.');
  }
  if (!fetchImpl || !actor || actor.kind !== 'user') {
    return descriptor('skipped', [], null, 'No actor scoped for the tenant ledger; slot sync needs an RLS identity.');
  }

  let busy: TimeInterval[] = [];
  try {
    const rows = await listBusyIntervals(actor.userId, grounding.tenantId);
    // `BusyIntervalRow` carries `start_iso`/`end_iso` straight from SQL; the slot
    // maths wants `startIso`/`endIso`, so the mapping happens here rather than in
    // `subtractBusy`, which stays a pure interval helper.
    busy = rows.map((row) => ({ startIso: row.start_iso, endIso: row.end_iso }));
  } catch {
    return descriptor('provider_error', [], null, 'The tenant hold ledger is unreachable, so no slot can be offered safely.');
  }

  const sync = await syncSlots(
    config,
    { fetchImpl, now: () => nowMs },
    defaultQueryWindow(nowMs),
    busy,
  );

  if (!sync.ok) {
    return descriptor(sync.source, [], sync, sync.error);
  }
  return descriptor(sync.source, sync.slots, sync, sync.allHeldLocally ? 'Every remote slot is already held locally.' : null);
}

// -----------------------------------------------------------------------------
// Ledger
// -----------------------------------------------------------------------------

export interface PersistContext {
  readonly roomName: string;
  readonly dispatchRuleId: string;
  readonly dialedNumber: string;
  readonly callerNumber: string | null;
  readonly grounding: TenantGrounding;
  readonly telemetry: BridgeTelemetry;
  readonly voice: VoiceDispatchDescriptor;
  readonly calendar: CalendarDescriptor;
  readonly projected: number;
  readonly startedAtIso: string;
  /** Last barge-in counters for this call, when someone has reported them. */
  readonly bargeIn?: BargeInTelemetry | null;
}

async function persistSession(
  actor: GroundingActor,
  session: TelephonySession,
  context: PersistContext,
): Promise<boolean> {
  try {
    return await upsertTelephonyCallSession(actor, {
      callId: session.callId,
      tenantId: session.tenantId,
      roomName: context.roomName,
      dispatchRuleId: context.dispatchRuleId,
      callerNumber: context.callerNumber,
      dialedNumber: context.dialedNumber,
      // A PSTN caller has no contact row until the agent captures one; the ledger
      // keeps the call anyway, keyed by number, so a missed call is still auditable.
      contactId: null,
      language: session.language,
      status: session.status,
      latencyMs: session.latencyMs,
      transcript: session.transcript,
      bargeIn: {
        commits: context.bargeIn?.commits ?? 0,
        overBudget: context.bargeIn?.overBudget ?? 0,
        worstMs: context.bargeIn?.worstMs ?? 0,
        budgetMs: context.bargeIn?.budgetMs ?? context.grounding.bargeInBudgetMs,
      },
      telemetry: {
        ringDelayMs: context.telemetry.ringDelayMs,
        roundTripMs: context.telemetry.roundTripMs,
        latencySource: context.telemetry.source,
        mos: context.telemetry.mos,
        jitterMs: context.telemetry.jitterMs,
        packetLossPct: context.telemetry.packetLossPct,
        provider: context.voice.provider,
        providerConfigured: context.voice.configured,
        audioFormat: context.voice.audioFormatExpectation,
        grounded: groundingIsSufficient(context.grounding),
        knowledgeCount: context.grounding.knowledge.length,
        calendarSource: context.calendar.source,
        calendarSlots: context.calendar.availableCount,
        callerMask: maskCallerNumber(context.callerNumber ?? ''),
      },
      provider: context.voice.provider === 'elevenlabs' ? 'elevenlabs' : 'browser_fallback',
      startedAtIso: context.startedAtIso,
      endedAtIso: session.status === 'completed' || session.status === 'failed' ? new Date().toISOString() : null,
    });
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Booking from a live call
// -----------------------------------------------------------------------------

export type SlotBookingResult =
  | {
      readonly ok: true;
      readonly holdId: string;
      readonly bookingUid: string | null;
      readonly needsConfirmation: boolean;
      readonly provider: 'calcom' | 'local_hold';
      readonly startIso: string;
      readonly endIso: string;
      readonly spokenConfirmation: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'unconfigured' | 'slot_taken' | 'provider_refused' | 'hold_expired' | 'not_groundable';
      readonly message: string;
      readonly spokenRefusal: string;
    };

/**
 * Turn a spoken "yes, book me in" into an appointment.
 *
 * The order is the invariant: **hold locally first, book second.** A Cal.com
 * booking that succeeds without a local hold leaves a window in which a second
 * concurrent call is offered the same slot, and the second caller is told "no"
 * after having been promised "yes". Holding first means the loser of the race
 * never hears a promise at all.
 *
 * If the provider refuses or the response is ambiguous, the hold is released —
 * unless the failure was a network error, where the hold *stays* until its own
 * expiry, because a slot that might have been booked must not be re-offered while
 * the answer is unknown.
 */
export async function bookCallSlotFromBridge(
  args: {
    readonly tenantId: string;
    readonly callId: string;
    readonly slot: CalComSlot;
    readonly attendee: { readonly name: string; readonly email: string | null; readonly phone: string | null };
    readonly language: TelephonyLanguage;
    readonly contactId?: string | null;
  },
  deps: { readonly userId: string; readonly fetchImpl: FetchLike; readonly now?: () => number },
): Promise<SlotBookingResult> {
  const nowMs = deps.now?.() ?? Date.now();
  const actor: GroundingActor = { kind: 'user', userId: deps.userId };
  const grounding = await loadTenantGrounding(actor, args.tenantId);
  if (!grounding) {
    return {
      ok: false,
      reason: 'not_groundable',
      message: 'The tenant could not be read under its own RLS scope.',
      spokenRefusal:
        args.language === 'da-DK'
          ? 'Jeg kan ikke bekræfte en tid lige nu — jeg noterer din henvendelse, så ringer en kollega op.'
          : 'I cannot confirm a time right now — I will take a message and a colleague will call you back.',
    };
  }

  const config = resolveCalComConfig(
    {
      CALCOM_API_URL: env.CALCOM_API_URL,
      CALCOM_API_KEY: env.CALCOM_API_KEY,
      CALCOM_EVENT_TYPE_ID: env.CALCOM_EVENT_TYPE_ID,
      CALCOM_EVENT_SLUG: env.CALCOM_EVENT_SLUG,
      CALCOM_TIMEZONE: env.CALCOM_TIMEZONE,
    },
    { calcomEventTypeId: grounding.calendar.eventTypeId, timeZone: grounding.calendar.timeZone },
  ) as CalComConfig;

  const held = await createSlotHold(deps.userId, {
    tenantId: args.tenantId,
    contactId: args.contactId ?? null,
    callLogId: null,
    provider: config.configured ? 'calcom' : 'ics_universal',
    startIso: args.slot.startIso,
    endIso: args.slot.endIso,
    topic: `${grounding.name} · ${args.attendee.name || (args.language === 'da-DK' ? 'Kundeopkald' : 'Caller')}`,
    notes: `Booket live i opkald ${args.callId}.`,
    label: 'voice_receptionist',
    holdSeconds: 600,
  });

  if (!held.ok) {
    return {
      ok: false,
      reason: 'slot_taken',
      message: 'Another call took this slot while the receptionist was speaking.',
      spokenRefusal:
        args.language === 'da-DK'
          ? 'Den tid er desværre netop blevet reserveret. Jeg kan tilbyde den næste ledige.'
          : 'That time has just been reserved. I can offer the next available slot.',
    };
  }

  const hold = held.hold;
  const offer = formatSlotOffer(args.slot, args.language, grounding.calendar.timeZone);

  if (!config.configured) {
    // No Cal.com: the local hold is the appointment, and the confirmation says
    // exactly that — a colleague confirms it. Nothing here claims a booking that
    // exists only in our own table.
    return {
      ok: true,
      holdId: hold.id,
      bookingUid: null,
      needsConfirmation: true,
      provider: 'local_hold',
      startIso: args.slot.startIso,
      endIso: args.slot.endIso,
      spokenConfirmation:
        args.language === 'da-DK'
          ? `Jeg har reserveret ${offer}. En kollega bekræfter hos ${grounding.name}.`
          : `I have reserved ${offer}. A colleague will confirm with ${grounding.name}.`,
    };
  }

  const payload = buildBookingPayload(
    config,
    args.slot,
    {
      name: args.attendee.name,
      email: args.attendee.email,
      phone: args.attendee.phone,
      language: args.language,
    },
    {
      tenantId: args.tenantId,
      callId: args.callId,
      contactId: args.contactId ?? null,
      source: 'voice_receptionist',
      recordedBy: grounding.agentName,
    },
  );

  const booked = await createBooking(config, payload, { fetchImpl: deps.fetchImpl, now: () => nowMs });

  if (!booked.ok) {
    const network = booked.status === null;
    if (!network) {
      // A refusal we understand: give the slot back immediately so the next caller
      // can have it.
      await releaseSlotHold(deps.userId, args.tenantId, hold.id).catch(() => undefined);
    }
    return {
      ok: false,
      reason: 'provider_refused',
      message: network
        ? `${booked.error} The slot stays held for ten minutes while this is checked — it is not re-offered.`
        : booked.error,
      spokenRefusal:
        args.language === 'da-DK'
          ? `Jeg kan desværre ikke bekræfte ${offer} med det samme. Jeg noterer dig, og ${grounding.name} ringer op.`
          : `I cannot confirm ${offer} right now. I will take your details and ${grounding.name} will call you back.`,
    };
  }

  const claimed = await claimSlotHold(deps.userId, args.tenantId, hold.id).catch(() => null);
  if (claimed) {
    await insertBooking(deps.userId, {
      id: `calcom:${booked.bookingUid}`,
      tenantId: args.tenantId,
      contactId: args.contactId ?? null,
      callLogId: null,
      provider: 'calcom',
      startIso: booked.startIso ?? args.slot.startIso,
      endIso: booked.endIso ?? args.slot.endIso,
      label: 'voice_receptionist',
      topic: payload.attendee.name,
      attendeeName: payload.attendee.name,
      attendeeEmail: payload.attendee.email,
      attendeePhone: args.attendee.phone,
      icsUid: `calcom-${booked.bookingUid}@${grounding.slug}`,
    }).catch(() => undefined);
  }

  return {
    ok: true,
    holdId: hold.id,
    bookingUid: booked.bookingUid,
    needsConfirmation: booked.needsConfirmation,
    provider: 'calcom',
    startIso: booked.startIso ?? args.slot.startIso,
    endIso: booked.endIso ?? args.slot.endIso,
    spokenConfirmation: booked.needsConfirmation
      ? args.language === 'da-DK'
        ? `${offer} er noteret og sendt til bekræftelse hos ${grounding.name}.`
        : `${offer} is noted and sent to ${grounding.name} for confirmation.`
      : args.language === 'da-DK'
        ? `${offer} er bekræftet. Du får en SMS med linket.`
        : `${offer} is confirmed. You will get a text with the link.`,
  };
}

// -----------------------------------------------------------------------------
// End of call
// -----------------------------------------------------------------------------

export interface CallWrapUp {
  readonly session: TelephonySession;
  readonly persisted: boolean;
  readonly turns: number;
  readonly released: boolean;
}

/**
 * Finish a call. `completed` for a normal goodbye, `failed` when the media path or
 * the provider died — the distinction is what makes the missed-call count mean
 * something to the owner in the morning.
 */
export async function endInboundCall(
  session: TelephonySession,
  args: {
    readonly reason: 'hangup' | 'caller_gave_up' | 'call_failed' | 'transferred';
    readonly actor: GroundingActor | null;
    readonly registry?: SessionRegistry;
    readonly context?: PersistContext;
    readonly now?: () => number;
  },
): Promise<CallWrapUp> {
  const now = args.now?.() ?? Date.now();
  const terminal = args.reason === 'call_failed' ? 'failed' : 'completed';
  const transition = transitionTo(session, terminal);
  const finalSession = transition.ok ? transition.session : session;
  const registry = args.registry ?? telephonyRegistry();
  const released = registry.release(finalSession.callId);

  let persisted = false;
  if (args.actor && args.context) {
    persisted = await persistSession(args.actor, finalSession, {
      ...args.context,
      startedAtIso: args.context.startedAtIso,
    });
  }

  return {
    session: finalSession,
    persisted,
    turns: finalSession.transcript.length,
    released,
  };
}

// -----------------------------------------------------------------------------
// The live call, between dispatch and hang-up
//
// The registry holds the session (status, transcript, latency); the binding below
// holds everything needed to write the ledger a *second* time: the RLS actor whose
// scope owns the row, and the grounding/room/voice/calendar facts captured at
// dispatch. Without that, `/api/telephony/session` could fold a turn into the
// in-memory session but could not persist it — and a ledger that records only the
// first write is a ledger of greetings.
// -----------------------------------------------------------------------------

export interface LiveCallBinding {
  readonly actor: GroundingActor;
  readonly context: PersistContext;
  /** Barge-in counters, folded in as the browser or the room reports them. */
  bargeIn: BargeInTelemetry | null;
}

const bindingKey = '__omniTelephonyCallBindings';
const bindingGlobal = globalThis as unknown as Record<typeof bindingKey, Map<string, LiveCallBinding> | undefined>;

function bindings(): Map<string, LiveCallBinding> {
  if (!bindingGlobal[bindingKey]) bindingGlobal[bindingKey] = new Map();
  return bindingGlobal[bindingKey];
}

/**
 * Bind a dispatched call to the actor and facts its ledger row needs.
 *
 * The binding lives in the process that answered the call, next to the session
 * itself, and is dropped when the call closes. If the worker restarts, the binding
 * is gone and the call is finished as far as this process is concerned — which is
 * precisely what `telephony_call_sessions` exists for.
 */
export function bindLiveCall(callId: string, binding: Omit<LiveCallBinding, 'bargeIn'>): void {
  const store = bindings();
  // Bounded by 4x the concurrency ceiling: a binding whose call leaked past the
  // registry must not grow an unbounded map in a long-lived worker.
  const ceiling = telephonyRegistry().capacityLimit * 4;
  while (store.size >= ceiling) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  store.set(callId, { ...binding, bargeIn: null });
}

export function liveCallBinding(callId: string): LiveCallBinding | null {
  return bindings().get(callId) ?? null;
}

/** Idempotent: forgetting a call that is already gone changes nothing and says so. */
export function forgetLiveCall(callId: string): boolean {
  return bindings().delete(callId);
}

export interface TurnReceipt {
  readonly ok: boolean;
  readonly applied: boolean;
  readonly status: TelephonySession['status'] | 'not_found';
  readonly reason: string | null;
  readonly session: TelephonySession | null;
  readonly persisted: boolean;
  readonly latency: LatencyVerdict | null;
  readonly turns: number;
}

/**
 * Fold one turn into the live session and write the ledger.
 *
 * `atMs` is monotonic milliseconds since session start — never a wall clock, since
 * a stepped clock would turn a 90 ms interruption into a negative one. The one
 * number the reporter may supply about time *spent* is `measuredRoundTripMs`, and
 * it is folded through `observeLatency` (a decaying average) rather than replacing
 * the session's value, so one scheduler hiccup does not make a healthy tenant look
 * broken.
 */
export async function recordTurnOnLiveCall(
  callId: string,
  turn: { readonly role: TelephonyTranscriptRole; readonly text: string; readonly atMs: number },
  options: { readonly measuredRoundTripMs?: number; readonly language?: TelephonyLanguage } = {},
): Promise<TurnReceipt> {
  const session = telephonyRegistry().get(callId);
  if (!session) {
    return {
      ok: false,
      applied: false,
      status: 'not_found',
      reason: 'This call is not live in this worker.',
      session: null,
      persisted: false,
      latency: null,
      turns: 0,
    };
  }

  const budgetMs = liveCallBinding(callId)?.context.grounding.bargeInBudgetMs || BARGE_IN_BUDGET_MS;
  let next = appendTurn(session, turn.role, turn.text, turn.atMs).session;
  if (typeof options.measuredRoundTripMs === 'number' && Number.isFinite(options.measuredRoundTripMs)) {
    next = observeLatency(next, options.measuredRoundTripMs);
  }
  if (options.language && options.language !== next.language) {
    // Mid-call switch: the caller changed language, the agent follows, and the ledger
    // records what the caller heard from here on.
    next = { ...next, language: options.language };
  }
  telephonyRegistry().update(next);

  const binding = liveCallBinding(callId);
  const persisted = binding
    ? await persistSession(binding.actor, next, { ...binding.context, bargeIn: binding.bargeIn })
    : false;

  return {
    ok: true,
    // `applied` is about *this* turn: a consecutive duplicate is dropped by
    // `appendTurn` (the caller's own voice, echoed back through an open speaker, is
    // the most common phantom line) and must not be reported as new content.
    applied: next.transcript.length !== session.transcript.length,
    status: next.status,
    reason: null,
    session: next,
    persisted,
    latency: judgeLatency(next.latencyMs, budgetMs),
    turns: next.transcript.length,
  };
}

export interface BargeInReceipt {
  readonly ok: boolean;
  readonly persisted: boolean;
  readonly withinBudget: boolean;
  readonly overByMs: number;
  readonly budgetMs: number;
  readonly commits: number;
  readonly overBudgetCommits: number;
  readonly worstMs: number;
}

/**
 * Record a barge-in — the event the sub-150 ms promise is measured by.
 *
 * The counters are computed *here*, not taken from the reporter: a browser that
 * wanted a green dashboard would send `withinBudget: true` and `commits: 0`.
 * `judgeLatency` re-derives the verdict against the tenant's own budget, the run of
 * commits and over-budget commits is accumulated from the previous state, and the
 * persisted numbers are the recomputed ones. The reporter still decides *when* an
 * interruption happened; it cannot decide whether it was fast.
 */
export async function reportBargeInOnLiveCall(
  callId: string,
  report: {
    readonly latencyMs: number;
    readonly echoGuardBlocks?: number;
    readonly path?: 'sustained' | 'double_talk' | 'forced';
  },
): Promise<BargeInReceipt> {
  const session = telephonyRegistry().get(callId);
  const binding = liveCallBinding(callId);
  const fallbackBudget = binding?.context.grounding.bargeInBudgetMs || BARGE_IN_BUDGET_MS;
  if (!session || !binding) {
    return {
      ok: false,
      persisted: false,
      withinBudget: false,
      overByMs: 0,
      budgetMs: fallbackBudget,
      commits: 0,
      overBudgetCommits: 0,
      worstMs: 0,
    };
  }

  const verdict = judgeLatency(report.latencyMs, fallbackBudget);
  // The arithmetic of "how many interruptions, how many too slow, what was the
  // worst" lives in `mergeBargeInTelemetry`, because the browser's own meter runs
  // the same numbers locally and the two must not be written twice.
  const folded = mergeBargeInTelemetry(binding.bargeIn, {
    commit: { latencyMs: verdict.measuredMs, withinBudget: verdict.withinBudget },
    budgetMs: fallbackBudget,
    ...(report.echoGuardBlocks === undefined ? {} : { echoGuardBlocks: report.echoGuardBlocks }),
  });
  bindings().set(callId, { ...binding, bargeIn: folded });

  const measured = observeLatency(session, verdict.measuredMs);
  telephonyRegistry().update(measured);
  const persisted = await persistSession(binding.actor, measured, { ...binding.context, bargeIn: folded });

  return {
    ok: true,
    persisted,
    withinBudget: verdict.withinBudget,
    overByMs: verdict.overByMs,
    budgetMs: fallbackBudget,
    commits: folded.commits,
    overBudgetCommits: folded.overBudget,
    worstMs: folded.worstMs,
  };
}

/** Everything the studio meter and the operator's "what happened" panel need. */
export interface LiveCallSnapshot {
  readonly found: boolean;
  readonly projection: SessionProjection | null;
  readonly bargeIn: BargeInTelemetry | null;
  readonly latency: LatencyVerdict;
  readonly capacity: { readonly active: number; readonly limit: number };
}

export function liveCallSnapshot(callId: string): LiveCallSnapshot {
  const session = telephonyRegistry().get(callId);
  const binding = liveCallBinding(callId);
  const budgetMs = binding?.context.grounding.bargeInBudgetMs || BARGE_IN_BUDGET_MS;
  return {
    found: Boolean(session),
    projection: session ? projectSession(session, Date.now()) : null,
    bargeIn: binding?.bargeIn ?? null,
    latency: judgeLatency(session?.latencyMs ?? 0, budgetMs),
    capacity: { active: telephonyRegistry().activeCount, limit: telephonyRegistry().capacityLimit },
  };
}

/**
 * Close a live call by id: terminal transition, ledger write, capacity release,
 * binding dropped. Every step is idempotent, because a SIP BYE and a browser
 * `onDisconnected` are the same event arriving twice.
 */
export async function endLiveCall(
  callId: string,
  reason: 'hangup' | 'caller_gave_up' | 'call_failed' | 'transferred',
): Promise<{ ok: boolean; reason: 'not_found' | null; wrap: CallWrapUp | null }> {
  const session = telephonyRegistry().get(callId);
  if (!session) return { ok: false, reason: 'not_found', wrap: null };
  const binding = liveCallBinding(callId);

  const wrap = await endInboundCall(session, {
    reason,
    actor: binding?.actor ?? null,
    ...(binding ? { context: { ...binding.context, bargeIn: binding.bargeIn } } : {}),
  });
  forgetLiveCall(callId);
  return { ok: true, reason: null, wrap };
}
