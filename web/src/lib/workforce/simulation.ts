/**
 * The simulation engine for the dispatch console.
 *
 * Every "runner" below is a **deterministic pure function**: given the same
 * seed it produces the same output, with no clock, no randomness and no
 * network. That is what makes the prototype honest and the tests meaningful —
 * a simulation that used `Math.random()` could not be asserted on, and a
 * simulation that called a real API would not be a simulation.
 *
 * Nothing here executes a real agent. The UI says so.
 */

// -----------------------------------------------------------------------------
// Deterministic pseudo-randomness
// -----------------------------------------------------------------------------

/**
 * A small mulberry32 generator.
 *
 * Seeded rather than `Math.random()` so a re-render (or a test run) produces
 * the same stream. The seed is part of the function signature, so callers
 * cannot accidentally get a different answer on a second call.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, items: ReadonlyArray<T>): T =>
  items[Math.floor(rng() * items.length) % items.length];

// -----------------------------------------------------------------------------
// 1. Creative Director — angle synthesis
// -----------------------------------------------------------------------------

export type HookAngle = 'Direkte' | 'Nysgerrighed' | 'Social proof' | 'Problem' | 'Tids Pres';

export const HOOK_ANGLES: ReadonlyArray<HookAngle> = [
  'Direkte',
  'Nysgerrighed',
  'Social proof',
  'Problem',
  'Tids Pres',
];

/** One hook per angle, so a run always shows exactly five. */
const HOOK_TEMPLATES: ReadonlyArray<(subject: string) => string> = [
  (s) => `${s} — bookt på 48 timer, ellers gør din konkurrent det.`,
  (s) => `Hvad koster ${s} egentlig, hvis du kunne slippe for at svare telefonen?`,
  (s) => `142 virksomheder bruger ${s} i dag. Her er hvad de hører.`,
  (s) => `${s} uden at miste opkaldet, når du står med kunden.`,
  (s) => `Kun 3 pladser tilbage i september: ${s}.`,
];

export interface Hook {
  /** Stable id, so React keys are not index-derived. */
  id: string;
  angle: HookAngle;
  text: string;
  /** 0..1 quality signal, rendered as a bar. Deterministic per seed. */
  strength: number;
}

export interface AngleSynthesisResult {
  subject: string;
  hooks: ReadonlyArray<Hook>;
  /** Mean of the hook strengths, rounded to 2 decimals. */
  averageStrength: number;
}

/**
 * Synthesise five hooks, one per angle.
 *
 * Exactly five is a contract, not an accident: the UI renders a fixed-height
 * list and a test asserts `hooks.length === 5`, so a template change cannot
 * quietly produce four.
 */
export function synthesizeAngles(subject: string, seed = 7): AngleSynthesisResult {
  const rng = makeRng(seed);
  const trimmed = subject.trim() || 'AI-receptionen';
  const hooks: Hook[] = HOOK_ANGLES.map((angle, index) => {
    const text = HOOK_TEMPLATES[index](trimmed);
    return {
      id: `hook-${index}`,
      angle,
      text,
      strength: Math.round((0.55 + rng() * 0.42) * 100) / 100,
    };
  });
  const averageStrength =
    Math.round((hooks.reduce((sum, hook) => sum + hook.strength, 0) / hooks.length) * 100) / 100;
  return { subject: trimmed, hooks, averageStrength };
}

// -----------------------------------------------------------------------------
// 2. Paid Media — CBO rebalance
// -----------------------------------------------------------------------------

export interface BudgetLine {
  channel: string;
  before: number;
  after: number;
}

export interface CboRebalanceResult {
  lines: ReadonlyArray<BudgetLine>;
  totalBefore: number;
  totalAfter: number;
  /** CBO ceiling per day, in DKK. `after` never exceeds the total. */
  ceiling: number;
  /** True when the rebalance stays inside the ceiling. */
  withinCeiling: boolean;
}

/**
 * Rebalance a daily budget across channels.
 *
 * The guardrail is the whole point: the redistribution shifts weight toward
 * the better performer but may never exceed the ceiling. `withinCeiling` is
 * computed from the rounded values actually rendered, not from the
 * pre-rounding floats, so the badge cannot contradict the bars beside it.
 */
export function rebalanceCbo(
  before: ReadonlyArray<{ channel: string; spend: number }>,
  ceiling = 2400,
  seed = 11,
): CboRebalanceResult {
  const rng = makeRng(seed);
  const totalBefore = before.reduce((sum, line) => sum + line.spend, 0);

  // Weights: the best performer gets more, jittered deterministically.
  const weights = before.map((line) => 0.5 + rng() + line.spend / Math.max(1, totalBefore));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  const totalAfter = Math.min(ceiling, totalBefore);
  const lines: BudgetLine[] = before.map((line, index) => ({
    channel: line.channel,
    before: line.spend,
    after: Math.round((weights[index] / weightSum) * totalAfter),
  }));

  // Rounding can leave the sum a few kroner under the target; give the
  // remainder to the largest line so the bars add up to the displayed total.
  const allocated = lines.reduce((sum, line) => sum + line.after, 0);
  const remainder = totalAfter - allocated;
  if (remainder !== 0 && lines.length > 0) {
    let largest = 0;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].after > lines[largest].after) largest = i;
    }
    lines[largest] = { ...lines[largest], after: lines[largest].after + remainder };
  }

  const finalTotal = lines.reduce((sum, line) => sum + line.after, 0);
  return {
    lines,
    totalBefore,
    totalAfter: finalTotal,
    ceiling,
    withinCeiling: finalTotal <= ceiling,
  };
}

// -----------------------------------------------------------------------------
// 3. SEO / GEO — citation probe
// -----------------------------------------------------------------------------

export interface CitationSource {
  engine: 'Perplexity' | 'ChatGPT' | 'Google';
  cited: boolean;
  /** Position in the answer, 1-based; 0 when not cited. */
  position: number;
}

export interface CitationProbeResult {
  query: string;
  sources: ReadonlyArray<CitationSource>;
  /** 0..100 authority score. */
  score: number;
  band: 'stærk' | 'moderat' | 'svag';
  /** Pages that need structured data before the score can rise. */
  gaps: ReadonlyArray<string>;
}

function bandFor(score: number): CitationProbeResult['band'] {
  if (score >= 70) return 'stærk';
  if (score >= 40) return 'moderat';
  return 'svag';
}

/**
 * Probe how three answer engines cite the client.
 *
 * The score is derived from both coverage (how many engines cite us) and
 * position (how high), so a source that is cited but buried cannot produce the
 * same score as one cited first. Gaps are returned alongside rather than
 * implied by a low number.
 */
export function probeCitations(query: string, seed = 23): CitationProbeResult {
  const rng = makeRng(seed);
  const engines: ReadonlyArray<CitationSource['engine']> = ['Perplexity', 'ChatGPT', 'Google'];
  const sources: CitationSource[] = engines.map((engine) => {
    const cited = rng() > 0.28;
    return { engine, cited, position: cited ? 1 + Math.floor(rng() * 3) : 0 };
  });

  const cited = sources.filter((source) => source.cited);
  // Coverage is worth 60 points, position quality 40.
  const coverage = (cited.length / sources.length) * 60;
  const positionQuality =
    cited.length === 0
      ? 0
      : (cited.reduce((sum, source) => sum + (4 - source.position) / 3, 0) / cited.length) * 40;
  const score = Math.max(0, Math.min(100, Math.round(coverage + positionQuality)));

  const gaps: string[] = [];
  if (!sources[0].cited) gaps.push('Perplexity: ingen citation — mangler FAQPage-schema');
  if (!sources[1].cited) gaps.push('ChatGPT: ingen citation — mangler Organization-schema');
  if (!sources[2].cited) gaps.push('Google: ingen citation — mangler Service-schema');
  if (gaps.length === 0) gaps.push('Ingen huller fundet i denne prøve');

  return { query: query.trim() || 'ai telefonreception', sources, score, band: bandFor(score), gaps };
}

// -----------------------------------------------------------------------------
// 4. Voice Receptionist — call simulation
// -----------------------------------------------------------------------------

export interface TranscriptTurn {
  id: string;
  speaker: 'kunde' | 'agent';
  text: string;
  /** Milliseconds into the call. Drives the transcript reveal. */
  atMs: number;
}

export interface CallSimulationResult {
  durationMs: number;
  /** 0..1 amplitudes, one per bar. Deterministic for the seed. */
  waveform: ReadonlyArray<number>;
  transcript: ReadonlyArray<TranscriptTurn>;
  outcome: 'booket' | 'viderestillet' | 'taget notat';
  /** Round-trip latency in ms; always under the 300ms barge-in budget. */
  latencyMs: number;
}

const TURNS: ReadonlyArray<Omit<TranscriptTurn, 'id' | 'atMs'>> = [
  { speaker: 'agent', text: 'Nordic Omni, goddag. Hvad kan jeg hjælpe med?' },
  { speaker: 'kunde', text: 'Hej, jeg vil gerne have et tilbud på facaderens.' },
  { speaker: 'agent', text: 'Det kan jeg hjælpe med. Hvor mange kvadratmeter drejer det sig om?' },
  { speaker: 'kunde', text: 'Cirka 400, det er en ældre ejendom.' },
  { speaker: 'agent', text: 'Tak. Jeg har torsdag kl. 14.30 eller fredag kl. 9. Passer det?' },
  { speaker: 'kunde', text: 'Torsdag passer fint.' },
  { speaker: 'agent', text: 'Booket. Du får en bekræftelse på SMS om et øjeblik.' },
];

const OUTCOMES: ReadonlyArray<CallSimulationResult['outcome']> = [
  'booket',
  'booket',
  'viderestillet',
  'taget notat',
];

/**
 * Run a simulated inbound call.
 *
 * The transcript is authored, not generated word by word, so the text reads
 * like a real Danish call rather than lorem ipsum. The waveform is seeded, so
 * the same call always looks the same.
 */
export function simulateCall(seed = 31, bars = 56): CallSimulationResult {
  const rng = makeRng(seed);
  const step = 2400;
  const transcript: TranscriptTurn[] = TURNS.map((turn, index) => ({
    ...turn,
    id: `turn-${index}`,
    atMs: index * step,
  }));

  const waveform = Array.from({ length: bars }, (_, index) => {
    // A centre-weighted envelope, so the bars read as a call rather than noise.
    const envelope = 0.32 + 0.68 * Math.sin(Math.PI * (index / Math.max(1, bars - 1)));
    const jitter = 0.35 + rng() * 0.65;
    return Math.round(Math.min(1, envelope * jitter) * 100) / 100;
  });

  return {
    durationMs: transcript.length * step,
    waveform,
    transcript,
    outcome: pick(rng, OUTCOMES),
    // Always inside the 300ms barge-in budget the product is measured on.
    latencyMs: 110 + Math.round(rng() * 60),
  };
}

// -----------------------------------------------------------------------------
// Dispatch job bookkeeping
// -----------------------------------------------------------------------------

export type DispatchRunnerId = 'creative' | 'paid-media' | 'seo-geo' | 'voice';

export type DispatchState = 'idle' | 'running' | 'done';

/**
 * The state machine every runner follows.
 *
 * Kept as data so the console and the tests agree on the transitions rather
 * than each re-deriving them: idle → running → done, and any state → idle.
 */
export const NEXT_DISPATCH_STATE: Record<
  DispatchState,
  { next: DispatchState; label: string }
> = {
  idle: { next: 'running', label: 'Kør test-dispatch' },
  running: { next: 'done', label: 'Arbejder…' },
  done: { next: 'idle', label: 'Kør igen' },
};
