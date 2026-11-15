/**
 * Telephony bridge — the shared type spine.
 *
 * Everything in `lib/telephony` is built on these types. The module is split so
 * that the *decision-making* code (state machines, barge-in gating, provider
 * protocol framing, slot arithmetic) has no I/O and no Next.js coupling, while
 * the two adapters that do touch Postgres and the environment
 * (`tenant-grounding.ts`, `bridge.ts`) stay thin. That split is what makes the
 * latency contract unit-testable: a controller you can drive with a synthetic
 * clock is a controller you can prove is under 150 ms.
 *
 * `language` is deliberately `da-DK | en-GB` rather than the console's stored
 * `en-US`: the tenant record describes the *operator's* preference (the agency
 * console is US English), while a PSTN caller reaching a Danish reception desk
 * hears British English unless they speak Danish first. `tenantLanguage()` is the
 * single place that mapping happens.
 */

export const TELEPHONY_LANGUAGES = ['da-DK', 'en-GB'] as const;
export type TelephonyLanguage = (typeof TELEPHONY_LANGUAGES)[number];

export const TELEPHONY_SESSION_STATUSES = [
  'connecting',
  'active',
  'transferring',
  'completed',
  'failed',
] as const;
export type TelephonySessionStatus = (typeof TELEPHONY_SESSION_STATUSES)[number];

export const TELEPHONY_TRANSCRIPT_ROLES = ['agent', 'caller'] as const;
export type TelephonyTranscriptRole = (typeof TELEPHONY_TRANSCRIPT_ROLES)[number];

/**
 * One utterance. `timestampMs` is *monotonic session time*, not wall clock: a
 * barge-in verdict is a difference between two instants in the same call, and a
 * wall clock that steps (NTP, suspend/resume on a laptop in a car) would turn a
 * 90 ms commit into a negative one.
 */
export interface TelephonyTranscriptEntry {
  readonly role: TelephonyTranscriptRole;
  readonly text: string;
  readonly timestampMs: number;
}

/**
 * The live call. This is the object the dispatch route, the room orchestrator
 * and the browser visualiser all agree on — one identity, one tenant, one
 * language, one monotonic status, one measured latency.
 */
export interface TelephonySession {
  readonly callId: string;
  readonly tenantId: string;
  readonly callerNumber: string;
  language: TelephonyLanguage;
  status: TelephonySessionStatus;
  /** Measured speech-end → first-audio-byte for the most recent turn. */
  latencyMs: number;
  transcript: TelephonyTranscriptEntry[];
  /** Session-origin clock, used to convert monotonic ms back to wall time. */
  readonly startedAtMs: number;
  readonly startedAtIso: string;
}

// -----------------------------------------------------------------------------
// Latency contract
// -----------------------------------------------------------------------------

/**
 * The barge-in ceiling. Interruption is committed — agent audio muted and the
 * provider told to truncate its turn — within this many milliseconds of the
 * caller's speech becoming unambiguous. Everything else in the budget is
 * acoustic; this number is the only part the bridge controls.
 */
export const BARGE_IN_BUDGET_MS = 150;

/**
 * The round-trip ceiling the studio meters already display. Barge-in is the
 * subset of it that must hold even while the agent is mid-sentence.
 */
export const ROUND_TRIP_BUDGET_MS = 300;

/** Turn budget for a PSTN caller: STT finalise → first LLM token → first byte. */
export const SPEECH_TO_SPEECH_BUDGET_MS = 600;

export const LATENCY_BUDGETS = {
  sttMs: 170,
  llmFirstTokenMs: 210,
  ttsFirstByteMs: 130,
} as const;

export interface LatencyBreakdown {
  readonly sttMs: number;
  readonly llmFirstTokenMs: number;
  readonly ttsFirstByteMs: number;
}

/** The honest round trip: the sum of the three streaming stages. */
export function roundTripOf(breakdown: LatencyBreakdown): number {
  return breakdown.sttMs + breakdown.llmFirstTokenMs + breakdown.ttsFirstByteMs;
}

export interface LatencyVerdict {
  readonly measuredMs: number;
  readonly budgetMs: number;
  readonly withinBudget: boolean;
  readonly overByMs: number;
  readonly ratio: number;
}

/**
 * One verdict function for every meter in the product.
 *
 * The ratio is clamped to 1 so a 4 s stall still draws a full bar (and still
 * reads as "over" through `overByMs`) rather than a 2,600 % wide div.
 */
/**
 * A tenant may only ever make the barge-in budget stricter. A configuration that
 * could loosen it is a configuration that silently abandons the product promise.
 */
export function clampBudget(valueMs: number): number {
  if (!Number.isFinite(valueMs)) return BARGE_IN_BUDGET_MS;
  return Math.round(Math.min(BARGE_IN_BUDGET_MS, Math.max(40, valueMs)));
}

export function judgeLatency(measuredMs: number, budgetMs: number): LatencyVerdict {
  const measured = Number.isFinite(measuredMs) ? Math.max(0, Math.round(measuredMs)) : 0;
  const budget = Number.isFinite(budgetMs) ? Math.max(1, Math.round(budgetMs)) : 1;
  return {
    measuredMs: measured,
    budgetMs: budget,
    withinBudget: measured <= budget,
    overByMs: Math.max(0, measured - budget),
    ratio: Math.min(1, measured / budget),
  };
}

// -----------------------------------------------------------------------------
// Language helpers
// -----------------------------------------------------------------------------

export function isDanish(language: TelephonyLanguage): boolean {
  return language === 'da-DK';
}

export function toShortLanguage(language: TelephonyLanguage): 'da' | 'en' {
  return isDanish(language) ? 'da' : 'en';
}

export function fromShortLanguage(language: 'da' | 'en'): TelephonyLanguage {
  return language === 'da' ? 'da-DK' : 'en-GB';
}

/**
 * Tenant records store `da-DK | en-US` (the console's enum) and contacts store
 * the short form. Anything English-ish becomes `en-GB` for the caller; only an
 * explicit Danish marker routes to `da-DK`. An unknown or missing value falls
 * back to Danish, because that is the language of the reception desk, not
 * because a fallback is cute.
 */
export function tenantLanguage(raw: string | null | undefined): TelephonyLanguage {
  const value = (raw ?? '').trim().toLowerCase();
  if (value.startsWith('da')) return 'da-DK';
  if (value.startsWith('en')) return 'en-GB';
  return 'da-DK';
}

/** Provider-side locale tags are BCP-47 in both directions. */
export function languageTag(language: TelephonyLanguage): string {
  return language;
}

export function otherLanguage(language: TelephonyLanguage): TelephonyLanguage {
  return isDanish(language) ? 'en-GB' : 'da-DK';
}

/**
 * A caller is understood in the language they *answered* in, so the bridge needs
 * a cheap detector rather than a model. Danish diacritics and a small set of
 * high-frequency function words are enough to flip a turn, and the agent's own
 * prompt already instructs it to follow the caller.
 */
const DANISH_MARKERS = [
  'æ',
  'ø',
  'å',
  ' og ',
  ' med ',
  ' til ',
  'jeg ',
  'du ',
  'hej',
  'tak',
  'ja,',
  'ring',
  'priser',
  'tid',
] as const;

export function detectLanguage(text: string, fallback: TelephonyLanguage): TelephonyLanguage {
  const probe = ` ${text.toLowerCase().replace(/\s+/gu, ' ')} `;
  let hits = 0;
  for (const marker of DANISH_MARKERS) {
    if (probe.includes(marker)) hits += 1;
  }
  if (hits >= 2) return 'da-DK';
  if (/\b(the|you|your|please|hello|thanks|booking|price|hours)\b/u.test(probe)) return 'en-GB';
  return fallback;
}

// -----------------------------------------------------------------------------
// Transcript window
// -----------------------------------------------------------------------------

/**
 * A call is short, but a bridge that outlives its caller must not grow without
 * bound. 240 turns is roughly an hour of receptionist traffic; beyond that the
 * oldest turns fall off the front of the array.
 */
export const TRANSCRIPT_LIMIT = 240;

export function clampTranscript<T>(entries: readonly T[]): T[] {
  if (entries.length <= TRANSCRIPT_LIMIT) return entries.slice();
  return entries.slice(entries.length - TRANSCRIPT_LIMIT);
}

/** Mask a caller number for logs and payloads: keep the last 4 digits. */
export function maskCallerNumber(callerNumber: string): string {
  const digits = callerNumber.replace(/\D/g, '');
  // A withheld CLI renders as an explicit mask, not as an empty cell: "anonymous"
  // and "no data" must look different in a ledger an owner reads in the morning.
  if (digits.length === 0) return '••••••••';
  if (digits.length <= 4) return '•'.repeat(digits.length);
  return `${'•'.repeat(Math.min(6, Math.max(0, digits.length - 4)))}${digits.slice(-4)}`;
}
