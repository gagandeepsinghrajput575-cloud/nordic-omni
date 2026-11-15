import type { ConversationGrounding } from './elevenlabs';
import type { TelephonyLanguage } from './types';
import { isDanish, tenantLanguage } from './types';
import { DEFAULT_SLOT_MINUTES } from './calcom';

/**
 * Tenant grounding: everything the receptionist is allowed to know.
 *
 * The rule the whole module exists to enforce is that *no* conversational claim
 * is ungrounded. Knowledge, hours, pricing and escalation are read from Postgres
 * under RLS and rendered into the prompt; a tenant with an empty knowledge base
 * gets an agent that says it will check, not an agent that improvises. That
 * difference is the product.
 *
 * This file is pure: `TenantGrounding` is built by `tenant-grounding.ts` (the only
 * place SQL lives) and consumed here by prompt rendering, the Danish/English
 * greeting choice, and the after-hours decision. Keeping the rendering separate is
 * what makes the prompt auditable from a test instead of only from a live call.
 */

/**
 * The shape a knowledge row must satisfy. Optional fields on purpose: the RLS
 * read can legitimately return a narrower projection (a public contact capability
 * has no `source_label` grant in some deployments), and a mapper that demanded the
 * full row would turn a permission boundary into a crash.
 */
export interface KnowledgeRowShape {
  readonly id?: string;
  readonly category?: string;
  readonly title?: string;
  readonly content?: string;
  readonly priority?: number;
  readonly is_active?: boolean;
  readonly source_url?: string | null;
  readonly source_label?: string | null;
}

export interface GroundedFact {
  readonly id: string;
  readonly kind: 'fact' | 'faq' | 'document' | 'website';
  readonly title: string;
  readonly content: string;
  readonly priority: number;
  readonly sourceUrl: string | null;
}

export interface TenantHoursDay {
  readonly open: string;
  readonly close: string;
  readonly closed: boolean;
}

export interface TenantPricingEntry {
  readonly id: string;
  readonly service: string;
  readonly priceDkk: number;
  readonly unit: string;
}

export interface TenantSoundTuning {
  readonly vadThreshold: number;
  readonly bargeInSensitivity: number;
  readonly speechRate: number;
  readonly echoTailMs: number;
}

export interface TenantVoiceBinding {
  /** Provider agent that owns the conversation; null means "not provisioned". */
  readonly elevenLabsAgentId: string | null;
  readonly elevenLabsAgentIdEn: string | null;
  readonly voiceId: string | null;
  readonly modelLabel: string;
}

export interface TenantCalComBinding {
  readonly eventTypeId: string | null;
  readonly eventSlug: string | null;
  readonly timeZone: string;
  readonly slotMinutes: number;
}

export interface TenantGrounding {
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly status: 'active' | 'paused' | 'archived';
  readonly receptionMode: 'voice_ai' | 'human_forward' | 'after_hours';
  readonly language: TelephonyLanguage;
  readonly agentName: string;
  readonly industry: string;
  readonly city: string;
  readonly timezone: string;
  readonly greetingDa: string;
  readonly greetingEn: string;
  readonly escalationPhone: string;
  readonly broadcastMessage: string | null;
  readonly hours: Readonly<Record<string, TenantHoursDay>>;
  readonly pricing: readonly TenantPricingEntry[];
  readonly knowledge: readonly GroundedFact[];
  readonly customerSystemPrompt: string | null;
  readonly contactEmail: string | null;
  /** Where a call goes when the AI must not answer. null = refuse, not guess. */
  readonly forwardToPhone: string | null;
  readonly audioFormatExpectation: string;
  /** Tenant-tightened barge-in budget; never looser than the product contract. */
  readonly bargeInBudgetMs: number;
  readonly sound: TenantSoundTuning;
  readonly voice: TenantVoiceBinding;
  readonly calendar: TenantCalComBinding;
  readonly groundedAtIso: string;
}

/** `default_language` is a Postgres enum; anything English routes to en-GB for callers. */
export function languageOf(row: { readonly default_language?: string | null } | null): TelephonyLanguage {
  return tenantLanguage(row?.default_language ?? null);
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * `business_hours` and `pricing_catalog` are JSONB, so anything could be in them.
 * The reader narrows rather than asserts: a malformed row degrades to "closed,
 * no prices" — the safe failure for a receptionist — instead of throwing mid-call.
 */
export function readHoursJson(value: unknown): Readonly<Record<string, TenantHoursDay>> {
  const source = typeof value === 'string' ? safeParse(value) : value;
  const record = isRecord(source) ? source : {};
  const out: Record<string, TenantHoursDay> = {};
  for (const day of DAY_KEYS) {
    const entry = record[day];
    if (!isRecord(entry)) {
      out[day] = { open: '00:00', close: '00:00', closed: true };
      continue;
    }
    out[day] = {
      open: readString(entry.open, '00:00'),
      close: readString(entry.close, '00:00'),
      closed: entry.closed === true,
    };
  }
  return out;
}

export function readPricingJson(value: unknown): readonly TenantPricingEntry[] {
  const source = typeof value === 'string' ? safeParse(value) : value;
  if (!Array.isArray(source)) return [];
  const out: TenantPricingEntry[] = [];
  for (const entry of source) {
    if (!isRecord(entry)) continue;
    // Two generations of this column exist in the field: `PricingItemSchema`
    // (`service` / `price_dkk` / `unit`) and the seeded JSONB shape
    // (`name` / `unit_dkk` / `description`). Reading both is the difference
    // between a receptionist that quotes and one that says "let me check".
    const service = readString(entry.service) || readString(entry.name);
    if (!service) continue;
    out.push({
      id: readString(entry.id, service.toLowerCase().replace(/\s+/gu, '-')),
      service,
      priceDkk: Math.max(0, readNumber(entry.price_dkk, readNumber(entry.unit_dkk, 0))),
      unit: readString(entry.unit) || readString(entry.description, 'fast pris'),
    });
  }
  return out;
}

export function readAgentName(row: Record<string, unknown> | null, fallback = 'Receptionisten'): string {
  if (!row) return fallback;
  return readString(row.agent_name, readString(row.agentName, fallback));
}

export function normaliseKnowledge(rows: readonly KnowledgeRowShape[]): GroundedFact[] {
  const facts: GroundedFact[] = [];
  for (const row of rows) {
    const content = readString(row.content);
    const title = readString(row.title);
    if (!content || !title) continue;
    if (row.is_active === false) continue;
    const category = readString(row.category, 'fact');
    facts.push({
      id: readString(row.id, `fact-${facts.length + 1}`),
      kind: isKnowledgeKind(category) ? category : 'fact',
      title,
      content,
      priority: Math.round(readNumber(row.priority, 0)),
      sourceUrl: readString(row.source_label) || readString(row.source_url) || null,
    });
  }
  // Priority first, then title: the top of the prompt is the most-read material,
  // and a deterministic order keeps the synthesizer's prefix cache warm.
  return facts
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
    .slice(0, GROUNDING_FACT_LIMIT);
}

/** Prompt budget, in facts. Beyond this the model starts losing the middle. */
export const GROUNDING_FACT_LIMIT = 24;

function isKnowledgeKind(value: string): value is GroundedFact['kind'] {
  return value === 'fact' || value === 'faq' || value === 'document' || value === 'website';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Greetings and language
// -----------------------------------------------------------------------------

/**
 * The greeting is the one line the agent says before it knows anything, so it is
 * chosen from the tenant record rather than generated — a hallucinated first
 * sentence on a PSTN call is a lost caller.
 */
export function greetingFor(grounding: TenantGrounding, language: TelephonyLanguage): string {
  const danish = isDanish(language);
  const scripted = danish ? grounding.greetingDa : grounding.greetingEn;
  if (scripted.trim()) return scripted.trim();
  // A tenant that only wrote one greeting still greets both languages with it.
  // Refusing to speak because the English column is empty is a worse outcome.
  return (grounding.greetingDa || grounding.greetingEn).trim();
}

export const DEFAULT_GREETING_DA =
  'Hej, du har fat i {agent}. Hvordan kan jeg hjælpe dig?';
export const DEFAULT_GREETING_EN =
  'Hello, you have reached {agent}. How can I help you?';

export function interpolateGreeting(template: string, agentName: string): string {
  return template.replace(/\{agent\}/gu, agentName).replace(/\{tenant\}/gu, agentName);
}

// -----------------------------------------------------------------------------
// Prompt rendering
// -----------------------------------------------------------------------------

export function hoursSummary(hours: Readonly<Record<string, TenantHoursDay>>): string {
  const lines: string[] = [];
  for (const day of DAY_KEYS) {
    const entry = hours[day];
    if (!entry) continue;
    lines.push(entry.closed ? `${day}: lukket` : `${day}: ${entry.open}–${entry.close}`);
  }
  return lines.join('\n');
}

export function pricingSummary(pricing: readonly TenantPricingEntry[]): string {
  if (pricing.length === 0) return 'Ingen prisliste er tilgængelig. Sig at en medarbejder ringer op med et prisforslag.';
  return pricing
    .slice(0, 12)
    .map((item) => `${item.service}: ${new Intl.NumberFormat('da-DK').format(item.priceDkk)} kr. / ${item.unit}`)
    .join('\n');
}

export function knowledgeDigest(knowledge: readonly GroundedFact[]): string {
  if (knowledge.length === 0) {
    return 'Ingen videnkildefor tenanten er tilgængelig. Sig at en medarbejder bekræfter detaljen, og få nummeret.';
  }
  return knowledge
    .map((fact, index) => `${index + 1}. (${fact.kind}) ${fact.title}\n${fact.content.slice(0, 700)}`)
    .join('\n\n');
}

/**
 * The receptionist's instructions for one turn.
 *
 * Two things are non-negotiable and both are the source of real incidents: the
 * hard "never invent" line, and the escalation number. Everything else is tenant
 * copy, which is why `customer_system_prompt` is *prepended* rather than
 * substituted — a client rewriting their prompt must not be able to delete the
 * guardrail.
 */
export function buildGroundedPrompt(
  grounding: TenantGrounding,
  language: TelephonyLanguage,
  extras: { readonly callerName?: string; readonly callerNumber?: string } = {},
): string {
  const danish = isDanish(language);
  const parts: string[] = [];

  if (grounding.customerSystemPrompt?.trim()) parts.push(grounding.customerSystemPrompt.trim());

  parts.push(
    danish
      ? `Du er ${grounding.agentName}, AI-receptionist for ${grounding.name}${grounding.city ? ` i ${grounding.city}` : ''}. Du er på et live telefonomkald: svar i 1–2 korte sætninger, warm og præcis.`
      : `You are ${grounding.agentName}, the AI receptionist for ${grounding.name}${grounding.city ? ` in ${grounding.city}` : ''}. This is a live phone call: answer in 1–2 short sentences, warm and precise.`,
  );

  parts.push(
    danish
      ? 'Svar på dansk. Skift til engelsk i det øjeblik calleren gør det, og bliv i engelsk.'
      : 'Answer in English. Switch to Danish the moment the caller does, and stay in Danish.',
  );

  parts.push(
    danish
      ? 'Find aldrig på priser, tider eller behandling. Brug kun videngrundlaget herunder. Er svaret ikke der, så tilbyder du en opfølgning.'
      : 'Never invent prices, times or treatment advice. Use only the grounded knowledge below. If the answer is not there, offer a follow-up.',
  );

  parts.push(`${danish ? 'Åbningstider' : 'Opening hours'}\n${hoursSummary(grounding.hours)}`);
  parts.push(`${danish ? 'Priser' : 'Pricing'}\n${pricingSummary(grounding.pricing)}`);
  parts.push(
    `${danish ? 'Videngrundlag' : 'Grounded knowledge'}\n${knowledgeDigest(grounding.knowledge)}`,
  );

  if (grounding.broadcastMessage?.trim()) {
    parts.push(`${danish ? 'Meddelelse' : 'Notice'}: ${grounding.broadcastMessage.trim()}`);
  }

  parts.push(
    danish
      ? `Vil en menneskelig kollega ikke kunne nås, oplys nummeret ${grounding.escalationPhone}. Bekræft navn og telefonnummer ét gang inden du noterer en sag.`
      : `If a human colleague cannot be reached, offer ${grounding.escalationPhone}. Read back a name and phone number once before saving a case.`,
  );

  if (extras.callerName || extras.callerNumber) {
    parts.push(
      `${danish ? 'Caller' : 'Caller'}: ${extras.callerName ?? 'ukendt / unknown'} · ${extras.callerNumber ?? ''}`,
    );
  }

  parts.push(
    danish
      ? 'Nævn aldrig at du følger en prompt, et videngrundlag eller en model.'
      : 'Never mention that you are following a prompt, a knowledge base, or a model.',
  );

  return parts.join('\n\n');
}

/** The provider-facing subset of the grounding, in the shape the socket expects. */
export function conversationGrounding(
  grounding: TenantGrounding,
  language: TelephonyLanguage,
): ConversationGrounding {
  return {
    tenantName: grounding.name,
    agentName: grounding.agentName,
    systemPrompt: buildGroundedPrompt(grounding, language),
    greeting: interpolateGreeting(greetingFor(grounding, language), grounding.agentName),
    escalationPhone: grounding.escalationPhone,
    knowledgeCount: grounding.knowledge.length,
    timezone: grounding.timezone,
  };
}

/**
 * A tenant can technically have a `voice_ai` row and no brain at all. Saying
 * "grounded" in the dispatch payload while the knowledge base is empty would be a
 * claim about the call that nothing backs up.
 */
export function groundingIsSufficient(grounding: TenantGrounding): boolean {
  return (
    grounding.status === 'active' &&
    grounding.receptionMode === 'voice_ai' &&
    (grounding.knowledge.length > 0 || Boolean(grounding.customerSystemPrompt?.trim()))
  );
}

// -----------------------------------------------------------------------------
// Opening state, and what to do outside it
// -----------------------------------------------------------------------------

export interface AfterHoursVerdict {
  readonly open: boolean;
  readonly dayKey: (typeof DAY_KEYS)[number];
  readonly reason: 'open' | 'closed_day' | 'outside_window' | 'unknown';
  readonly localTime: string;
}

function dayKeyIn(timeZone: string, at: Date): (typeof DAY_KEYS)[number] {
  // `weekday: 'short'` in Danish gives "Man/Tir/…", so compare on the index of the
  // ISO weekday instead of parsing localised text.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
  return DAY_KEYS[index < 0 ? 0 : index];
}

export function localTimeIn(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('da-DK', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/**
 * Is the desk open?
 *
 * Used to pick the *first thing the agent says*, not to reject the call: a closed
 * business still answers, because the alternative is a voicemail and the whole
 * point of the product is that a missed call becomes a captured lead.
 */
/** The day whose overnight range can still be running at the start of this one. */
type TelephonyDayKey = (typeof DAY_KEYS)[number];
const PREVIOUS_DAY_KEY: Partial<Record<TelephonyDayKey, TelephonyDayKey>> = {
  mon: 'sun',
  tue: 'mon',
  wed: 'tue',
  thu: 'wed',
  fri: 'thu',
  sat: 'fri',
  sun: 'sat',
};

export function afterHoursVerdict(
  grounding: TenantGrounding,
  nowMs: number = Date.now(),
): AfterHoursVerdict {
  const at = new Date(nowMs);
  const dayKey = dayKeyIn(grounding.timezone, at);
  const day = grounding.hours[dayKey];
  const localTime = localTimeIn(grounding.timezone, at);
  if (!day) return { open: false, dayKey, reason: 'unknown', localTime };

  const minutes = (value: string): number => {
    const [rawHour, rawMinute] = value.split(':');
    const hour = Number.parseInt(rawHour ?? '0', 10);
    const minute = Number.parseInt(rawMinute ?? '0', 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
    return hour * 60 + minute;
  };
  const open = minutes(day.open);
  const close = minutes(day.close);
  const [hourPart, minutePart] = localTime.split(':');
  const now = Number.parseInt(hourPart ?? '0', 10) * 60 + Number.parseInt(minutePart ?? '0', 10);
  if (open < 0 || close < 0) return { open: false, dayKey, reason: 'unknown', localTime };
  const inside =
    !day.closed && (close <= open ? now >= open || now <= close : now >= open && now <= close);
  if (inside) return { open: true, dayKey, reason: 'open', localTime };

  // A range that wraps midnight belongs to the day it *started* on. A tenant that
  // writes "tue 22:00 → 02:00" means the night shift that ends Wednesday morning, and
  // a caller at 00:30 has reached it; consulting only Wednesday's closed row would
  // play an after-hours greeting at a staffed desk.
  const previous = PREVIOUS_DAY_KEY[dayKey];
  const yesterday = previous ? grounding.hours[previous] : undefined;
  if (previous && yesterday && !yesterday.closed) {
    const wasOpen = minutes(yesterday.open);
    const wasClose = minutes(yesterday.close);
    if (wasOpen >= 0 && wasClose >= 0 && wasClose < wasOpen && now <= wasClose) {
      return { open: true, dayKey: previous, reason: 'open', localTime };
    }
  }
  return { open: false, dayKey, reason: day.closed ? 'closed_day' : 'outside_window', localTime };
}

export function afterHoursGreeting(
  grounding: TenantGrounding,
  language: TelephonyLanguage,
  verdict: AfterHoursVerdict,
): string {
  if (verdict.open) return interpolateGreeting(greetingFor(grounding, language), grounding.agentName);
  return isDanish(language)
    ? `Tak for dit opkald til ${grounding.name}. Vi har lukket nu (åbent i ${grounding.timezone}), men jeg kan notere din henvendelse og sikre at du bliver ringet op${grounding.escalationPhone ? ` — eller du kan ringe ${grounding.escalationPhone}` : ''}.`
    : `Thanks for calling ${grounding.name}. We are closed right now (hours are shown in ${grounding.timezone}), but I can take a message and make sure someone calls you back${grounding.escalationPhone ? ` — or you can call ${grounding.escalationPhone}` : ''}.`;
}

// -----------------------------------------------------------------------------
// DID routing — the inbound decision
// -----------------------------------------------------------------------------

/**
 * Normalise a dialled string to E.164 with Danish parity rules, mirroring
 * `agent-worker/services/phone.py` and the two functional indexes in
 * `db/migrations/0008_sip_inbound_routing.sql`: strip non-digits, unfold the
 * `00` trunk prefix, then accept an 8-digit Danish local number as +45.
 *
 * Both sides of the trunk must agree on this, because a DID that resolves in the
 * worker but not in Postgres is a call that is answered by no one.
 */
export function normalizeE164(value: string | null | undefined): string | null {
  if (!value) return null;
  let raw = value.trim();
  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length === 8) return `+45${digits}`;
  return `+${digits}`;
}

export type InboundRoute =
  | {
      readonly action: 'accept';
      readonly sipStatus: 200;
      readonly tenantId: string;
      readonly slug: string;
      readonly reason: null;
    }
  | {
      readonly action: 'forward';
      readonly sipStatus: 302;
      readonly forwardTo: string;
      readonly reason: 'did_paused' | 'did_unassigned' | 'after_hours_human' | 'no_grounding';
    }
  | {
      readonly action: 'reject';
      readonly sipStatus: 404;
      readonly reason: 'unknown_did' | 'no_forward_target';
    };

/**
 * Who takes a forwarded call: the number the carrier's dispatch rule named, else the
 * tenant's own forward line, else the escalation number.
 *
 * The order matters. A paused DID usually has a failover target configured in the
 * trunk, and overriding it with a tenant-level number would silently reroute a call
 * the agency already promised somewhere else. `forward_to_phone` still beats the
 * generic escalation line, because that column exists precisely for "when the AI must
 * not answer".
 */
export function forwardTargetFor(
  grounding: TenantGrounding,
  forwardTo: string | null,
): string | null {
  return forwardTo || grounding.forwardToPhone || grounding.escalationPhone || null;
}

/**
 * The routing decision, as a function of facts.
 *
 * There is no fallback tenant here and there must never be one: a call that
 * cannot be matched to the DID it was dialled is refused, because silently
 * answering as the wrong business is worse than a fast busy tone.
 *
 * The same principle governs a forward: a 302 with an empty Contact header is a call
 * that goes nowhere and looks, to the caller, like a dead line — so a tenant that must
 * not be AI-answered but has no human number configured is refused with a reason that
 * says so, rather than being sent into a black hole.
 */
export function resolveInboundRoute(input: {
  readonly grounding: TenantGrounding | null;
  readonly numberStatus: string | null;
  readonly forwardTo: string | null;
}): InboundRoute {
  const { grounding, numberStatus, forwardTo } = input;

  if (!grounding) {
    return { action: 'reject', sipStatus: 404, reason: 'unknown_did' };
  }

  const forwarding = (
    reason: 'did_paused' | 'did_unassigned' | 'after_hours_human' | 'no_grounding',
  ): InboundRoute => {
    const target = forwardTargetFor(grounding, forwardTo);
    if (!target) return { action: 'reject', sipStatus: 404, reason: 'no_forward_target' };
    return { action: 'forward', sipStatus: 302, forwardTo: target, reason };
  };

  if (numberStatus === 'pool') return forwarding('did_unassigned');
  if (numberStatus !== 'active') return forwarding('did_paused');
  if (grounding.receptionMode === 'human_forward') return forwarding('after_hours_human');
  if (!groundingIsSufficient(grounding)) return forwarding('no_grounding');
  return { action: 'accept', sipStatus: 200, tenantId: grounding.tenantId, slug: grounding.slug, reason: null };
}

/** Ring behaviour, in milliseconds, for the three tunable DID profiles. */
export function ringDelayFor(behavior: 'immediate' | 'one-ring' | 'two-rings'): number {
  switch (behavior) {
    case 'immediate':
      return 0;
    case 'one-ring':
      return 1200;
    case 'two-rings':
      return 2400;
  }
}

/** The calendar binding, normalised so an empty tenant cannot ask for 0-minute slots. */
export function calendarBindingOf(row: {
  readonly calcom_event_type_id?: string | null;
  readonly calcom_event_slug?: string | null;
  readonly timezone?: string | null;
  /** The migration's column name; `slot_minutes` is accepted for aliased reads. */
  readonly calcom_slot_minutes?: number | null;
  readonly slot_minutes?: number | null;
}): TenantCalComBinding {
  return {
    eventTypeId: readString(row.calcom_event_type_id) || null,
    eventSlug: readString(row.calcom_event_slug) || null,
    timeZone: readString(row.timezone, 'Europe/Copenhagen'),
    slotMinutes: Math.max(
      10,
      Math.min(240, Math.round(readNumber(row.calcom_slot_minutes ?? row.slot_minutes, DEFAULT_SLOT_MINUTES))),
    ),
  };
}
