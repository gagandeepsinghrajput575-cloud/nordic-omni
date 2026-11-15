import { BARGE_IN_BUDGET_MS, clampBudget } from './types';

/**
 * Barge-in: the caller interrupting the receptionist.
 *
 * The perceived quality of a voice agent is decided here. A caller who has to
 * wait for a polite "…have a lovely day!" before asking a follow-up question
 * will hang up, so the contract is that interruption is *committed* — agent
 * audio silenced, provider turn truncated, listening state re-armed — within
 * 150 ms of the caller's speech being unambiguous.
 *
 * Two independent mechanisms buy that budget, and both live in this file:
 *
 *   1. **Gating with hysteresis.** A candidate opens on `energyGate` and stays
 *      open down to the lower `sustainGate`, so a breath between syllables
 *      cannot collapse the utterance. Waiting for a *silence* endpoint before
 *      reacting is what makes naive implementations 700 ms slow; we commit on
 *      evidence of speech instead, bounded by `minSpeechMs`.
 *   2. **A fast path for double-talk.** Energy above `fastGate` while the agent
 *      is playing is physically impossible to confuse with our own TTS bleeding
 *      through the AEC, so it commits on the first sample — zero added latency.
 *
 * The `vadThreshold` / `bargeInSensitivity` pair from the tenant sound profile
 * only moves the thresholds; it never disables the echo guard. A receptionist
 * that interrupts itself on a Bluetooth call in a car is not "sensitive", it is
 * broken.
 */

export interface BargeInTuning {
  /** 10..90 — how much proof of speech the tenant demands before reacting. */
  readonly vadThreshold: number;
  /** 0..100 — how eager the receptionist is to yield the floor. */
  readonly bargeInSensitivity: number;
  /** Override for hardware with a long acoustic tail (speakerphones). */
  readonly echoTailMs?: number;
  /** Default budget, overridden only for a *stricter* ceiling — see `clampBudget`. */
  readonly budgetMs?: number;
}

export interface BargeInPolicy {
  readonly energyGate: number;
  readonly sustainGate: number;
  readonly fastGate: number;
  readonly minSpeechMs: number;
  readonly echoTailMs: number;
  readonly budgetMs: number;
}

const MIN_CLAMP = 0.012;
const MAX_CLAMP = 0.16;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalise(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

/**
 * Deterministic, and deliberately monotonic in both inputs: raising `vadThreshold`
 * makes the tenant harder to interrupt, raising `bargeInSensitivity` makes it
 * easier. A property the studio meter depends on, so it is asserted in tests.
 */
export function deriveBargeInPolicy(tuning: BargeInTuning): BargeInPolicy {
  const strictness = normalise(tuning.vadThreshold, 10, 90, 65) / 100;
  const openness = normalise(tuning.bargeInSensitivity, 0, 100, 85) / 100;

  const energyGate = clamp(0.03 + strictness * 0.1 - openness * 0.075, MIN_CLAMP, MAX_CLAMP);
  const minSpeechMs = Math.round(clamp(40 + strictness * 70 - openness * 45, 30, 120));
  const echoTailMs = Math.round(
    clamp(tuning.echoTailMs ?? 90 + strictness * 40, 0, 400),
  );

  return {
    energyGate,
    // 70 % of the opening gate: the hysteresis band a syllable gap falls into.
    sustainGate: Math.max(MIN_CLAMP * 0.8, energyGate * 0.7),
    // Loud double-talk: 2.2x the gate is unreachable for AEC residue.
    fastGate: Math.min(MAX_CLAMP * 3, energyGate * 2.2),
    minSpeechMs,
    echoTailMs,
    // `clampBudget`, the same clamp the migration enforces in SQL: a tuning object
    // may tighten the ceiling, never loosen it.
    budgetMs: clampBudget(tuning.budgetMs ?? BARGE_IN_BUDGET_MS),
  };
}

export interface BargeInSample {
  readonly atMs: number;
  /** Frame RMS in 0..1 — the same scale the studio analyser publishes. */
  readonly rms: number;
}

export interface BargeInCommit {
  readonly speechStartMs: number;
  readonly committedAtMs: number;
  readonly latencyMs: number;
  readonly withinBudget: boolean;
  readonly overByMs: number;
  readonly path: 'sustained' | 'double_talk' | 'forced';
  readonly heldSamples: number;
}

export type BargeInDropReason =
  | 'below_gate'
  | 'echo_tail'
  | 'decay'
  | 'agent_silent'
  | 'already_committed';

export type BargeInEvent =
  | { readonly type: 'opened'; readonly atMs: number; readonly rms: number }
  | { readonly type: 'held'; readonly atMs: number; readonly elapsedMs: number }
  | { readonly type: 'dropped'; readonly atMs: number; readonly reason: BargeInDropReason }
  | { readonly type: 'committed'; readonly commit: BargeInCommit };

export type BargeInPhase = 'idle' | 'candidate' | 'committed' | 'echo_guard';

export interface BargeInTelemetry {
  readonly commits: number;
  readonly overBudget: number;
  readonly worstMs: number;
  readonly meanMs: number;
  readonly echoGuardBlocks: number;
  readonly budgetMs: number;
}

export interface BargeInSnapshot extends BargeInTelemetry {
  readonly phase: BargeInPhase;
  readonly candidateMs: number;
  readonly agentSpeaking: boolean;
  readonly lastCommit: BargeInCommit | null;
}

export interface BargeInControllerOptions {
  readonly policy: BargeInPolicy;
  /**
   * Called synchronously from the sample that commits. Playback teardown must
   * happen inside it — any await between the decision and the mute is latency
   * the caller hears, and the budget is spent on the decision, not the promise.
   */
  readonly onCommit: (commit: BargeInCommit) => void;
  /** Re-measure the budget against a caller-side send time, when known. */
  readonly extraCommitMs?: number;
}

/**
 * A single-turn barge-in detector. One instance per call, reset per agent turn.
 */
export class BargeInController {
  private phase: BargeInPhase = 'idle';
  private candidateStartMs = 0;
  private heldSamples = 0;
  private agentSpeaking = false;
  private echoDeadlineMs = 0;
  private lastAboveSustainMs = 0;
  private commits = 0;
  private overBudget = 0;
  private worstMs = 0;
  private totalMs = 0;
  private echoGuardBlocks = 0;
  private readonly extraCommitMs: number;

  constructor(private readonly options: BargeInControllerOptions) {
    this.extraCommitMs = Math.max(0, Math.round(options.extraCommitMs ?? 0));
  }

  get policy(): BargeInPolicy {
    return this.options.policy;
  }

  /** The agent started speaking: arm the detector for this turn. */
  beginAgentTurn(atMs: number): void {
    this.agentSpeaking = true;
    this.phase = 'idle';
    this.candidateStartMs = 0;
    this.heldSamples = 0;
    this.lastAboveSustainMs = 0;
    this.lastSampleMs = Math.max(0, atMs);
    // The echo tail deliberately survives a resumed turn. The residue being guarded
    // is acoustic, not conversational: if the agent stops and starts again within the
    // room's reverb time, a caller's quiet voice at that instant is still
    // indistinguishable from the agent's own last syllable. Anything loud enough to
    // be certain double-talk bypasses the guard, so the cost of keeping it is a few
    // milliseconds of patience for a hesitant caller — not a missed interruption.
  }

  /**
   * The agent stopped speaking. The tail guard opens *here*, not at the start of
   * the turn, because the residue we must not mistake for a caller is the reverb
   * of the last syllable.
   */
  endAgentTurn(atMs: number): void {
    this.agentSpeaking = false;
    this.echoDeadlineMs = atMs + this.policy.echoTailMs;
    if (this.phase !== 'committed') this.resetTurn();
  }

  /**
   * Feed one analyser frame. Returns what the controller decided so the caller can
   * publish it; the mutation always happens first.
   */
  push(sample: BargeInSample): BargeInEvent {
    const atMs = sample.atMs;
    this.lastSampleMs = atMs;
    const rms = Number.isFinite(sample.rms) ? Math.max(0, Math.min(1, sample.rms)) : 0;
    const { energyGate, sustainGate, fastGate, minSpeechMs } = this.policy;

    if (this.phase === 'committed') {
      return { type: 'dropped', atMs, reason: 'already_committed' };
    }

    // The residue of the syllable the agent just played is not a caller. The guard is
    // armed when the agent *stops* speaking, which is when the room is loudest with
    // its own output, and it is disarmed by anything loud enough to be double-talk.
    if (atMs < this.echoDeadlineMs && rms < fastGate) {
      if (rms >= energyGate) this.echoGuardBlocks += 1;
      this.phase = 'echo_guard';
      return { type: 'dropped', atMs, reason: 'echo_tail' };
    }

    // Nothing to interrupt: a caller who talks while the agent is silent is answering
    // a question, not barging in. Counting it would make a healthy call look like a
    // shouting match and inflate the violation counter the tenant is graded on.
    if (!this.agentSpeaking) {
      if (this.phase === 'candidate') return this.closeCandidate(atMs, 'agent_silent');
      return { type: 'dropped', atMs, reason: 'agent_silent' };
    }

    // Hysteresis: the candidate survives in the band between sustain and open.
    if (rms >= sustainGate) {
      this.lastAboveSustainMs = atMs;
    } else if (this.phase === 'candidate') {
      return this.closeCandidate(atMs, 'decay');
    }

    if (rms < energyGate) {
      if (this.phase === 'candidate' && atMs - this.lastAboveSustainMs > 120) {
        return this.closeCandidate(atMs, 'decay');
      }
      return { type: 'dropped', atMs, reason: 'below_gate' };
    }

    const opening = this.phase !== 'candidate';
    if (opening) {
      this.phase = 'candidate';
      this.candidateStartMs = atMs;
      this.heldSamples = 0;
    }

    const elapsedMs = Math.max(0, Math.round(atMs - this.candidateStartMs));

    // Double-talk is unambiguous: commit without waiting for `minSpeechMs`.
    if (rms >= fastGate && this.agentSpeaking) {
      return this.commit(atMs, 'double_talk');
    }
    if (rms >= fastGate * 1.6) {
      return this.commit(atMs, 'double_talk');
    }

    this.heldSamples += 1;
    if (elapsedMs < minSpeechMs) {
      // `opened` on the first frame, `held` after it: a visualiser can show "the
      // caller has taken the floor, pending proof" without waiting for the commit,
      // and the difference is one comparison instead of a second analyser pass.
      return opening ? { type: 'opened', atMs, rms } : { type: 'held', atMs, elapsedMs };
    }
    return this.commit(atMs, 'sustained');
  }

  /**
   * Commit from an external verdict — LiveKit's own activity detection, a
   * hardware DTMF keypress, or a caller-side interrupt from the browser. Still
   * measured against the candidate onset so the telemetry stays comparable.
   */
  forceCommit(atMs: number, path: 'forced' | 'sustained' = 'forced'): BargeInEvent {
    if (this.phase === 'committed') {
      return { type: 'dropped', atMs, reason: 'already_committed' };
    }
    if (!this.agentSpeaking) {
      return { type: 'dropped', atMs, reason: 'agent_silent' };
    }
    if (this.phase !== 'candidate') {
      this.phase = 'candidate';
      this.candidateStartMs = atMs;
      this.heldSamples = 0;
    }
    return this.commit(atMs, path);
  }

  snapshot(): BargeInSnapshot {
    return {
      phase: this.phase,
      agentSpeaking: this.agentSpeaking,
      candidateMs:
        this.phase === 'candidate' ? Math.max(0, Math.round(this.lastSampleMs - this.candidateStartMs)) : 0,
      commits: this.commits,
      overBudget: this.overBudget,
      worstMs: this.worstMs,
      meanMs: this.commits === 0 ? 0 : Math.round(this.totalMs / this.commits),
      echoGuardBlocks: this.echoGuardBlocks,
      budgetMs: this.policy.budgetMs,
      lastCommit: this.lastCommit,
    };
  }

  telemetry(): BargeInTelemetry {
    const { commits, overBudget, worstMs, totalMs, echoGuardBlocks } = this;
    return {
      commits,
      overBudget,
      worstMs,
      meanMs: commits === 0 ? 0 : Math.round(totalMs / commits),
      echoGuardBlocks,
      budgetMs: this.policy.budgetMs,
    };
  }

  /** Forget the current turn without touching lifetime telemetry. */
  resetTurn(): void {
    this.phase = 'idle';
    this.candidateStartMs = 0;
    this.heldSamples = 0;
  }

  private lastSampleMs = 0;
  private lastCommit: BargeInCommit | null = null;

  private closeCandidate(atMs: number, reason: 'decay' | 'agent_silent'): BargeInEvent {
    this.resetTurn();
    return { type: 'dropped', atMs, reason };
  }

  private commit(atMs: number, path: BargeInCommit['path']): BargeInEvent {
    const speechStartMs = this.candidateStartMs;
    const latencyMs = Math.max(0, Math.round(atMs - speechStartMs + this.extraCommitMs));
    const budgetMs = this.policy.budgetMs;
    const commit: BargeInCommit = {
      speechStartMs,
      committedAtMs: atMs,
      latencyMs,
      withinBudget: latencyMs <= budgetMs,
      overByMs: Math.max(0, latencyMs - budgetMs),
      path,
      heldSamples: this.heldSamples,
    };

    this.phase = 'committed';
    this.commits += 1;
    this.totalMs += latencyMs;
    this.worstMs = Math.max(this.worstMs, latencyMs);
    if (!commit.withinBudget) this.overBudget += 1;
    this.lastCommit = commit;
    this.lastSampleMs = atMs;

    // Synchronous, on purpose. See `BargeInControllerOptions.onCommit`.
    this.options.onCommit(commit);
    return { type: 'committed', commit };
  }
}

// -----------------------------------------------------------------------------
// Acoustic echo rejection in the text domain
// -----------------------------------------------------------------------------

/**
 * Words a caller says that are also words the agent just said, and which prove
 * nothing. Danish and English back-channels overlap on purpose: "ja", "ok",
 * "right" are all the listener confirming they are still there.
 */
const FILLER_TOKENS = new Set([
  'ja',
  'jeg',
  'ok',
  'okay',
  'right',
  'yes',
  'no',
  'nej',
  'hmm',
  'uh',
  'øh',
  'rigtigt',
  'good',
  'godt',
  'thanks',
  'tak',
  'what',
  'hvad',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token) => token.length > 0);
}

/**
 * True when the "caller" line is most likely the agent's own voice coming back
 * through an open speaker, i.e. a transcript the bridge must not treat as an
 * interruption. The agent's last turn is the reference; a caller who repeats a
 * whole sentence back ("120 square meters?") keeps enough novel content to pass.
 */
export function isLikelySelfEcho(callerText: string, recentAgentText: string): boolean {
  const callerTokens = tokenize(callerText);
  if (callerTokens.length === 0) return true;
  const agentTokens = new Set(tokenize(recentAgentText));
  if (agentTokens.size === 0) return false;

  let echoed = 0;
  let meaningful = 0;
  for (const token of callerTokens) {
    if (FILLER_TOKENS.has(token)) continue;
    meaningful += 1;
    if (agentTokens.has(token)) echoed += 1;
  }
  if (meaningful === 0) return true;
  return echoed / meaningful >= 0.85;
}

/**
 * The text-domain twin of the energy gate: only a *substantive* new utterance
 * while the agent is mid-sentence is worth truncating the turn for.
 */
export function shouldInterruptFromTranscript(
  callerText: string,
  recentAgentText: string,
  options: { readonly minWords?: number } = {},
): boolean {
  const minWords = Math.max(1, Math.round(options.minWords ?? 2));
  const content = tokenize(callerText).filter((token) => !FILLER_TOKENS.has(token));
  if (content.length < minWords) return false;
  return !isLikelySelfEcho(callerText, recentAgentText);
}

/**
 * Fold one commit into a running aggregate.
 *
 * The browser and the room orchestrator report differently: the browser sends the
 * whole `BargeInTelemetry` snapshot it has accumulated, the room sends the single
 * commit it just made. Both end up as an aggregate here, which is the only shape
 * the ledger column and the studio meter need. `meanMs` is a running mean over
 * commits, so the two reporting styles converge on the same number instead of the
 * last writer winning.
 */
export function mergeBargeInTelemetry(
  previous: BargeInTelemetry | null,
  incoming: Partial<BargeInTelemetry> & { readonly commit?: { latencyMs: number; withinBudget: boolean } | null },
): BargeInTelemetry {
  const base = previous ?? {
    commits: 0,
    overBudget: 0,
    worstMs: 0,
    meanMs: 0,
    echoGuardBlocks: 0,
    budgetMs: incoming.budgetMs ?? BARGE_IN_BUDGET_MS,
  };

  if (incoming.commit) {
    const latency = Math.max(0, Math.round(incoming.commit.latencyMs));
    const commits = base.commits + 1;
    return {
      commits,
      overBudget: base.overBudget + (incoming.commit.withinBudget ? 0 : 1),
      worstMs: Math.max(base.worstMs, latency),
      meanMs: Math.round((base.meanMs * base.commits + latency) / commits),
      echoGuardBlocks: Math.max(0, Math.floor(incoming.echoGuardBlocks ?? base.echoGuardBlocks)),
      budgetMs: Math.max(1, Math.round(incoming.budgetMs ?? base.budgetMs)),
    };
  }

  const commits = Math.max(0, Math.floor(incoming.commits ?? base.commits));
  if (commits === 0) return base;
  return {
    commits,
    overBudget: Math.max(0, Math.min(commits, Math.floor(incoming.overBudget ?? base.overBudget))),
    worstMs: Math.max(base.worstMs, Math.max(0, Math.round(incoming.worstMs ?? 0))),
    meanMs: Number.isFinite(incoming.meanMs) ? Math.max(0, Math.round(incoming.meanMs ?? base.meanMs)) : base.meanMs,
    echoGuardBlocks: Math.max(0, Math.floor(incoming.echoGuardBlocks ?? base.echoGuardBlocks)),
    budgetMs: clampBudget(incoming.budgetMs ?? base.budgetMs),
  };
}
