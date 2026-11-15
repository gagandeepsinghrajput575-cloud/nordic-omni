import {
  BARGE_IN_BUDGET_MS,
  TRANSCRIPT_LIMIT,
  clampTranscript,
  type TelephonyLanguage,
  type TelephonySession,
  type TelephonySessionStatus,
  type TelephonyTranscriptEntry,
  type TelephonyTranscriptRole,
} from './types';

/**
 * The call lifecycle.
 *
 * `connecting → active → transferring → completed`, with `failed` reachable from
 * any non-terminal state. The graph is intentionally narrower than the set of
 * pairs: a WebRTC `Disconnected` that arrives after the caller already said
 * farvel must not resurrect a call, and a transfer that never lands must return
 * to `active` rather than skip to `completed`. Reversals are the classic way a
 * call log ends up reporting a conversation that never happened.
 */
const TRANSITIONS: Record<TelephonySessionStatus, readonly TelephonySessionStatus[]> = {
  connecting: ['active', 'transferring', 'failed'],
  active: ['transferring', 'completed', 'failed'],
  transferring: ['active', 'completed', 'failed'],
  completed: [],
  failed: [],
};

export const TERMINAL_STATUSES: readonly TelephonySessionStatus[] = ['completed', 'failed'];

export function isTerminal(status: TelephonySessionStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(
  from: TelephonySessionStatus,
  to: TelephonySessionStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export type TransitionRejection = 'terminal' | 'not_permitted';

export type TransitionResult =
  | {
      readonly ok: true;
      readonly session: TelephonySession;
    }
  | {
      readonly ok: false;
      readonly reason: TransitionRejection;
      readonly session: TelephonySession;
      readonly message: string;
    };

/**
 * Move a session forward, immutably.
 *
 * A rejected transition returns the *unchanged* session alongside the reason, so
 * a route can log the refusal without having to know whether the state moved.
 */
export function transitionTo(
  session: TelephonySession,
  next: TelephonySessionStatus,
): TransitionResult {
  if (session.status === next) {
    return { ok: true, session };
  }
  if (isTerminal(session.status)) {
    return {
      ok: false,
      reason: 'terminal',
      session,
      message: `Call ${session.callId} is already ${session.status}; ${next} cannot follow a terminal state`,
    };
  }
  if (!canTransition(session.status, next)) {
    return {
      ok: false,
      reason: 'not_permitted',
      session,
      message: `Call ${session.callId} cannot go from ${session.status} to ${next}`,
    };
  }
  return { ok: true, session: { ...session, status: next } };
}

export interface BeginSessionInput {
  readonly callId: string;
  readonly tenantId: string;
  readonly callerNumber: string;
  readonly language: TelephonyLanguage;
  readonly startedAtMs: number;
  readonly startedAtIso: string;
}

/** A session always begins `connecting`, with no transcript and no measurement. */
export function beginSession(input: BeginSessionInput): TelephonySession {
  return {
    callId: input.callId,
    tenantId: input.tenantId,
    callerNumber: input.callerNumber,
    language: input.language,
    status: 'connecting',
    latencyMs: 0,
    transcript: [],
    startedAtMs: input.startedAtMs,
    startedAtIso: input.startedAtIso,
  };
}

export interface AppendResult {
  readonly session: TelephonySession;
  /** True when the line was actually added, false when it was a duplicate. */
  readonly appended: boolean;
}

/**
 * Add one utterance.
 *
 * Consecutive duplicates are dropped: the caller's voice coming back through an
 * open speaker is the single most common source of phantom transcript lines, and
 * a transcript that repeats the agent's own sentence to the operator is a lie
 * about what the caller said.
 */
export function appendTurn(
  session: TelephonySession,
  role: TelephonyTranscriptRole,
  text: string,
  timestampMs: number,
): AppendResult {
  const trimmed = text.replace(/\s+/gu, ' ').trim();
  if (!trimmed) return { session, appended: false };

  const last = session.transcript[session.transcript.length - 1];
  if (last && last.role === role && last.text.toLowerCase() === trimmed.toLowerCase()) {
    return { session, appended: false };
  }

  const entry: TelephonyTranscriptEntry = {
    role,
    text: trimmed,
    timestampMs: Math.max(0, Math.round(timestampMs)),
  };
  return {
    session: { ...session, transcript: clampTranscript([...session.transcript, entry]) },
    appended: true,
  };
}

/**
 * Fold a new measurement into the session.
 *
 * The stored value is a decaying average rather than the last sample, because a
 * single scheduler hiccup on one turn must not make a healthy tenant look broken
 * — but a *violation* of the barge-in budget is reported on its own terms by
 * `judgeLatency`, so nothing is hidden by the smoothing either.
 */
export function observeLatency(session: TelephonySession, measuredMs: number): TelephonySession {
  if (!Number.isFinite(measuredMs) || measuredMs < 0) return session;
  const sample = Math.round(measuredMs);
  const previous = session.latencyMs;
  const blended = previous <= 0 ? sample : Math.round(previous * 0.6 + sample * 0.4);
  return { ...session, latencyMs: blended };
}

export interface SessionProjection {
  readonly callId: string;
  readonly tenantId: string;
  readonly callerNumber: string;
  readonly language: TelephonyLanguage;
  readonly status: TelephonySessionStatus;
  readonly latencyMs: number;
  readonly turns: number;
  readonly durationMs: number;
  readonly bargeInWithinBudget: boolean;
  readonly lastSpeaker: TelephonyTranscriptRole | null;
}

/**
 * What the console (and the dispatch response) is allowed to see.
 *
 * The full transcript never leaves the server in a dispatch payload — the caller's
 * words are personal data, and a ring-tone preview needs a count, not content.
 */
export function projectSession(
  session: TelephonySession,
  nowMs: number,
): SessionProjection {
  const last = session.transcript[session.transcript.length - 1];
  const verdict = session.latencyMs <= BARGE_IN_BUDGET_MS;
  return {
    callId: session.callId,
    tenantId: session.tenantId,
    callerNumber: session.callerNumber,
    language: session.language,
    status: session.status,
    latencyMs: session.latencyMs,
    turns: session.transcript.length,
    durationMs: Math.max(0, Math.round(nowMs - session.startedAtMs)),
    bargeInWithinBudget: verdict,
    lastSpeaker: last ? last.role : null,
  };
}

// -----------------------------------------------------------------------------
// Concurrency ceiling
// -----------------------------------------------------------------------------

export interface RegistryStats {
  readonly activeCount: number;
  readonly limit: number;
  readonly rejectedCount: number;
  readonly headroom: number;
}

/**
 * Bounded set of live calls.
 *
 * Three properties the telephony worker learned the hard way and that are cheap
 * to keep here:
 *   1. `activeCount <= limit` always holds — an over-capacity room is refused,
 *      never queued silently, so the caller gets a real `404/486` instead of a
 *      forty-second ring into a dead worker.
 *   2. `release()` is idempotent. A duplicate hang-up event (SIP BYE plus a
 *      WebRTC `Disconnected` is normal) must not free someone else's slot.
 *   3. `acquire()` on a key that is already present is a no-op that reports
 *      `duplicated`, so a retried webhook cannot double-count a call.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, TelephonySession>();
  private readonly maxActive: number;
  private rejected = 0;

  constructor(limit: number = 8) {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new RangeError('SessionRegistry limit must be a positive integer');
    }
    this.maxActive = Math.floor(limit);
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  get capacityLimit(): number {
    return this.maxActive;
  }

  get(key: string): TelephonySession | undefined {
    return this.sessions.get(key);
  }

  acquire(session: TelephonySession): {
    readonly admitted: boolean;
    readonly duplicated: boolean;
    readonly reason: 'capacity' | null;
  } {
    if (this.sessions.has(session.callId)) {
      return { admitted: true, duplicated: true, reason: null };
    }
    if (this.sessions.size >= this.maxActive) {
      this.rejected += 1;
      return { admitted: false, duplicated: false, reason: 'capacity' };
    }
    this.sessions.set(session.callId, session);
    return { admitted: true, duplicated: false, reason: null };
  }

  update(session: TelephonySession): boolean {
    if (!this.sessions.has(session.callId)) return false;
    this.sessions.set(session.callId, session);
    return true;
  }

  /** Idempotent by design: unknown or already-released ids change nothing. */
  release(callId: string): boolean {
    return this.sessions.delete(callId);
  }

  list(): TelephonySession[] {
    return Array.from(this.sessions.values());
  }

  stats(): RegistryStats {
    return {
      activeCount: this.sessions.size,
      limit: this.maxActive,
      rejectedCount: this.rejected,
      headroom: Math.max(0, this.maxActive - this.sessions.size),
    };
  }

  /** Every entry is dropped; used when a worker is shutting down. */
  drain(): TelephonySession[] {
    const drained = this.list();
    this.sessions.clear();
    return drained;
  }
}

/**
 * Transcript preview for the SIP session ledger: the last thing either side said,
 * never the whole conversation.
 */
export function transcriptPreview(session: TelephonySession): string {
  const last = session.transcript[session.transcript.length - 1];
  if (!last) return 'Live inbound call — greeting dispatched to the SIP participant.';
  const who = last.role === 'agent' ? 'Agent' : 'Caller';
  return `${who}: ${last.text.slice(0, 240)}`;
}

export { TRANSCRIPT_LIMIT };
