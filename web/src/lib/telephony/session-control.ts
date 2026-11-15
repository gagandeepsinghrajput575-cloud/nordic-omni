import { BargeInController, deriveBargeInPolicy, type BargeInCommit, type BargeInTelemetry } from './barge-in';
import { appendTurn, observeLatency, transitionTo } from './session-machine';
import { judgeLatency, type TelephonyLanguage, type TelephonySession, type TelephonyTranscriptRole } from './types';
import type { CallerTurnSchema, EndCallBodySchema } from './contracts';
import type { z } from 'zod';

/**
 * Live-call state folding — the part of the control plane that is pure enough to
 * run in a browser and deterministic enough to unit-test without a socket.
 *
 * Why this module exists: two very different places observe the same call. The
 * telephony worker observes it from the provider socket; the console's dial-in
 * bench observes it from a WebRTC track in the same tab. Both must apply *the same
 * rules* — consecutive duplicate turns collapse, latency is an exponential
 * average, a terminal session never reopens — or the ledger says one thing and
 * the meter another. So the rules live here once, and each caller keeps only its
 * own transport.
 *
 * Nothing in this file performs I/O.
 */

export type CallerTurnInput = z.infer<typeof CallerTurnSchema>;
export type EndCallInput = z.infer<typeof EndCallBodySchema>;

export interface FoldResult {
  readonly session: TelephonySession;
  /** False when the session was already terminal, or the text was empty. */
  readonly applied: boolean;
  readonly reason: string | null;
}

/**
 * Fold one spoken turn into the session.
 *
 * `atMs` is monotonic-clock milliseconds since the session origin, *not* a wall
 * clock: the difference between two instants in one call must not move when NTP
 * steps the host. A caller-side clock that jumps would otherwise turn a 90 ms
 * barge-in into a negative one, and a negative latency is the kind of number that
 * makes a whole dashboard untrustworthy.
 */
export function foldCallerTurn(
  session: TelephonySession,
  turn: { readonly role: TelephonyTranscriptRole; readonly text: string; readonly atMs: number },
  options: { readonly measuredRoundTripMs?: number } = {},
): FoldResult {
  const text = turn.text.trim();
  if (!text) {
    return { session, applied: false, reason: 'empty_transcript' };
  }
  if (!Number.isFinite(turn.atMs) || turn.atMs < 0) {
    return { session, applied: false, reason: 'invalid_timestamp' };
  }

  const appended = appendTurn(session, turn.role, text, turn.atMs);
  const withLatency =
    typeof options.measuredRoundTripMs === 'number' && Number.isFinite(options.measuredRoundTripMs)
      ? observeLatency(appended.session, options.measuredRoundTripMs)
      : appended.session;

  // A caller speaking proves the call is still alive. `transferring` accepts a
  // turn — the human took the floor — while `connecting` and the terminal states
  // do not, so a late transcript cannot resurrect a finished call.
  const reopened =
    withLatency.status === 'transferring'
      ? transitionTo(withLatency, 'active').ok
        ? transitionTo(withLatency, 'active').session
        : withLatency
      : withLatency;

  return {
    session: reopened,
    applied: appended.appended,
    reason: appended.appended ? null : 'duplicate_of_previous_turn',
  };
}

/** The measured verdict the meter and the ledger both render — one computation. */
export function latencyVerdictOf(session: TelephonySession, budgetMs: number) {
  return judgeLatency(session.latencyMs, budgetMs);
}

export interface BargeInReport {
  readonly callId: string;
  readonly latencyMs: number;
  readonly budgetMs: number;
  readonly withinBudget: boolean;
  readonly overByMs: number;
  readonly path: BargeInCommit['path'];
  readonly atMs: number;
}

export function bargeInReportOf(
  callId: string,
  commit: BargeInCommit,
  budgetMs: number,
  atMs: number = commit.committedAtMs,
): BargeInReport {
  // `judgeLatency` is the only place the verdict is computed, so the browser meter
  // and the ledger column can never disagree about whether a commit was in budget.
  const verdict = judgeLatency(commit.latencyMs, budgetMs);
  return {
    callId,
    latencyMs: verdict.measuredMs,
    budgetMs: verdict.budgetMs,
    withinBudget: verdict.withinBudget,
    overByMs: verdict.overByMs,
    path: commit.path,
    atMs: Math.round(atMs),
  };
}

export interface BrowserBargeInTracker {
  readonly controller: BargeInController;
  readonly startedAtMs: number;
  /** Feed one analyser frame. `rms` is 0..1, the same scale `useAudioBands` publishes. */
  push(rms: number): void;
  agentStarted(): void;
  agentStopped(): void;
  /** The caller hit the mic manually (a "wait" button, a keyboard interrupt). */
  force(): void;
  telemetry(): BargeInTelemetry;
  snapshot(): ReturnType<BargeInController['snapshot']>;
}

/**
 * A barge-in tracker for the browser.
 *
 * `nowMs` is `performance.now()` minus the session origin, so the samples share a
 * clock with the transcript the caller will POST later. `onCommit` is called
 * synchronously — the browser must mute its own playback inside that callback, and
 * a `fetch` before the mute is latency the caller hears. The report is what gets
 * POSTed afterwards, on the next microtask, and it is telemetry rather than
 * control: dropping the request must never leave the caller talking to a dead agent.
 */
export function createBrowserBargeInTracker(args: {
  readonly startedAtMs: number;
  readonly vadThreshold?: number;
  readonly bargeInSensitivity?: number;
  readonly budgetMs?: number;
  readonly nowMs?: () => number;
  readonly onCommit: (report: BargeInReport, commit: BargeInCommit) => void;
}): BrowserBargeInTracker {
  const origin = args.startedAtMs;
  const clock = args.nowMs ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const policy = deriveBargeInPolicy({
    vadThreshold: args.vadThreshold ?? 65,
    bargeInSensitivity: args.bargeInSensitivity ?? 85,
    ...(args.budgetMs === undefined ? {} : { budgetMs: args.budgetMs }),
  });

  const controller = new BargeInController({
    policy,
    onCommit: (commit) => {
      args.onCommit(bargeInReportOf('browser', commit, policy.budgetMs), commit);
    },
  });

  const at = (): number => Math.max(0, Math.round(clock() - origin));

  return {
    controller,
    startedAtMs: origin,
    push: (rms: number) => {
      controller.push({ atMs: at(), rms });
    },
    agentStarted: () => controller.beginAgentTurn(at()),
    agentStopped: () => controller.endAgentTurn(at()),
    force: () => controller.forceCommit(at()),
    telemetry: () => controller.telemetry(),
    snapshot: () => controller.snapshot(),
  };
}

/**
 * Why the browser is allowed to speak. A call in `connecting` has no agent to
 * interrupt yet; a terminal call must not accept input at all — a text box that
 * still sends after hang-up is how a support queue fills with ghosts.
 */
export function acceptsCallerInput(status: TelephonySession['status']): boolean {
  return status === 'active' || status === 'transferring';
}

/** Language the caller should hear next, given what they just said. */
export function nextLanguageFor(
  session: TelephonySession,
  detected: TelephonyLanguage | null,
): TelephonyLanguage {
  return detected ?? session.language;
}
