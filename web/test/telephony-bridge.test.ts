import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  BARGE_IN_BUDGET_MS,
  LATENCY_BUDGETS,
  ROUND_TRIP_BUDGET_MS,
  SPEECH_TO_SPEECH_BUDGET_MS,
  TELEPHONY_LANGUAGES,
  TRANSCRIPT_LIMIT,
  clampBudget,
  clampTranscript,
  detectLanguage,
  fromShortLanguage,
  isDanish,
  judgeLatency,
  maskCallerNumber,
  otherLanguage,
  roundTripOf,
  tenantLanguage,
  toShortLanguage,
} from '../src/lib/telephony/types';
import {
  SessionRegistry,
  appendTurn,
  beginSession,
  canTransition,
  isTerminal,
  observeLatency,
  projectSession,
  transcriptPreview,
  transitionTo,
} from '../src/lib/telephony/session-machine';
import {
  BargeInController,
  deriveBargeInPolicy,
  isLikelySelfEcho,
  mergeBargeInTelemetry,
  shouldInterruptFromTranscript,
  tokenize,
} from '../src/lib/telephony/barge-in';
import type { BargeInDropReason, BargeInEvent } from '../src/lib/telephony/barge-in';
import {
  AudioTurnGate,
  BROWSER_AUDIO_PROFILE,
  TELEPHONY_AUDIO_PROFILE,
  buildInitiationFrame,
  defaultTurnHandling,
  decodeServerEvent,
  encodeClientEvent,
  isPlausibleBase64,
  resolveElevenLabsConfig,
} from '../src/lib/telephony/elevenlabs';
import {
  attendeeEmail,
  bookingIdempotencyKey,
  buildSlotsUrl,
  calComHeaders,
  defaultQueryWindow,
  isSlotFresh,
  parseSlotsPayload,
  resolveCalComConfig,
  subtractBusy,
  syncSlots,
} from '../src/lib/telephony/calcom';
import {
  afterHoursVerdict,
  buildGroundedPrompt,
  calendarBindingOf,
  groundingIsSufficient,
  interpolateGreeting,
  normalizeE164,
  readHoursJson,
  readPricingJson,
  resolveInboundRoute,
  ringDelayFor,
  type TenantGrounding,
} from '../src/lib/telephony/grounding';
import {
  AGENT_JOIN_TIMEOUT_MS,
  TELEPHONY_DATA_TOPIC,
  agentParticipantIdentity,
  decodeRoomMessage,
  encodeRoomMessage,
  ownerParticipantIdentity,
  sipCallerIdentity,
  telephonyRoomName,
} from '../src/lib/telephony/livekit-room';
import {
  acceptsCallerInput,
  bargeInReportOf,
  foldCallerTurn,
} from '../src/lib/telephony/session-control';
import {
  DispatchBodySchema,
  EndCallBodySchema,
  LineProfileSchema,
  SessionControlSchema,
} from '../src/lib/telephony/contracts';
import { LanguageSchema } from '../src/contracts/schemas';

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** A source file with comments removed, for assertions about what the code *does*. */
const code = (relative: string): string =>
  source(relative)
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/^\s*\/\/.*$/gmu, ' ');

const groundKnowledge: TenantGrounding['knowledge'] = [
  { id: 'k1', kind: 'faq', title: 'Åbningstider', content: 'Man-fre 08-16.', priority: 1, sourceUrl: null },
];

const fixture = (overrides: Partial<TenantGrounding> = {}): TenantGrounding => ({
  tenantId: '3f0f9f2a-1c1b-4d7a-9b5f-0a1e2c3d4e5f',
  name: 'Dansk Byg',
  slug: 'dansk-byg',
  status: 'active',
  receptionMode: 'voice_ai',
  language: 'da-DK',
  agentName: 'Freja',
  industry: 'murer',
  city: 'København',
  timezone: 'Europe/Copenhagen',
  greetingDa: 'Hej, du har fat i {agent}.',
  greetingEn: 'Hello, you have reached {agent}.',
  escalationPhone: '+4533120000',
  broadcastMessage: null,
  hours: readHoursJson({
    mon: { open: '08:00', close: '16:00', closed: false },
    tue: { open: '08:00', close: '16:00', closed: false },
    wed: { open: '08:00', close: '16:00', closed: false },
    thu: { open: '08:00', close: '16:00', closed: false },
    fri: { open: '08:00', close: '14:00', closed: false },
    sat: { open: '00:00', close: '00:00', closed: true },
    sun: { open: '00:00', close: '00:00', closed: true },
  }),
  pricing: [],
  knowledge: [],
  customerSystemPrompt: null,
  contactEmail: 'desk@dansk-byg.example',
  forwardToPhone: null,
  audioFormatExpectation: 'pcm_16000',
  bargeInBudgetMs: BARGE_IN_BUDGET_MS,
  sound: { vadThreshold: 65, bargeInSensitivity: 85, speechRate: 1, echoTailMs: 90 },
  voice: { elevenLabsAgentId: null, elevenLabsAgentIdEn: null, voiceId: null, modelLabel: 'eleven_flash' },
  calendar: { eventTypeId: null, eventSlug: null, timeZone: 'Europe/Copenhagen', slotMinutes: 30 },
  groundedAtIso: '2026-01-01T08:00:00.000Z',
  ...overrides,
});

// -----------------------------------------------------------------------------
// Language contract
// -----------------------------------------------------------------------------

test('telephony speaks the caller locale while the console keeps its own enum', () => {
  // The reconciliation this layer exists to make: `LanguageSchema` is load-bearing
  // across six call sites and is NOT widened. `en-GB` is a speech locale, and the
  // telephony enum is the only place it is legal.
  assert.deepEqual([...TELEPHONY_LANGUAGES], ['da-DK', 'en-GB']);
  assert.deepEqual(LanguageSchema.options, ['da-DK', 'en-US']);
  assert.equal(tenantLanguage('en-US'), 'en-GB');
  assert.equal(tenantLanguage('da-DK'), 'da-DK');
  assert.equal(tenantLanguage('da'), 'da-DK');
  // Anything unrecognised falls back to the language of the reception desk.
  assert.equal(tenantLanguage(null), 'da-DK');
  assert.equal(tenantLanguage('de-DE'), 'da-DK');
  assert.equal(toShortLanguage('en-GB'), 'en');
  assert.equal(fromShortLanguage('en'), 'en-GB');
  assert.equal(otherLanguage('da-DK'), 'en-GB');
  assert.ok(isDanish('da-DK'));
});

test('language detection follows the caller without a model', () => {
  assert.equal(detectLanguage('Hej, jeg vil gerne høre om priser', 'en-GB'), 'da-DK');
  assert.equal(detectLanguage('Hello, I would like to book a price check please', 'da-DK'), 'en-GB');
  // Ambiguous text keeps the current language: switching on nothing is worse than
  // staying put, because the agent's own prompt already follows the caller.
  assert.equal(detectLanguage('ok', 'da-DK'), 'da-DK');
  assert.equal(detectLanguage('ok', 'en-GB'), 'en-GB');
});

// -----------------------------------------------------------------------------
// Latency budget
// -----------------------------------------------------------------------------

test('the barge-in budget is the product contract and cannot be loosened by config', () => {
  assert.equal(BARGE_IN_BUDGET_MS, 150);
  assert.equal(ROUND_TRIP_BUDGET_MS, 300);
  assert.equal(SPEECH_TO_SPEECH_BUDGET_MS, 600);
  assert.equal(clampBudget(250), 150, 'a tenant may not loosen the budget');
  assert.equal(clampBudget(12), 40, 'nor tighten past what is physically acoustical');
  assert.equal(clampBudget(Number.NaN), 150);
  assert.equal(clampBudget(90), 90);
});

test('latency verdicts are reported as budget vs measured, and the meter cannot overflow', () => {
  const within = judgeLatency(118, BARGE_IN_BUDGET_MS);
  assert.equal(within.withinBudget, true);
  assert.equal(within.overByMs, 0);
  assert.ok(within.ratio > 0 && within.ratio < 1);

  const over = judgeLatency(4_000, BARGE_IN_BUDGET_MS);
  assert.equal(over.withinBudget, false);
  assert.equal(over.overByMs, 3850);
  assert.equal(over.ratio, 1, 'a 4s stall draws a full bar, not a 2,600% div');

  assert.equal(judgeLatency(-5, 150).measuredMs, 0);
  assert.equal(judgeLatency(Number.NaN, 150).measuredMs, 0);
  assert.equal(roundTripOf(LATENCY_BUDGETS), LATENCY_BUDGETS.sttMs + LATENCY_BUDGETS.llmFirstTokenMs + LATENCY_BUDGETS.ttsFirstByteMs);
  assert.ok(roundTripOf(LATENCY_BUDGETS) <= SPEECH_TO_SPEECH_BUDGET_MS);
});

// -----------------------------------------------------------------------------
// Session machine
// -----------------------------------------------------------------------------

test('the status graph is monotonic and terminal states are sealed', () => {
  const session = beginSession({
    callId: 'call-1',
    tenantId: 'tenant-1',
    callerNumber: '+4520123456',
    language: 'da-DK',
    startedAtMs: 1_000,
    startedAtIso: '2026-01-01T08:00:00.000Z',
  });
  assert.equal(session.status, 'connecting');
  assert.equal(session.latencyMs, 0);

  const active = transitionTo(session, 'active');
  assert.equal(active.ok, true);
  assert.ok(active.ok);

  assert.equal(canTransition('connecting', 'completed'), false, 'a call cannot complete before it is live');
  assert.equal(canTransition('active', 'transferring'), true);
  assert.equal(canTransition('transferring', 'active'), true, 'the human hands the call back');
  assert.equal(canTransition('completed', 'active'), false);
  assert.ok(isTerminal('failed'));

  const rejected = transitionTo(session, 'completed');
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, 'not_permitted');

  const done = transitionTo(active.session, 'completed');
  assert.ok(done.ok);
  const afterTerminal = transitionTo(done.session, 'active');
  assert.equal(afterTerminal.ok, false);
  if (!afterTerminal.ok) assert.equal(afterTerminal.reason, 'terminal');
});

test('transcripts dedupe the caller echoing the agent and stay bounded', () => {
  const started = beginSession({
    callId: 'call-2',
    tenantId: 'tenant-1',
    callerNumber: 'anonymous',
    language: 'da-DK',
    startedAtMs: 0,
    startedAtIso: '2026-01-01T08:00:00.000Z',
  });
  const first = appendTurn(started, 'agent', 'Hej, du har fat i Freja.', 10);
  assert.equal(first.appended, true);
  // The caller's voice returning through an open speaker is the most common source
  // of phantom transcript lines; consecutive same-role repeats are dropped.
  const repeat = appendTurn(first.session, 'agent', '  hej, du har fat i freja. ', 20);
  assert.equal(repeat.appended, false);
  assert.equal(repeat.session.transcript.length, 1);
  const caller = appendTurn(repeat.session, 'caller', 'Jeg vil booke', 30);
  assert.equal(caller.appended, true);
  assert.equal(caller.session.transcript.length, 2);

  assert.equal(appendTurn(started, 'caller', '   ', 5).appended, false, 'a silent turn is not a turn');

  const big = clampTranscript(Array.from({ length: TRANSCRIPT_LIMIT + 40 }, (_, index) => index));
  assert.equal(big.length, TRANSCRIPT_LIMIT);
  assert.equal(big[0], 40, 'the oldest turns fall off the front');
  assert.equal(clampTranscript([1, 2, 3]).length, 3);

  assert.match(transcriptPreview(caller.session), /^Caller: Jeg vil booke$/u);
  assert.match(transcriptPreview(started), /greeting dispatched/u);
});

test('latency is a decaying average, and one bad turn cannot look like a broken tenant', () => {
  const started = beginSession({
    callId: 'call-3',
    tenantId: 'tenant-1',
    callerNumber: '+4520123456',
    language: 'en-GB',
    startedAtMs: 0,
    startedAtIso: '2026-01-01T08:00:00.000Z',
  });
  const first = observeLatency(started, 100);
  assert.equal(first.latencyMs, 100);
  const spike = observeLatency(first, 1000);
  assert.equal(spike.latencyMs, 460, '0.6 * previous + 0.4 * sample');
  // A nonsense sample must not poison the average or negative it.
  assert.equal(observeLatency(spike, -50).latencyMs, 460);
  assert.equal(observeLatency(spike, Number.NaN).latencyMs, 460);
});

test('projection exposes a preview, never the transcript', () => {
  const started = beginSession({
    callId: 'call-4',
    tenantId: 'tenant-1',
    callerNumber: '+4520123456',
    language: 'da-DK',
    startedAtMs: 1_000,
    startedAtIso: '2026-01-01T08:00:00.000Z',
  });
  const withTurns = appendTurn(started, 'caller', 'mit cpr er 123456-7890', 5_000);
  const projection = projectSession(withTurns.session, 61_000);
  assert.equal(projection.turns, 1);
  assert.equal(projection.durationMs, 60_000);
  assert.equal(projection.lastSpeaker, 'caller');
  assert.equal(projection.bargeInWithinBudget, true);
  assert.equal('transcript' in projection, false, 'a dispatch payload must not carry the caller’s words');
});

test('the registry refuses over-capacity, tolerates a retried webhook, and releases once', () => {
  const registry = new SessionRegistry(2);
  const make = (callId: string) =>
    beginSession({
      callId,
      tenantId: 'tenant-1',
      callerNumber: '+4520123456',
      language: 'da-DK',
      startedAtMs: 0,
      startedAtIso: '2026-01-01T08:00:00.000Z',
    });

  assert.equal(registry.acquire(make('a')).admitted, true);
  assert.equal(registry.acquire(make('b')).admitted, true);
  const refused = registry.acquire(make('c'));
  assert.equal(refused.admitted, false);
  assert.equal(refused.reason, 'capacity');
  // A duplicate is admitted-but-flagged: a retried SIP webhook must not double-count.
  const duplicate = registry.acquire(make('a'));
  assert.equal(duplicate.admitted, true);
  assert.equal(duplicate.duplicated, true);

  const stats = registry.stats();
  assert.equal(stats.activeCount, 2);
  assert.equal(stats.limit, 2);
  assert.equal(stats.headroom, 0);
  assert.equal(stats.rejectedCount, 1);

  assert.equal(registry.release('b'), true);
  assert.equal(registry.release('b'), false, 'a duplicate BYE must not free someone else’s slot');
  assert.equal(registry.stats().headroom, 1);
  assert.deepEqual(registry.list().map((entry) => entry.callId), ['a']);
  assert.equal(registry.drain().length, 1);
  assert.equal(registry.activeCount, 0);
  assert.throws(() => new SessionRegistry(0), RangeError);
});

// -----------------------------------------------------------------------------
// Barge-in
// -----------------------------------------------------------------------------

/** Narrow a barge-in event to its drop reason; fails if the controller did not drop. */
function dropped(event: BargeInEvent): BargeInDropReason {
  assert.equal(event.type, 'dropped');
  return event.type === 'dropped' ? event.reason : 'below_gate';
}

test('the tenant knobs move the gates in the directions an operator expects', () => {
  const base = deriveBargeInPolicy({ vadThreshold: 65, bargeInSensitivity: 85 });
  const stricterVad = deriveBargeInPolicy({ vadThreshold: 88, bargeInSensitivity: 85 });
  const lazier = deriveBargeInPolicy({ vadThreshold: 65, bargeInSensitivity: 12 });

  assert.ok(stricterVad.energyGate > base.energyGate, 'a stricter VAD is harder to interrupt');
  assert.ok(lazier.energyGate > base.energyGate, 'a receptionist that yields the floor less eagerly needs more proof');
  assert.ok(stricterVad.minSpeechMs >= base.minSpeechMs, 'a stricter VAD waits for more speech');
  assert.ok(lazier.minSpeechMs >= base.minSpeechMs, 'a lazier receptionist needs the word to last longer');
  // The budget is the product contract, so no tuning may loosen it.
  assert.equal(deriveBargeInPolicy({ vadThreshold: 65, bargeInSensitivity: 85, budgetMs: 900 }).budgetMs, BARGE_IN_BUDGET_MS);
  assert.equal(deriveBargeInPolicy({ vadThreshold: 65, bargeInSensitivity: 85, budgetMs: 80 }).budgetMs, 80);
  assert.ok(base.sustainGate < base.energyGate, 'the sustain gate is the hysteresis band');
  assert.ok(base.fastGate > base.energyGate, 'double-talk needs more than the opening gate');
  assert.equal(base.budgetMs, BARGE_IN_BUDGET_MS);
  // Out-of-range tuning is clamped rather than trusted.
  const junk = deriveBargeInPolicy({ vadThreshold: Number.NaN, bargeInSensitivity: 5_000, budgetMs: -3 });
  assert.ok(Number.isFinite(junk.energyGate) && junk.energyGate > 0);
  assert.ok(junk.sustainGate < junk.energyGate && junk.fastGate > junk.energyGate);
  assert.ok(junk.minSpeechMs >= 30 && junk.minSpeechMs <= 120);
  assert.ok(junk.echoTailMs >= 0 && junk.echoTailMs <= 400);
  // A budget that is not a number at all is "not configured" and takes the default;
  // a finite but absurd one is clamped to the strictest legal value, never to the
  // loosest. `clampBudget` is the same function the migration's CHECK enforces, so
  // the two layers cannot disagree about what a legal tenant budget is.
  assert.equal(junk.budgetMs, 40);
  assert.equal(deriveBargeInPolicy({ vadThreshold: 65, bargeInSensitivity: 85, budgetMs: Number.NaN }).budgetMs, 150);
  assert.equal(deriveBargeInPolicy({ vadThreshold: 65, bargeInSensitivity: 85, budgetMs: 0 }).budgetMs, 40);
});

test('a commit needs sustained energy, and it lands inside the 150 ms budget', () => {
  // A hand-written policy keeps this test about the state machine rather than about
  // the derivation: gates at 0.10 (open), 0.07 (sustain), 0.60 (double-talk),
  // 60 ms of required speech, 100 ms of echo tail, 150 ms budget.
  const policy = { energyGate: 0.1, sustainGate: 0.07, fastGate: 0.6, minSpeechMs: 60, echoTailMs: 100, budgetMs: 150 };
  const commits: number[] = [];
  const controller = new BargeInController({ policy, onCommit: (commit) => commits.push(commit.latencyMs) });
  controller.beginAgentTurn(0);

  // Below the gate: nothing.
  assert.equal(controller.push({ atMs: 10, rms: 0.02 }).type, 'dropped');
  assert.equal(commits.length, 0);

  // One frame above the gate opens a candidate but does not commit: a plosive is not
  // an interruption, and committing on one is how a receptionist cuts itself off to
  // clear its throat.
  assert.equal(controller.push({ atMs: 20, rms: 0.2 }).type, 'opened');
  // Held until the speech has actually lasted `minSpeechMs`.
  assert.equal(controller.push({ atMs: 40, rms: 0.2 }).type, 'held');
  const committed = controller.push({ atMs: 90, rms: 0.2 });
  assert.equal(committed.type, 'committed');
  assert.deepEqual(commits, [70], 'measured from candidate onset, not from the sample that happened to cross');
  if (committed.type === 'committed') {
    assert.equal(committed.commit.withinBudget, true);
    assert.equal(committed.commit.overByMs, 0);
    assert.equal(committed.commit.path, 'sustained');
  }

  // Latched: the rest of this agent turn is over, and a second candidate must not
  // fire again until the next turn begins.
  assert.equal(dropped(controller.push({ atMs: 100, rms: 0.9 })), 'already_committed');
  controller.endAgentTurn(120);
  // Past the echo tail the new turn arms again (tail 100 ms → clear at 220 ms).
  controller.beginAgentTurn(240);
  assert.equal(controller.push({ atMs: 250, rms: 0.2 }).type, 'opened');
  assert.equal(controller.push({ atMs: 270, rms: 0.2 }).type, 'held', 'the second frame is still inside minSpeechMs');
  assert.equal(controller.push({ atMs: 315, rms: 0.2 }).type, 'committed');
  assert.deepEqual(commits, [70, 65]);

  const telemetry = controller.telemetry();
  assert.equal(telemetry.commits, 2);
  assert.equal(telemetry.overBudget, 0);
  assert.equal(telemetry.worstMs, 70);
  assert.equal(telemetry.meanMs, 68);
  assert.equal(telemetry.budgetMs, BARGE_IN_BUDGET_MS);

  // A commit past the budget is counted, not hidden — the tenant is graded on it.
  const late = new BargeInController({
    policy: { ...policy, budgetMs: 40, minSpeechMs: 60 },
    onCommit: () => {},
  });
  late.beginAgentTurn(0);
  assert.equal(late.push({ atMs: 0, rms: 0.2 }).type, 'opened');
  const lateEvent = late.push({ atMs: 90, rms: 0.2 });
  assert.equal(lateEvent.type, 'committed');
  if (lateEvent.type === 'committed') {
    assert.equal(lateEvent.commit.latencyMs, 90);
    assert.equal(lateEvent.commit.withinBudget, false);
    assert.equal(lateEvent.commit.overByMs, 50);
  }
  assert.deepEqual(late.telemetry(), {
    commits: 1,
    overBudget: 1,
    worstMs: 90,
    meanMs: 90,
    echoGuardBlocks: 0,
    budgetMs: 40,
  });
});

test('the echo tail is refused, and loud double-talk skips the wait', () => {
  const policy = { energyGate: 0.1, sustainGate: 0.07, fastGate: 0.6, minSpeechMs: 60, echoTailMs: 100, budgetMs: 150 };
  let commits = 0;
  const controller = new BargeInController({ policy, onCommit: () => (commits += 1) });
  controller.beginAgentTurn(0);
  assert.equal(controller.push({ atMs: 10, rms: 0.2 }).type, 'opened');
  controller.endAgentTurn(20);

  // The agent has just stopped; anything at this instant is the reverb of its last
  // syllable, and the tail guard is what makes "barge-in" mean the caller.
  assert.equal(dropped(controller.push({ atMs: 60, rms: 0.3 })), 'echo_tail');
  assert.equal(commits, 0);
  assert.equal(controller.snapshot().phase, 'echo_guard');
  assert.equal(controller.snapshot().echoGuardBlocks, 1, 'a guarded candidate is counted, not invisible');

  // A resumed turn does not disarm the tail: the room is still ringing.
  controller.beginAgentTurn(30);
  assert.equal(dropped(controller.push({ atMs: 40, rms: 0.3 })), 'echo_tail');
  // Loud enough to be certain, though, is never echo — double-talk commits on one
  // frame instead of waiting out minSpeechMs, which is where the 150 ms is spent.
  assert.equal(controller.push({ atMs: 45, rms: 0.9 }).type, 'committed');
  assert.equal(commits, 1);
  assert.equal(controller.snapshot().lastCommit?.path, 'double_talk');
  // Measured from the frame that was *certain*, not from the guarded candidate: the
  // controller refused to attribute 40 ms of energy to the caller, so it may not
  // claim credit for reacting to it either. Under-reporting the reaction and
  // over-reporting the guard is the only honest pairing.
  assert.equal(controller.snapshot().lastCommit?.latencyMs, 0);
  assert.equal(controller.snapshot().echoGuardBlocks, 2);

  // Once the tail has expired and the agent is still silent, a shout is the caller
  // answering a question, not an interruption. There is nothing to interrupt.
  const quiet = new BargeInController({ policy, onCommit: () => (commits += 1) });
  quiet.beginAgentTurn(100);
  quiet.endAgentTurn(110);
  assert.equal(dropped(quiet.push({ atMs: 250, rms: 0.99 })), 'agent_silent');
  assert.equal(dropped(quiet.forceCommit(260)), 'agent_silent');
  assert.equal(commits, 1, 'neither path counted a second barge-in');
  quiet.beginAgentTurn(300);
  assert.equal(quiet.push({ atMs: 310, rms: 0.9 }).type, 'committed');
  assert.equal(commits, 2);
});

test('echo is judged on words, so the agent does not interrupt itself', () => {
  const agent = 'Jeg kan tilbyde dig en tid i morgen kl. 9 hos Dansk Byg';
  assert.equal(isLikelySelfEcho('en tid i morgen', agent), true);
  assert.equal(isLikelySelfEcho('jeg vil hellere have en tid om eftermiddagen tak', agent), false);
  // An empty caller turn is not new information, so it counts as echo: the safe
  // reading of "the caller said nothing" is "do not interrupt yourself".
  assert.equal(isLikelySelfEcho('', agent), true);
  assert.ok(tokenize(agent).length > 5);
  assert.deepEqual(tokenize('  '), []);

  // A short "ja" is not proof of an interruption; a full sentence is.
  assert.equal(shouldInterruptFromTranscript('ja', agent), false);
  assert.equal(shouldInterruptFromTranscript('jeg vil faktisk gerne have fat i en anden person', ''), true);
  assert.equal(
    shouldInterruptFromTranscript('nej tak', agent, { minWords: 4 }),
    false,
    'a tenant that demands more words gets a later, not earlier, interruption',
  );
});

test('barge-in telemetry merges a single commit without letting the last writer win', () => {
  const first = mergeBargeInTelemetry(null, { commit: { latencyMs: 120, withinBudget: true }, budgetMs: 150 });
  assert.equal(first.commits, 1);
  assert.equal(first.overBudget, 0);
  assert.equal(first.worstMs, 120);
  const second = mergeBargeInTelemetry(first, { commit: { latencyMs: 400, withinBudget: false } });
  assert.equal(second.commits, 2);
  assert.equal(second.overBudget, 1);
  assert.equal(second.worstMs, 400);
  assert.equal(second.meanMs, 260);
  assert.equal(second.budgetMs, 150, 'the budget belongs to the tenant, not to the reporter');

  const aggregate = mergeBargeInTelemetry(second, { commits: 9, overBudget: 4, worstMs: 500, meanMs: 200, budgetMs: 900 });
  assert.equal(aggregate.commits, 9);
  assert.equal(aggregate.overBudget, 4);
  assert.equal(aggregate.worstMs, 500);
  assert.equal(aggregate.budgetMs, 150, 'an aggregate may not loosen the budget either');
  // An empty aggregate changes nothing: a reset meter is not a claim of zero commits.
  assert.equal(mergeBargeInTelemetry(aggregate, {}).commits, 9);
});

test('a barge-in report is the same verdict the ledger persists', () => {
  const commit = {
    speechStartMs: 10,
    committedAtMs: 110,
    latencyMs: 100,
    withinBudget: true,
    overByMs: 0,
    path: 'double_talk' as const,
    heldSamples: 3,
  };
  const report = bargeInReportOf('call-9', commit, 150);
  assert.equal(report.callId, 'call-9');
  assert.equal(report.latencyMs, 100);
  assert.equal(report.budgetMs, BARGE_IN_BUDGET_MS);
  assert.equal(report.withinBudget, true);
  assert.equal(report.overByMs, 0);
  assert.equal(report.path, 'double_talk');
});

// -----------------------------------------------------------------------------
// ElevenLabs wire protocol
// -----------------------------------------------------------------------------

test('an unconfigured provider is a declared reason, never a silent half-call', () => {
  const missingKey = resolveElevenLabsConfig({});
  assert.equal(missingKey.configured, false);
  if (!missingKey.configured) {
    assert.equal(missingKey.reason, 'missing_api_key');
    assert.match(missingKey.message, /ELEVENLABS_API_KEY/u);
  }
  const missingAgent = resolveElevenLabsConfig({ ELEVENLABS_API_KEY: 'sk_live_x' });
  assert.equal(missingAgent.configured, false);
  if (!missingAgent.configured) assert.equal(missingAgent.reason, 'missing_agent_id');

  const configured = resolveElevenLabsConfig(
    { ELEVENLABS_API_KEY: 'sk_live_x', ELEVENLABS_AGENT_ID: 'agent-da', ELEVENLABS_AGENT_ID_EN: 'agent-en' },
    { language: 'en-GB' },
  );
  assert.equal(configured.configured, true);
  if (configured.configured) {
    assert.equal(configured.agentId, 'agent-en', 'the English agent answers an English caller');
    assert.deepEqual(configured.audio, TELEPHONY_AUDIO_PROFILE);
  }
  // Without a dedicated English agent the Danish one follows the caller — the
  // prompt already says so, and refusing the call would be worse.
  const single = resolveElevenLabsConfig(
    { ELEVENLABS_API_KEY: 'k', ELEVENLABS_AGENT_ID: 'agent-da' },
    { language: 'en-GB' },
  );
  assert.equal(single.configured && single.agentId, 'agent-da');
});

test('the telephony audio profile is what a PSTN leg can actually carry', () => {
  assert.deepEqual(TELEPHONY_AUDIO_PROFILE, {
    inputSampleRateHz: 16_000,
    outputSampleRateHz: 16_000,
    channels: 1,
  });
  assert.equal(BROWSER_AUDIO_PROFILE.inputSampleRateHz, 48_000);
  assert.ok(BROWSER_AUDIO_PROFILE.outputSampleRateHz > TELEPHONY_AUDIO_PROFILE.outputSampleRateHz);
});

test('the initiation frame carries the grounding and never overrides the agent by id', () => {
  const grounding = fixture();
  const frame = buildInitiationFrame(
    {
      language: 'da-DK',
      grounding: {
        tenantName: grounding.name,
        agentName: grounding.agentName,
        systemPrompt: buildGroundedPrompt(grounding, 'da-DK'),
        greeting: interpolateGreeting(grounding.greetingDa, grounding.agentName),
        escalationPhone: grounding.escalationPhone,
        knowledgeCount: 0,
        timezone: grounding.timezone,
      },
      voiceId: 'voice-7',
      turnHandling: defaultTurnHandling(85),
      outputSampleRateHz: 16_000,
    },
    { caller: '+4520123456' },
  );
  assert.equal(frame.type, 'conversation_initiation_client_data');
  const override = frame.conversation_config_override;
  assert.equal(override?.agent_override?.first_message, 'Hej, du har fat i Freja.');
  assert.equal(override?.agent_override?.voice?.voice_id, 'voice-7');
  assert.equal(override?.tts_override?.voice_id, 'voice-7');
  assert.equal(override?.tts_override?.voice_settings?.speed, 1.02);
  assert.equal(override?.vad_and_end_of_turn_enabled, true);
  assert.equal(override?.end_of_turn_candidate_end_timeout_ms, 684);
  assert.equal(override?.turn_handling?.turn_timeout_ms, 684);
  assert.equal(override?.agent_override?.turn_handling?.stop_speech_allow_interruptions, true);
  assert.ok((override?.client_events ?? []).includes('interruption'));
  assert.equal(frame.dynamic_variables?.caller, '+4520123456');
  // `agent_id` is a URL query parameter; putting it in the frame is a protocol error.
  assert.equal('agent_id' in frame, false);
  const encoded = JSON.parse(encodeClientEvent(frame));
  assert.equal(encoded.type, 'conversation_initiation_client_data');
});

test('higher sensitivity shortens the end-of-turn wait, and interruptions stay allowed', () => {
  const eager = defaultTurnHandling(100);
  const careful = defaultTurnHandling(20);
  assert.ok(eager.endOfTurnMs < careful.endOfTurnMs);
  assert.equal(eager.allowInterruptions, true, 'a receptionist that cannot be interrupted is a answering machine');
  assert.ok(defaultTurnHandling(0).endOfTurnMs <= 1_200);
});

test('server events decode defensively, and audio is a base64 payload not a URL', () => {
  // A frame that is not JSON is a broken transport, not an unknown event: reporting
  // it as `unknown` is how a socket that has stopped carrying audio looks healthy.
  assert.equal(decodeServerEvent('not json').type, 'error');
  assert.equal(decodeServerEvent('').type, 'error');
  // A frame this build does not consume is skipped, not an error: the provider adds
  // events, and a skipped heartbeat must not tear down a live call.
  assert.equal(decodeServerEvent(JSON.stringify({ type: 'pong_event' })).type, 'ignored');
  assert.equal(decodeServerEvent(JSON.stringify({ type: 42 })).type, 'ignored');
  const audio = decodeServerEvent(
    JSON.stringify({ type: 'audio', audio_event: { audio_base_64: 'QUJDRA==', event_id: 7 } }),
  );
  assert.deepEqual(audio, { type: 'audio', eventId: 7, audioBase64: 'QUJDRA==' });
  // An audio frame with no payload is not an empty turn either — it is nothing.
  assert.equal(decodeServerEvent(JSON.stringify({ type: 'audio', audio_event: {} })).type, 'ignored');
  const interruption = decodeServerEvent(
    JSON.stringify({ type: 'interruption', interruption_event: { event_id: 12, reason: 'user_detected' } }),
  );
  assert.deepEqual(interruption, { type: 'interruption', eventId: 12, reason: 'user_detected' });
  assert.equal(
    decodeServerEvent(JSON.stringify({ type: 'ping', ping_event: { event_id: 3, ping_ms: 20 } })).type,
    'ping',
  );
  assert.deepEqual(decodeServerEvent(JSON.stringify({ type: 'error', error: { message: 'bad key' } })), {
    type: 'error',
    message: 'bad key',
  });
  assert.ok(isPlausibleBase64('QUJDRA=='));
  assert.equal(isPlausibleBase64('data:audio/wav;base64,QUJD'), false);
  assert.equal(isPlausibleBase64('!!!'), false);
});

test('the audio gate discards every provider chunk at or below the interrupt id', () => {
  const gate = new AudioTurnGate();
  assert.equal(gate.accept(1), true);
  assert.equal(gate.accept(2), true);
  gate.interruptAt(5);
  // The provider is still flushing chunks 3-5 for the turn the caller interrupted:
  // playing them is the echo that makes an interruption feel broken.
  assert.equal(gate.accept(3), false);
  assert.equal(gate.accept(5), false);
  assert.equal(gate.accept(6), true);
  assert.deepEqual(gate.stats(), { discarded: 2, played: 3 });
  gate.reset();
  assert.equal(gate.lastInterruptEventId, -1);
  assert.equal(gate.accept(0), true, 'a new call reuses the provider id space');
});

// -----------------------------------------------------------------------------
// Cal.com
// -----------------------------------------------------------------------------

test('slot grids are accepted in both shapes and sorted, and junk yields nothing', () => {
  const grouped = parseSlotsPayload(
    {
      data: {
        slots: {
          '2026-02-03': [{ time: '2026-02-03T10:00:00.000Z' }, { time: '2026-02-03T09:00:00.000Z', duration: 45 }],
        },
      },
    },
    30,
  );
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]?.startIso, '2026-02-03T09:00:00.000Z');
  assert.equal(grouped[0]?.durationMinutes, 45);
  assert.equal(grouped[0]?.dayKey, '2026-02-03');

  const flat = parseSlotsPayload(
    { data: [{ start: '2026-02-03T11:00:00.000Z', end: '2026-02-03T11:30:00.000Z' }] },
    30,
  );
  assert.equal(flat.length, 1);
  assert.equal(flat[0]?.durationMinutes, 30);

  assert.deepEqual(parseSlotsPayload(null, 30), []);
  assert.deepEqual(parseSlotsPayload({ data: { slots: { x: [{ time: 'not-a-date' }] } } }, 30), []);
  assert.deepEqual(parseSlotsPayload({ data: { slots: { x: [{ time: '2026-02-03T10:00:00.000Z', end: '2026-02-03T10:00:00.000Z' }] } } }, 30), [], 'a zero-length slot is not bookable');
});

test('the remote grid is the candidate set and the tenant ledger subtracts from it', () => {
  const slots = [
    { startIso: '2026-02-03T09:00:00.000Z', endIso: '2026-02-03T09:30:00.000Z', startMs: Date.parse('2026-02-03T09:00:00.000Z'), endMs: Date.parse('2026-02-03T09:30:00.000Z'), dayKey: '2026-02-03', durationMinutes: 30 },
    { startIso: '2026-02-03T09:30:00.000Z', endIso: '2026-02-03T10:00:00.000Z', startMs: Date.parse('2026-02-03T09:30:00.000Z'), endMs: Date.parse('2026-02-03T10:00:00.000Z'), dayKey: '2026-02-03', durationMinutes: 30 },
  ];
  const nowMs = Date.parse('2026-02-03T08:00:00.000Z');
  // Half-open: a hold ending exactly when a slot starts does not collide.
  const adjacent = subtractBusy(slots, [{ startIso: '2026-02-03T09:00:00.000Z', endIso: '2026-02-03T09:30:00.000Z' }], { nowMs, minLeadMs: 0 });
  assert.equal(adjacent.length, 1);
  assert.equal(adjacent[0]?.startIso, '2026-02-03T09:30:00.000Z');

  const overlapping = subtractBusy(slots, [{ startIso: '2026-02-03T09:15:00.000Z', endIso: '2026-02-03T09:45:00.000Z' }], { nowMs, minLeadMs: 0 });
  assert.deepEqual(overlapping, []);

  // Nothing sooner than the lead time can be promised, and a malformed range is ignored
  // rather than treated as "busy forever".
  const soon = subtractBusy(slots, [], { nowMs: Date.parse('2026-02-03T09:00:00.000Z'), minLeadMs: 60 * 60_000 });
  assert.deepEqual(soon, []);
  assert.equal(subtractBusy(slots, [{ startIso: 'junk', endIso: 'junk' }], { nowMs, minLeadMs: 0 }).length, 2);
});

test('the slot query pins the v2 contract', () => {
  const config = resolveCalComConfig({ CALCOM_API_KEY: 'cal_api_key', CALCOM_EVENT_TYPE_ID: '42' });
  assert.equal(config.configured, true);
  if (!config.configured) return;
  const url = buildSlotsUrl(config, defaultQueryWindow(Date.parse('2026-02-03T08:00:00.000Z')));
  assert.match(url, /^https:\/\/api\.cal\.com\/v2\/slots\?/u);
  assert.match(url, /eventTypeId=42/u);
  assert.match(url, /timeZone=Europe%2FCopenhagen/u);
  const headers = calComHeaders(config.apiKey);
  assert.equal(headers['cal-api-version'], '2024-08-13');
  assert.equal(headers.Authorization, 'Bearer cal_api_key');
  // A tenant override wins over the deployment default.
  const overridden = resolveCalComConfig({ CALCOM_API_KEY: 'k', CALCOM_TIMEZONE: 'UTC' }, { calcomEventTypeId: '7', timeZone: 'Europe/Berlin' });
  assert.equal(overridden.configured && overridden.timeZone, 'Europe/Berlin');
  assert.equal(overridden.configured && overridden.eventTypeId, 7);
  // No event type means no availability, said out loud.
  assert.equal(resolveCalComConfig({ CALCOM_API_KEY: 'k' }).configured, false);
});

test('a provider that will not answer produces no slots, not a confident empty diary', async () => {
  const unconfigured = await syncSlots(
    resolveCalComConfig({}),
    { fetchImpl: async () => { throw new Error('never'); } },
    { fromIso: '2026-02-03T08:00:00.000Z', toIso: '2026-02-10T08:00:00.000Z' },
    [],
  );
  assert.equal(unconfigured.ok, false);
  assert.equal(unconfigured.source, 'unconfigured');
  assert.deepEqual(unconfigured.slots, []);

  let nowMs = Date.parse('2026-02-03T08:00:00.000Z');
  const deps = (payload: unknown, ok = true, status = 200) => ({
    fetchImpl: async () => ({ ok, status, json: async () => payload }) as Response,
    now: () => nowMs,
  });
  const reachable = await syncSlots(
    resolveCalComConfig({ CALCOM_API_KEY: 'k', CALCOM_EVENT_TYPE_ID: '1' }),
    deps({ data: { slots: { '2026-02-03': [{ time: '2026-02-03T09:00:00.000Z' }] } } }),
    { fromIso: '2026-02-03T08:00:00.000Z', toIso: '2026-02-10T08:00:00.000Z' },
    [],
  );
  assert.equal(reachable.ok, true);
  assert.equal(reachable.slots.length, 1);
  assert.equal(isSlotFresh(reachable, nowMs), true);
  nowMs += 10 * 60_000;
  assert.equal(isSlotFresh(reachable, nowMs), false, 'the grid goes stale after 90s');

  const rejected = await syncSlots(
    resolveCalComConfig({ CALCOM_API_KEY: 'k', CALCOM_EVENT_TYPE_ID: '1' }),
    deps({}, false, 401),
    { fromIso: '2026-02-03T08:00:00.000Z', toIso: '2026-02-10T08:00:00.000Z' },
    [],
  );
  assert.equal(rejected.ok, false);
  assert.match(rejected.error ?? '', /rejected the API key/u);
  assert.equal(rejected.staleAfterMs, 15_000, 'a failure retries sooner than a success expires');
});

test('a phone-only caller can still be booked, and the promise is not repeated twice', () => {
  const email = attendeeEmail({ name: 'Kurt', email: null, phone: '+45 20 12 34 56', language: 'da-DK' });
  assert.equal(email, 'caller-3456@phone.caller.invalid', 'Cal.com 400s on a blank email; the reserved TLD can never receive mail');
  assert.equal(attendeeEmail({ name: 'Kurt', email: ' kurt@example.com ', phone: null, language: 'da-DK' }), 'kurt@example.com');

  const key = bookingIdempotencyKey('tenant-aaaaaaaa-bbbb', 'call-bbbbccccdddd', '2026-02-03T09:00:00.000Z');
  assert.equal(key, bookingIdempotencyKey('tenant-aaaaaaaa-bbbb', 'call-bbbbccccdddd', '2026-02-03T09:00:00Z'));
  assert.notEqual(key, bookingIdempotencyKey('tenant-aaaaaaaa-bbbb', 'call-bbbbccccdddd', '2026-02-03T09:30:00.000Z'));
});

// -----------------------------------------------------------------------------
// Grounding and routing
// -----------------------------------------------------------------------------

test('malformed JSONB degrades to "closed, no prices" instead of throwing mid-call', () => {
  assert.deepEqual(readHoursJson(null).sat, { open: '00:00', close: '00:00', closed: true });
  assert.deepEqual(readHoursJson('{"mon":{"open":"07:00","close":"15:00","closed":false}}').mon, {
    open: '07:00',
    close: '15:00',
    closed: false,
  });
  assert.deepEqual(readHoursJson('not json').wed.closed, true);
  assert.deepEqual(readPricingJson('{"nope":1}'), []);
  // Two generations of the pricing column: the schema shape and the seeded shape.
  assert.deepEqual(readPricingJson([{ service: 'Tag', price_dkk: 1200, unit: 'time' }])[0]?.priceDkk, 1200);
  assert.deepEqual(readPricingJson([{ name: 'Murer', unit_dkk: 695, description: 'i timen' }])[0]?.priceDkk, 695);
  assert.equal(readPricingJson([{ price_dkk: 10 }]).length, 0, 'no service name is no price line');
});

test('open hours are decided in the tenant zone, and an overnight range still works', () => {
  // 2026-02-03 is a Tuesday in Copenhagen.
  const tuesdayMorning = Date.parse('2026-02-03T06:00:00.000Z');
  const open = afterHoursVerdict(fixture(), Date.parse('2026-02-03T09:00:00.000Z'));
  assert.equal(open.open, true);
  assert.equal(open.dayKey, 'tue');
  const closed = afterHoursVerdict(fixture(), tuesdayMorning);
  assert.equal(closed.open, false);
  assert.equal(closed.reason, 'outside_window');
  assert.equal(afterHoursVerdict(fixture({ hours: readHoursJson({ tue: { open: '08:00', close: '16:00', closed: true } }) }), tuesdayMorning).reason, 'closed_day');

  const night = afterHoursVerdict(
    fixture({ hours: readHoursJson({ tue: { open: '22:00', close: '02:00', closed: false } }) }),
    Date.parse('2026-02-03T23:00:00.000Z'),
  );
  assert.equal(night.open, true, 'a range that wraps midnight is open after 22:00');

  // A tenant with no hours at all is closed, and the reason says so.
  const empty = afterHoursVerdict(fixture({ hours: {} }), tuesdayMorning);
  assert.equal(empty.open, false);
  assert.equal(empty.reason, 'unknown');
});

test('the grounded prompt keeps the guardrail and the escalation number', () => {
  const grounding = fixture({
    customerSystemPrompt: 'Du taler altid kort og kontant.',
    pricing: readPricingJson([{ service: 'Tag', price_dkk: 1200, unit: 'time' }]),
    knowledge: [{ id: 'k1', kind: 'fact', title: 'Åbningstider', content: 'Man-fre 8-16', priority: 90, sourceUrl: null }],
  });
  const prompt = buildGroundedPrompt(grounding, 'da-DK', { callerNumber: '+4520123456' });
  // The tenant prompt is prepended, never substituted: a client must not be able to
  // delete the guardrail by rewriting their own prompt.
  assert.ok(prompt.indexOf('Du taler altid kort og kontant.') < prompt.indexOf('Find aldrig på'));
  assert.match(prompt, /Brug kun videngrundlaget/u);
  assert.match(prompt, /\+4533120000/u);
  assert.match(prompt, /Man-fre 8-16/u);
  assert.match(prompt, /Tag: 1\.200 kr\. \/ time/u);
  assert.match(prompt, /\+4520123456/u);
  assert.match(prompt, /Skift til engelsk/u);
  const english = buildGroundedPrompt(grounding, 'en-GB');
  assert.match(english, /Never invent prices/u);
  assert.match(english, /Answer in English/u);
});

test('a tenant that cannot answer from knowledge is not allowed to speak', () => {
  assert.equal(groundingIsSufficient(fixture()), false, 'no knowledge and no prompt');
  assert.equal(groundingIsSufficient(fixture({ knowledge: [{ id: 'k', kind: 'fact', title: 't', content: 'c', priority: 1, sourceUrl: null }] })), true);
  assert.equal(groundingIsSufficient(fixture({ receptionMode: 'human_forward', knowledge: [{ id: 'k', kind: 'fact', title: 't', content: 'c', priority: 1, sourceUrl: null }] })), false);
  assert.equal(groundingIsSufficient(fixture({ status: 'paused', knowledge: [{ id: 'k', kind: 'fact', title: 't', content: 'c', priority: 1, sourceUrl: null }] })), false);
});

test('routing: a number nobody owns is refused, a line that must not answer is forwarded', () => {
  assert.deepEqual(resolveInboundRoute({ grounding: null, numberStatus: null, forwardTo: null }), {
    action: 'reject',
    sipStatus: 404,
    reason: 'unknown_did',
  });

  // "grounded" is the precondition for letting an AI answer at all, so the accept
  // case has to earn it: an empty prompt would have the receptionist improvise.
  const grounded = fixture({ knowledge: groundKnowledge, customerSystemPrompt: 'Mød os på Vesterbrogade 5.' });
  assert.equal(groundingIsSufficient(grounded), true);

  const open = resolveInboundRoute({ grounding: grounded, numberStatus: 'active', forwardTo: null });
  assert.equal(open.action, 'accept');
  assert.equal(open.sipStatus, 200);

  const paused = resolveInboundRoute({ grounding: grounded, numberStatus: 'paused', forwardTo: '+4533120000' });
  assert.equal(paused.action, 'forward');
  assert.equal(paused.sipStatus, 302);
  assert.equal(paused.reason, 'did_paused');
  assert.equal(paused.action === 'forward' ? paused.forwardTo : null, '+4533120000');

  const pool = resolveInboundRoute({ grounding: grounded, numberStatus: 'pool', forwardTo: null });
  assert.equal(pool.reason, 'did_unassigned');
  // No explicit target: the tenant's own escalation line takes the call.
  assert.equal(pool.action === 'forward' ? pool.forwardTo : null, '+4533120000');

  const ungrounded = resolveInboundRoute({
    grounding: fixture({ customerSystemPrompt: null, knowledge: [] }),
    numberStatus: 'active',
    forwardTo: null,
  });
  // A tenant without a knowledge base is *not* refused outright — the line still
  // rings, it just goes to a human instead of to an agent that would improvise.
  assert.equal(groundingIsSufficient(fixture({ customerSystemPrompt: null, knowledge: [] })), false);
  assert.equal(ungrounded.action, 'forward');
  assert.equal(ungrounded.reason, 'no_grounding');

  const closedWithHuman = resolveInboundRoute({
    grounding: fixture({
      knowledge: groundKnowledge,
      customerSystemPrompt: 'Mød os på Vesterbrogade 5.',
      receptionMode: 'human_forward',
      forwardToPhone: '+4570200000',
    }),
    numberStatus: 'active',
    forwardTo: null,
  });
  // A closed desk with a human line is forwarded only when the tenant asked for it;
  // otherwise the AI still answers and takes a message, because a business that
  // shuts at 16:00 still wants the 16:05 lead.
  assert.equal(closedWithHuman.action, 'forward');
  assert.equal(closedWithHuman.reason, 'after_hours_human');
  assert.equal(closedWithHuman.action === 'forward' ? closedWithHuman.forwardTo : null, '+4570200000');

  // An *ungrounded* tenant keeps the AI as a fallback only when it is in voice_ai
  // mode and a human line exists; the reason is what the caller hears, so it must
  // name the missing grounding rather than the paused line.
  const ungroundedActive = resolveInboundRoute({
    grounding: fixture({ customerSystemPrompt: null, knowledge: [] }),
    numberStatus: 'active',
    forwardTo: null,
  });
  assert.equal(ungroundedActive.reason, 'no_grounding');
});

test('ring cadence and the tenant calendar binding come from configuration, not mood', () => {
  assert.equal(ringDelayFor('immediate'), 0);
  assert.equal(ringDelayFor('one-ring'), 1_200);
  assert.equal(ringDelayFor('two-rings'), 2_400);
  assert.equal(calendarBindingOf({}).slotMinutes, 30);
  assert.equal(calendarBindingOf({ calcom_slot_minutes: 1_000 }).slotMinutes, 240);
  assert.equal(calendarBindingOf({ calcom_slot_minutes: 1 }).slotMinutes, 10);
  assert.equal(calendarBindingOf({ calcom_event_type_id: '  ', timezone: '  ' }).eventTypeId, null);
});

test('caller numbers are normalised the way the carrier table already does it', () => {
  assert.equal(normalizeE164('+45 20 12 34 56'), '+4520123456');
  assert.equal(normalizeE164('004520123456'), '+4520123456');
  assert.equal(normalizeE164('20123456'), '+4520123456', 'an 8-digit Danish number is national');
  assert.equal(normalizeE164('20 12'), null);
  assert.equal(normalizeE164(''), null);
  assert.equal(normalizeE164(null), null);
  assert.equal(maskCallerNumber('+4520123456'), '••••••3456');
  assert.equal(maskCallerNumber('123'), '•••');
  assert.equal(maskCallerNumber('anonymous'), '••••••••');
});

// -----------------------------------------------------------------------------
// Room semantics
// -----------------------------------------------------------------------------

test('room and participant names are derived, unique per call, and carrier-shaped', () => {
  assert.equal(telephonyRoomName('dansk-byg', 'call_091201_ab12'), 'dansk-byg_call_091201_ab12');
  // The slug arrives normalised from the database; the room name does not silently
  // rewrite a tenant's identity, it only refuses characters a room name cannot carry.
  assert.equal(telephonyRoomName('  Dansk Byg!!  ', 'call-1'), 'Dansk-Byg_call-1');
  assert.equal(telephonyRoomName('', 'x'), 'tenant_call_x');
  // The tail of the CLI, not the whole number: enough for a desk to recognise who
  // rang, short enough that a room name is not a copy of the carrier's data.
  assert.equal(sipCallerIdentity('+4520123456', 'ab12cd'), 'sip_20123456_ab12cd');
  assert.equal(sipCallerIdentity('unknown', 'xx'), 'sip_anonymous_xx', 'withheld CLI is named, not numbered');
  assert.equal(agentParticipantIdentity('Freja'), 'agent-freja');
  assert.match(ownerParticipantIdentity('user-1', 'zz'), /^owner_user-1_zz$/u);
  assert.equal(AGENT_JOIN_TIMEOUT_MS, 30_000, 'the room stage must match the client timeout in CallPanel');
});

test('the data channel is a strict, single-topic protocol in both directions', () => {
  const encoded = encodeRoomMessage({
    type: 'barge_in',
    latencyMs: 118,
    withinBudget: true,
    path: 'double_talk',
    atMs: 118,
  });
  // One topic for the whole protocol: a room may carry other publishers, and a
  // consumer that listens to everything will act on somebody else's telemetry.
  assert.equal(encoded.topic, TELEPHONY_DATA_TOPIC);
  assert.deepEqual(JSON.parse(encoded.payload), {
    type: 'barge_in',
    latencyMs: 118,
    withinBudget: true,
    path: 'double_talk',
    atMs: 118,
  });

  const transcript = encodeRoomMessage({
    type: 'transcript',
    role: 'caller',
    text: 'Jeg vil booke en tid',
    timestampMs: 4_200,
    language: 'da-DK',
  });
  assert.equal(transcript.topic, TELEPHONY_DATA_TOPIC);

  const telemetry = encodeRoomMessage({
    type: 'telemetry',
    sttMs: LATENCY_BUDGETS.sttMs,
    llmFirstTokenMs: LATENCY_BUDGETS.llmFirstTokenMs,
    ttsFirstByteMs: LATENCY_BUDGETS.ttsFirstByteMs,
    roundTripMs: roundTripOf(LATENCY_BUDGETS),
    budgetMs: ROUND_TRIP_BUDGET_MS,
    discardedAudioEvents: 3,
    overBudgetCommits: 1,
  });
  assert.equal(JSON.parse(telemetry.payload).roundTripMs, 510);

  // Inbound frames are the ones that matter for trust: the data channel is writable
  // by every participant the token admitted, so anything that is not exactly a known
  // shape is dropped rather than coerced.
  assert.deepEqual(decodeRoomMessage(JSON.stringify({ type: 'request_transfer', reason: 'caller asked' })), {
    type: 'request_transfer',
    reason: 'caller asked',
  });
  assert.deepEqual(decodeRoomMessage(JSON.stringify({ type: 'end_call' })), { type: 'end_call', reason: null });
  assert.deepEqual(decodeRoomMessage(JSON.stringify({ type: 'caller_transcript', text:  '  hej  ' })), {
    type: 'caller_transcript',
    text: 'hej',
  });
  assert.equal(decodeRoomMessage(JSON.stringify({ type: 'not_a_real_type' })), null);
  assert.equal(decodeRoomMessage(JSON.stringify({ type: 'caller_transcript', text: 42 })), null);
  assert.equal(decodeRoomMessage(JSON.stringify({ type: 'caller_transcript', text: '   ' })), null);
  assert.equal(decodeRoomMessage(JSON.stringify({ type: 'request_transfer' })), null);
  assert.equal(decodeRoomMessage('nonsense'), null);
  assert.equal(decodeRoomMessage('[]'), null);
  assert.equal(decodeRoomMessage('null'), null);
  // A participant must not be able to stream a novel into a room.
  assert.equal(decodeRoomMessage(JSON.stringify({ type: 'caller_transcript', text: 'x'.repeat(5_000) })), null);
});

// -----------------------------------------------------------------------------
// Fold and contracts
// -----------------------------------------------------------------------------

test('a turn is folded once, and only a live call accepts one', () => {
  const started = beginSession({
    callId: 'call-5',
    tenantId: 'tenant-1',
    callerNumber: '+4520123456',
    language: 'da-DK',
    startedAtMs: 0,
    startedAtIso: '2026-01-01T08:00:00.000Z',
  });
  const active = transitionTo(started, 'active');
  assert.ok(active.ok);
  if (!active.ok) return;

  const first = foldCallerTurn(active.session, { role: 'caller', text: 'Hej', atMs: 1_000 });
  assert.equal(first.applied, true);
  assert.equal(first.reason, null);
  const dupe = foldCallerTurn(first.session, { role: 'caller', text: '  hej ', atMs: 1_200 });
  assert.equal(dupe.applied, false);
  assert.equal(dupe.reason, 'duplicate_of_previous_turn');
  // A clock that steps backwards is rejected rather than folded in as a negative turn.
  assert.equal(foldCallerTurn(first.session, { role: 'caller', text: 'tidligere', atMs: -5 }).reason, 'invalid_timestamp');
  assert.equal(foldCallerTurn(first.session, { role: 'caller', text: '   ', atMs: 10 }).reason, 'empty_transcript');

  const measured = foldCallerTurn(first.session, { role: 'agent', text: 'Jeg giver dig en tid', atMs: 2_000 }, { measuredRoundTripMs: 140 });
  assert.equal(measured.session.latencyMs, 140);
  assert.equal(acceptsCallerInput('active'), true);
  assert.equal(acceptsCallerInput('transferring'), true);
  assert.equal(acceptsCallerInput('connecting'), false);
  assert.equal(acceptsCallerInput('completed'), false);
});

test('the wire contracts accept what carriers send and reject what they must not', () => {
  const webhook = DispatchBodySchema.safeParse({
    event: 'inbound_call',
    tr_sip_to: '+453542110',
    tr_sip_from: '+4527441802',
    room: { name: 'ignored' },
    trunk_region: 'eu-central-1',
  });
  assert.equal(webhook.success, true, 'unknown carrier keys are dropped, not rejected');
  if (!webhook.success) return;
  assert.equal(webhook.data.did, undefined);
  assert.equal(webhook.data.state, 'connected');
  assert.equal(webhook.data.event, 'inbound_call');

  const bench = DispatchBodySchema.safeParse({ did: '+453542110', caller: '+4527441802', state: 'ringing' });
  assert.equal(bench.success, true);
  assert.equal(DispatchBodySchema.safeParse({ did: '+453542110', state: 'nonsense' }).success, false);
  // A webhook with no numbers at all is still parseable — the *route* decides that a
  // call must name a line, because `did` may legitimately arrive as `tr_sip_to`
  // instead, and the schema cannot know which carrier is speaking.
  assert.equal(DispatchBodySchema.safeParse({ caller: '+4527441802' }).success, true);
  assert.equal(DispatchBodySchema.safeParse({}).success, true, 'defaults fill in what a bench omits');
  assert.equal(DispatchBodySchema.parse({}).event, 'dispatch.simulate');
  // …and the route owns the decision that a call must name a line.
  assert.match(
    code('../src/app/api/telephony/dispatch/route.ts'),
    /Missing dialed number/u,
    'the 400 lives in the route, not in a schema that cannot know which field the carrier used',
  );

  // The console bench may describe the line it is simulating; the profile is clamped
  // to what the carrier can actually be configured with.
  const line = LineProfileSchema.safeParse({ codec: 'OPUS', sampleRateHz: 48_000, jitterMs: 12, forwardTo: '+4533120000' });
  assert.equal(line.success && line.data.ringBehavior, 'one-ring');
  // 8 kHz is the narrowest thing a trunk can negotiate; 4 kHz is not a telephony rate.
  assert.equal(LineProfileSchema.safeParse({ sampleRateHz: 8_000 }).success, true);
  assert.equal(LineProfileSchema.safeParse({ sampleRateHz: 4_000 }).success, false);
  assert.equal(LineProfileSchema.safeParse({ jitterMs: 5_000 }).success, false);
  assert.equal(LineProfileSchema.safeParse({ codec: 'G729' }).success, false);

  assert.equal(
    EndCallBodySchema.safeParse({ callId: 'call-1', tenantId: 'not-a-uuid', reason: 'hangup', transcript: [] }).success,
    false,
  );

  const turn = SessionControlSchema.safeParse({
    action: 'turn',
    callId: 'call-1',
    tenantId: '3f0f9f2a-1c1b-4d7a-9b5f-0a1e2c3d4e5f',
    role: 'caller',
    text: 'Jeg vil booke',
    atMs: 1200,
    measuredRoundTripMs: 132,
  });
  assert.equal(turn.success, true);

  // The client reports a measurement; it may not report a verdict. A self-declared
  // `withinBudget` is not rejected — that would break a console deployed a day ahead
  // of the bridge — it is *stripped*, so the field never reaches the code that
  // recomputes it from the tenant's budget.
  const smuggling = SessionControlSchema.safeParse({
    action: 'barge_in',
    callId: 'call-1',
    tenantId: '3f0f9f2a-1c1b-4d7a-9b5f-0a1e2c3d4e5f',
    latencyMs: 40,
    withinBudget: true,
    commits: 99,
  });
  assert.equal(smuggling.success, true);
  if (smuggling.success) {
    assert.equal(
      smuggling.data.action === 'barge_in' ? smuggling.data.latencyMs : null,
      40,
      'the measurement is kept',
    );
    assert.ok(!('withinBudget' in smuggling.data), 'the verdict never survives the boundary');
    assert.ok(!('commits' in smuggling.data), 'nor an invented commit count');
  }
  assert.equal(
    SessionControlSchema.safeParse({
      action: 'book',
      callId: 'call-1',
      tenantId: '3f0f9f2a-1c1b-4d7a-9b5f-0a1e2c3d4e5f',
      startIso: '2026-02-03T09:00:00Z',
      durationMinutes: 900,
      attendee: { name: 'Kurt' },
    }).success,
    false,
  );
  assert.equal(SessionControlSchema.safeParse({ action: 'telepathy' }).success, false);
});

// -----------------------------------------------------------------------------
// Wiring that the unit tests above cannot prove
// -----------------------------------------------------------------------------

const telephonyDir = fileURLToPath(new URL('../src/lib/telephony/', import.meta.url));
const modules = readdirSync(telephonyDir).filter((name) => name.endsWith('.ts'));

test('the pure half of the bridge stays pure, so it is testable without a socket or a database', () => {
  const pure = ['types.ts', 'session-machine.ts', 'barge-in.ts', 'calcom.ts', 'grounding.ts', 'livekit-room.ts', 'session-control.ts', 'elevenlabs.ts'];
  for (const name of pure) {
    const text = source(`../src/lib/telephony/${name}`);
    assert.equal(text.includes("import 'server-only'"), false, `${name} must load in a browser bundle`);
    assert.equal(text.includes('server-only'), false, `${name} must not depend on the server runtime`);
    assert.doesNotMatch(text, /from ['"]@\/lib\/db/, `${name} must not reach for SQL`);
    assert.doesNotMatch(text, /process\.env\./u, `${name} takes configuration as an argument`);
    assert.doesNotMatch(text, /Math\.random/u, `${name} must be deterministic`);
  }
  // Only the modules that touch SQL or the process environment may import the guard.
  for (const name of modules) {
    const text = source(`../src/lib/telephony/${name}`);
    if (text.includes("import 'server-only'")) {
      assert.ok(
        ['bridge.ts', 'tenant-grounding.ts'].includes(name),
        `${name} declares itself server-only but has no server-only dependency`,
      );
    }
  }
});

test('no browser component imports the server half of the bridge', () => {
  const offenders: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const text = readFileSync(path, 'utf8');
      if (!text.includes("'use client'") && !text.includes('"use client"')) continue;
      const importsServerHalf = /from ['"]@\/lib\/telephony(\/(index|bridge|tenant-grounding))?['"]/.test(text);
      if (importsServerHalf) offenders.push(path);
    }
  };
  walk(fileURLToPath(new URL('../src/', import.meta.url)));
  assert.deepEqual(offenders, [], 'the barrel re-exports server-only modules; clients import the pure files directly');
});

test('dispatch reports budgets instead of inventing latencies', () => {
  // Comments are allowed to say what the code must not do, so grep the code.
  const route = code('../src/app/api/telephony/dispatch/route.ts');
  assert.doesNotMatch(route, /Math\.random/u, 'a fabricated latency on a dashboard is worse than no dashboard');
  assert.match(route, /dispatchInboundCall/u);
  assert.match(route, /DispatchBodySchema/u);
  assert.match(route, /LATENCY_BUDGETS/u);
  assert.match(route, /apiSession\(\)/u, 'a tenant override is only honoured for a signed-in operator');
  // Trunk credentials are not echoed, not even masked.
  assert.doesNotMatch(route, /sipPassword/u);
  assert.match(route, /export const dynamic = "force-dynamic"/u);
});

test('the control route scopes a call three ways and has an exhaustive action switch', () => {
  const route = source('../src/app/api/telephony/session/route.ts');
  assert.match(route, /apiRequireTenant\(control\.tenantId\)/u);
  assert.match(route, /live\.tenantId !== control\.tenantId/u);
  assert.match(route, /const never: never = control/u);
  // A call that is not live in this worker is answered from the ledger, not faked.
  assert.match(route, /loadTelephonyCallSession/u);
  assert.match(route, /alreadyClosed: true/u);
  assert.match(route, /const parsed = SessionControlSchema\.safeParse/u);
});

test('the live token route binds to the room the bridge reserved', () => {
  const route = source('../src/app/api/livekit/token/route.ts');
  assert.match(route, /RoomAgentDispatch/u);
  assert.match(route, /agentName:\s*LIVEKIT_AGENT_NAME/u);
  assert.match(route, /at\.roomConfig\s*=/u);
  // A bridge join reuses the reserved room and never dispatches a second agent.
  assert.match(route, /binding\.context\.roomName/u);
  assert.match(route, /\.\.\.\(binding \? \{\} : \{ agents:/u);
  assert.match(route, /canPublishData: Boolean\(binding\)/u);
  assert.match(route, /Only a workspace member can join a live phone call/u);
});

test('the studio meters show the bridge budget without touching the round-trip contract', () => {
  const waveform = source('../src/components/audio/Waveform.tsx');
  assert.match(waveform, /const budget = 300;/u, 'the round-trip meter keeps its own contract');
  assert.doesNotMatch(waveform, /requestAnimationFrame/u, 'Waveform stays CSS-driven');
  assert.match(waveform, /TelephonyBargeInMeter/u);
  assert.match(waveform, /BARGE_IN_BUDGET_MS/u);
  assert.match(waveform, /judgeLatency/u);

  const orb = source('../src/components/audio/OrbVisualizer.tsx');
  assert.equal((orb.match(/requestAnimationFrame/gu) ?? []).length, 2, 'exactly the two RAF sites the shader owns');
  assert.match(orb, /cancelAnimationFrame\(frame\)/u);
  assert.match(orb, /bargeIn/u);
  assert.match(orb, /role="status"|role=\{?"?status/u);

  const modal = source('../src/components/agency/DialInTestModal.tsx');
  assert.match(modal, /TelephonyBargeInMeter/u);
  assert.match(modal, /awaiting commit|no measurement point/u, 'a budget must not be rendered as a measurement');
});

test('the ledger migration owns the barge-in budget as a column constraint', () => {
  const migration = source('../../db/migrations/0021_voice_receptionist_bridge.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.tenant_telephony_bindings/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.telephony_call_sessions/u);
  assert.match(migration, /barge_in_budget_ms\s+SMALLINT NOT NULL DEFAULT 150\s+CHECK \(barge_in_budget_ms BETWEEN 40 AND 150\)/u);
  assert.match(migration, /language\s+VARCHAR\(5\) NOT NULL\s+CHECK \(language IN \('da-DK', 'en-GB'\)\)/u);
  assert.match(migration, /call_id\s+TEXT NOT NULL UNIQUE/u);
  assert.match(migration, /status\s+VARCHAR\(16\) NOT NULL DEFAULT 'connecting'/u);
  assert.match(migration, /ALTER TABLE public\.telephony_call_sessions ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /ALTER TABLE public\.tenant_telephony_bindings ENABLE ROW LEVEL SECURITY/u);
  // A tenant user may read their own binding; only the agency may route calls.
  assert.match(migration, /FOR ALL TO omni_app\s+USING \(public\.is_agency\(\)\)/u);
  // No DELETE policy at all: a call record is not deletable from the app role.
  assert.doesNotMatch(migration, /FOR DELETE/u);
  // The status trigger refuses a backwards move, so the ledger cannot be rewritten.
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.guard_telephony_session_progression\(\)/u);
  assert.match(migration, /RAISE EXCEPTION 'telephony call % cannot move backwards from % to %'/u);
  assert.match(
    migration,
    /RAISE EXCEPTION 'telephony call % is %; a terminal call cannot return to %'/u,
    'a completed call cannot be reopened by a replayed webhook',
  );
  assert.match(migration, /CREATE TRIGGER trg_guard_telephony_session_progression/u);
  assert.match(migration, /BEFORE UPDATE ON public\.telephony_call_sessions/u);
  // The tenant budget, the forward target and the Cal.com event type are all columns,
  // not JSON: a binding has to be auditable with a SELECT.
  assert.match(migration, /calcom_event_type_id/u);
  assert.match(migration, /calcom_slot_minutes[^,]*CHECK \(calcom_slot_minutes BETWEEN 10 AND 240\)/su);
  assert.match(migration, /forward_to_phone/u);
  assert.match(migration, /audio_format_expectation/u);
});
