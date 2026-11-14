/**
 * Agency <-> Client co-pilot engine (trekants-kommunikation).
 *
 * ## Why this is deterministic rather than an LLM call
 *
 * The engine routes intent by matching Danish keywords against a *grounded
 * context* built from real tenant rows. Every factual sentence it emits is
 * derived from data passed in; it has no ability to invent a price, a service,
 * or a promise. That is a deliberate safety property, not a limitation:
 *
 *   > If a customer asks a question whose answer is not grounded in the agency
 *   > database, the Co-Pilot must never hallucinate promises — it must state it
 *   > will verify with the agency operator.
 *
 * `ungrounded` is therefore a first-class intent with its own Danish copy. There
 * is no code path that falls through to a guessed answer.
 *
 * ## Why mutations are staged, never applied
 *
 * Financial and commitment-bearing changes (pricing, hours, contact details,
 * broadcasts) are returned as a `StagedMutation` with an explicit before/after
 * diff and `requiresApproval: true`. Nothing in this module writes. Applying is
 * a separate, human-triggered call.
 *
 * The module is pure: all I/O (tenant facts, metrics, contacts) is injected.
 */

import type {
  CopilotDelegation,
  CopilotIntent,
  CopilotReply,
  StagedMutation,
} from '@/contracts/schemas';

// -----------------------------------------------------------------------------
// Grounded context
// -----------------------------------------------------------------------------

/** One catalog line, as stored on the tenant. */
export interface GroundedCatalogItem {
  id: string;
  service: string;
  price_dkk: number;
  unit: string;
}

/**
 * Everything the co-pilot is allowed to know.
 *
 * If a fact is absent here, the co-pilot treats it as unknown rather than
 * filling the gap. `null` means "not on file"; it never means "zero".
 */
export interface CopilotContext {
  tenantId: string;
  tenantName: string;
  ownerName: string;
  language: 'da-DK' | 'en-US';
  /** Live counts. `null` = could not be read, which is different from 0. */
  metrics: {
    contacts: number | null;
    calls: number | null;
    booked: number | null;
    messages: number | null;
    pipelineDkk: number | null;
    openEscalations: number | null;
  };
  catalog: readonly GroundedCatalogItem[];
  businessHours: Readonly<
    Record<string, { open: string; close: string; closed: boolean }>
  > | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  activeBroadcast: string | null;
}

/** Danish/English copy thrown out when the language is not Danish. */
function t(ctx: CopilotContext, da: string, en: string): string {
  return ctx.language === 'da-DK' ? da : en;
}

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------

/** Danish thousands separator is a period, and the currency suffix is "kr." */
export function formatDkk(value: number): string {
  return `${value.toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr.`;
}

/** `null` renders as an explicit unknown, never as a misleading zero. */
export function formatCount(value: number | null, unknown = 'kan ikke læses'): string {
  return value === null ? unknown : value.toLocaleString('da-DK');
}

const DAY_LABELS: Readonly<Record<string, string>> = {
  monday: 'mandag',
  tuesday: 'tirsdag',
  wednesday: 'onsdag',
  thursday: 'torsdag',
  friday: 'fredag',
  saturday: 'lørdag',
  sunday: 'søndag',
};

// -----------------------------------------------------------------------------
// Intent routing
// -----------------------------------------------------------------------------

interface IntentRule {
  intent: CopilotIntent;
  /** Any match counts. Lower-case Danish/English keywords. */
  keywords: readonly string[];
}

/**
 * Ordered rules. First match wins, so the most specific intents come first.
 *
 * `delegation` first: "spørg Hans om..." is an instruction to act, and must not
 * be captured by the question-shaped `metrics` keywords inside it.
 */
const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: 'delegation',
    keywords: ['spørg', 'spoerg', 'sporg', 'ask ', 'undersøg', 'undersoeg', 'find ud af', 'tjek med'],
  },
  {
    intent: 'pricing',
    keywords: ['pris', 'price', 'koster', 'cost', 'takst', 'tilbud', 'quote', 'kr.'],
  },
  {
    intent: 'settings',
    keywords: [
      'indstilling', 'setting', 'åbningstid', 'aabningstid', 'opening hours',
      'åbent', 'aabent', 'åbne', 'aabne', 'open?', 'opening',
      'telefonnummer', 'phone number', 'email', 'kontakt os', 'ændre', 'aendre',
      'opdater', 'update', 'skift', 'change',
    ],
  },
  {
    intent: 'metrics',
    keywords: [
      'opkald', 'call', 'samtaler', 'kunde', 'kunder', 'customer', 'lead',
      'booket', 'booking', 'statistik', 'stats', 'hvor mange', 'how many',
      'overblik', 'overview', 'pipeline', 'omsætning', 'omsaetning', 'value',
    ],
  },
];

/**
 * Phrases that look like a question about the business but whose answer is a
 * commitment we must never improvise: guarantees, lead times, geographic
 * coverage, discounts, availability promises.
 */
const UNGROUNDED_MARKERS: readonly string[] = [
  'garanti', 'garantier', 'warranty', 'tilfredshedsgaranti',
  'hvor lang tid', 'how long', 'leveringstid', 'delivery time',
  'kan i', 'kan i klare', 'dækker i', 'daekker i', 'do you cover', 'kører i', 'koerer i',
  'rabat', 'discount', 'tilbud på', 'fast pris på', 'aftale om',
  'erstatning', 'forsikring', 'insurance', 'garanterer',
];

/**
 * A location reference, in the original casing.
 *
 * We hold no service-area data anywhere in the schema, so *any* question that
 * names a place is unanswerable by construction. Detecting a lowercase Danish
 * preposition followed by a capitalised word is a reliable tell for a place
 * name in running Danish text ("i Roskilde", "på Frederiksberg").
 */
const GEO_REFERENCE = /\b(?:i|på|paa|omkring|nær|naer|til)\s+[A-ZÆØÅ][\wÆØÅæøå-]{2,}/;

/** Interrogative shape: used to decide whether an unmatched message is a question. */
const QUESTION_MARKERS: readonly string[] = [
  '?', 'hvad', 'hvor', 'hvornår', 'hvornaar', 'hvordan', 'hvilke', 'hvilken',
  'kan', 'koster', 'what', 'when', 'how', 'which', 'do you', 'can you',
];

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/** Classify a client message without inventing facts or calling a model. */
export function classifyIntent(message: string): CopilotIntent {
  const lower = message.toLowerCase().trim();
  if (!lower) return 'smalltalk';

  // 1. A commitment question wins over keyword routing: even if it says "pris",
  //    "hvad koster det at få garanti" must not be answered with a catalog number.
  if (containsAny(lower, UNGROUNDED_MARKERS)) return 'ungrounded';

  // 2. Delegation before anything shape-based: "Spørg Hans om de tager opgaver i
  //    Roskilde" names a place, but it is an instruction to act, not a question.
  if (containsAny(lower, INTENT_RULES[0].keywords)) return 'delegation';

  // 3. We store no service areas, so a question naming a place cannot be
  //    grounded — regardless of whether it also mentions price or hours.
  if (GEO_REFERENCE.test(message.trim())) return 'ungrounded';

  // 4. Remaining keyword rules, in order.
  for (const rule of INTENT_RULES.slice(1)) {
    if (containsAny(lower, rule.keywords)) return rule.intent;
  }

  return containsAny(lower, QUESTION_MARKERS) ? 'ungrounded' : 'smalltalk';
}

// -----------------------------------------------------------------------------
// Grounded responders
// -----------------------------------------------------------------------------

/** The Danish sentence we use when we genuinely do not know. */
export function ungroundedReply(ctx: CopilotContext): string {
  return t(
    ctx,
    `Det kan jeg ikke svare på med sikkerhed ud fra vores data, og jeg vil ikke love noget, ` +
      `jeg ikke kan holde. Jeg har sendt spørgsmålet videre til ${ctx.ownerName}, ` +
      `som vender tilbage til dig hurtigst muligt.`,
    `I can't answer that with certainty from our records, and I won't promise something ` +
      `we can't stand behind. I've passed your question to ${ctx.ownerName}, ` +
      `who will get back to you shortly.`,
  );
}

function metricsReply(ctx: CopilotContext): string {
  const { contacts, calls, booked, messages, openEscalations } = ctx.metrics;

  if (contacts === null && calls === null) {
    return t(
      ctx,
      `Jeg kan ikke læse statistikken lige nu, så jeg vil ikke gætte på tallene. ` +
        `Prøv igen om lidt, eller spørg ${ctx.ownerName}.`,
      `I can't read the statistics right now, so I won't guess at the numbers. ` +
        `Try again shortly, or ask ${ctx.ownerName}.`,
    );
  }

  return t(
    ctx,
    `Her er status for ${ctx.tenantName} lige nu: ` +
      `${formatCount(contacts)} kunder i alt, ` +
      `${formatCount(booked)} bookede aftaler, ` +
      `${formatCount(calls)} registrerede opkald og ` +
      `${formatCount(messages)} beskeder.` +
      (openEscalations !== null && openEscalations > 0
        ? ` Der er ${openEscalations} åbne sager, der venter på svar.`
        : ''),
    `Current status for ${ctx.tenantName}: ` +
      `${formatCount(contacts, 'unavailable')} callers, ` +
      `${formatCount(booked, 'unavailable')} booked appointments, ` +
      `${formatCount(calls, 'unavailable')} recorded calls and ` +
      `${formatCount(messages, 'unavailable')} messages.`,
  );
}

function pricingReply(ctx: CopilotContext): string {
  if (ctx.catalog.length === 0) {
    // No catalog is not "free". It is unknown, and we say so.
    return t(
      ctx,
      `Der ligger ingen priser i vores system endnu, så jeg vil ikke opfinde en pris. ` +
        `Jeg beder ${ctx.ownerName} om at vende tilbage med et præcist svar.`,
      `There are no prices on file yet, so I won't invent one. ` +
        `I'll ask ${ctx.ownerName} to come back to you with an exact answer.`,
    );
  }

  const lines = ctx.catalog
    .slice(0, 6)
    .map((item) => `• ${item.service}: ${formatDkk(item.price_dkk)} ${item.unit}`);
  return t(
    ctx,
    `Det her har vi på vores prisliste:\n${lines.join('\n')}\n` +
      `Sig til, hvis du vil have et tilbud på noget bestemt.`,
    `Here is what's on our price list:\n${lines.join('\n')}\n` +
      `Let me know if you'd like a quote for something specific.`,
  );
}

function settingsReply(ctx: CopilotContext): string {
  const hours = ctx.businessHours;
  const openDays = hours
    ? Object.entries(hours)
        .filter(([, value]) => !value.closed)
        .map(([day, value]) => `${DAY_LABELS[day] ?? day} ${value.open}–${value.close}`)
    : [];

  const hoursLine = openDays.length
    ? t(ctx, `Vi har åbent: ${openDays.join(', ')}.`, `We're open: ${openDays.join(', ')}.`)
    : t(ctx, `Der er ingen åbningstider registreret endnu.`, `No opening hours are on file yet.`);

  const contactBits = [
    ctx.ownerPhone ? t(ctx, `telefon ${ctx.ownerPhone}`, `phone ${ctx.ownerPhone}`) : null,
    ctx.ownerEmail ? `e-mail ${ctx.ownerEmail}` : null,
  ].filter((value): value is string => value !== null);

  const contactLine = contactBits.length
    ? t(ctx, `Du kan kontakte os på ${contactBits.join(' og ')}.`, `You can reach us on ${contactBits.join(' and ')}.`)
    : t(ctx, `Vi har ingen kontaktoplysninger registreret endnu.`, `We have no contact details on file yet.`);

  return `${hoursLine} ${contactLine}`;
}

// -----------------------------------------------------------------------------
// Staged mutations
// -----------------------------------------------------------------------------

/**
 * Build the before/after diff for a pricing change, without applying anything.
 *
 * `changes` maps a catalog item id to its new price. Ids that do not exist are
 * ignored and reported as unknown rather than silently creating a service —
 * inventing a service is exactly the kind of ungrounded commitment we forbid.
 */
export function stagePricingMutation(
  ctx: CopilotContext,
  changes: Readonly<Record<string, number>>,
): { mutation: StagedMutation | null; unknownIds: string[] } {
  const diff: Array<{ field: string; before: string; after: string }> = [];
  const unknownIds: string[] = [];

  for (const [id, nextPrice] of Object.entries(changes)) {
    const item = ctx.catalog.find((candidate) => candidate.id === id);
    if (!item) {
      unknownIds.push(id);
      continue;
    }
    if (item.price_dkk === nextPrice) continue;
    diff.push({
      field: `pris.${item.service}`,
      before: formatDkk(item.price_dkk),
      after: formatDkk(nextPrice),
    });
  }

  if (diff.length === 0) return { mutation: null, unknownIds };

  return {
    mutation: {
      id: `stage-pricing-${Date.now()}`,
      kind: 'pricing',
      summary:
        ctx.language === 'da-DK'
          ? `${diff.length} pris${diff.length === 1 ? '' : 'er'} foreslås ændret.`
          : `${diff.length} price${diff.length === 1 ? '' : 's'} proposed for change.`,
      diff,
      requiresApproval: true,
    },
    unknownIds,
  };
}

// -----------------------------------------------------------------------------
// Delegations
// -----------------------------------------------------------------------------

/**
 * Turn a terse operator instruction into a polite Danish question for the client.
 *
 * "Spørg Hans om de tager opgaver i Roskilde" becomes
 * "Hej Hans! ${ownerName} spørger, om I tager opgaver i Roskilde. Kan du bekræfte det?"
 *
 * We keep the operator's own wording for the substance and only add politeness
 * and the recipient's name, so the co-pilot never invents a new ask.
 */
export function buildDelegationQuestion(
  ctx: CopilotContext,
  instruction: string,
  contactName: string | null,
): { question: string; topic: string } {
  const greeting = contactName ? `Hej ${contactName.split(' ')[0]}!` : 'Hej!';

  // Strip the leading imperative so the residual topic can be quoted directly.
  const stripped = instruction
    .trim()
    .replace(/^(spørg|spoerg|sporg|ask)\b[^,]*?\bom\b/i, '')
    .replace(/^(undersøg|undersoeg|find ud af|tjek med)\b[^,]*?(?:om|hvordan|hvorvidt)\b/i, '')
    .trim();

  const topic = (stripped || instruction).replace(/[.?!]+$/, '').trim();
  const quote = topic.length > 0 ? topic : instruction;

  const question =
    ctx.language === 'da-DK'
      ? `${greeting} ${ctx.ownerName} spørger, om ${quote}. Kan du bekræfte det?`
      : `${greeting} ${ctx.ownerName} is asking whether ${quote}. Could you confirm?`;

  return { question, topic: quote.slice(0, 160) };
}

/**
 * Summarise a client's reply for the operator, in Danish.
 *
 * The summary is deliberately extractive — it re-states the client's words and
 * classifies yes/no — because an abstractive summary is where a model would
 * start guessing at detail the client never gave.
 */
export function summariseDelegationAnswer(question: string, answer: string): string {
  const lower = answer.toLowerCase().trim();
  const affirmative = /\b(ja|jeps|yes|helt sikkert|det gør vi|det goer vi|selvfølgelig|selvfoelgelig)\b/.test(lower);
  const negative = /\b(nej|no|desværre|desvaerre|det gør vi ikke|det goer vi ikke|ikke muligt)\b/.test(lower);

  const verdict = affirmative && !negative
    ? 'Kunden svarede bekræftende'
    : negative && !affirmative
      ? 'Kunden svarede afkræftende'
      : 'Kunden svarede, men det er ikke et klart ja eller nej';

  const trimmed = answer.trim().replace(/\s+/g, ' ');
  const quoted = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;

  return `${verdict}: "${quoted}"`;
}

// -----------------------------------------------------------------------------
// The router
// -----------------------------------------------------------------------------

/**
 * Produce the co-pilot's reply to a client message.
 *
 * Pure: no reads, no writes, no network. The caller supplies the context and is
 * responsible for persisting the returned body and any staged mutation.
 */
export function respondToClient(
  ctx: CopilotContext,
  message: string,
  options: { stagedPricing?: Readonly<Record<string, number>> } = {},
): CopilotReply {
  const intent = classifyIntent(message);

  switch (intent) {
    case 'metrics':
      return {
        intent,
        body: metricsReply(ctx),
        mutation: null,
        delegation: null,
        needsAgencyInput: false,
      };

    case 'pricing': {
      // A pricing *question* is answered from the catalog. A pricing *change* is
      // staged for approval and explicitly not applied.
      const staged = options.stagedPricing ? stagePricingMutation(ctx, options.stagedPricing) : null;
      if (staged?.mutation) {
        return {
          intent,
          body: t(
            ctx,
            `Jeg har lavet et forslag til prisændringen og sendt det til godkendelse hos ` +
              `${ctx.ownerName}. Jeg ændrer først priserne, når der er givet grønt lys.`,
            `I've prepared the price change for approval by ${ctx.ownerName}. ` +
              `I won't change any prices until it's approved.`,
          ),
          mutation: staged.mutation,
          delegation: null,
          needsAgencyInput: true,
        };
      }
      return {
        intent,
        body: pricingReply(ctx),
        mutation: null,
        delegation: null,
        needsAgencyInput: false,
      };
    }

    case 'settings':
      return {
        intent,
        body: settingsReply(ctx),
        mutation: null,
        delegation: null,
        needsAgencyInput: false,
      };

    case 'delegation':
      // The co-pilot cannot answer a delegation itself; it needs the operator's
      // instruction and the client's reply. It says so rather than improvising.
      return {
        intent,
        body: t(
          ctx,
          `Det spørgsmål kræver, at jeg lige vender det med ${ctx.ownerName}. ` +
            `Jeg vender tilbage, så snart jeg har et svar.`,
          `That question needs checking with ${ctx.ownerName}. I'll be back as soon as I have an answer.`,
        ),
        mutation: null,
        delegation: null,
        needsAgencyInput: true,
      };

    case 'ungrounded':
      return {
        intent,
        body: ungroundedReply(ctx),
        mutation: null,
        delegation: null,
        needsAgencyInput: true,
      };

    case 'smalltalk':
    default:
      return {
        intent: 'smalltalk',
        body: t(
          ctx,
          `Tak for din besked! Jeg er assistenten for ${ctx.tenantName}. ` +
            `Spørg mig gerne om priser, åbningstider eller status — eller skriv, hvad du har brug for.`,
          `Thanks for your message! I'm the assistant for ${ctx.tenantName}. ` +
            `Ask me about prices, opening hours or status — or tell me what you need.`,
        ),
        mutation: null,
        delegation: null,
        needsAgencyInput: false,
      };
  }
}

/** Convenience for the UI: a delegation with its dispatch question filled in. */
export function withQuestion(
  delegation: CopilotDelegation,
  ctx: CopilotContext,
  contactName: string | null,
): CopilotDelegation {
  const { question, topic } = buildDelegationQuestion(ctx, delegation.instruction, contactName);
  return { ...delegation, question, topic: delegation.topic ?? topic };
}
