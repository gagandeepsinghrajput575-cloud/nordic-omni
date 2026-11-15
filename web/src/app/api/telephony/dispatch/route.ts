import {
  findNumberByDialed,
  getAgencyWorkspace,
  prettyDanishNumber,
  recordSipSession,
} from "@/lib/data";
import { apiSession } from "@/lib/auth/guard";
import { jsonError, readJson } from "@/lib/api-utils";
import { dispatchInboundCall, type TrunkLineProfile } from "@/lib/telephony/bridge";
import { DispatchBodySchema } from "@/lib/telephony/contracts";
import { BARGE_IN_BUDGET_MS, LATENCY_BUDGETS, judgeLatency, roundTripOf } from "@/lib/telephony/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * LiveKit SIP inbound webhook / dispatch handler.
 *
 * This route is deliberately thin. It parses the carrier payload, hands the call to
 * `dispatchInboundCall`, and formats the result — the tenant resolution, the
 * after-hours verdict, the ElevenLabs provisioning decision, the Cal.com slot sync
 * and the barge-in budget all live in `@/lib/telephony`, because the agent worker
 * and the console have to make exactly the same decisions and cannot be allowed to
 * drift apart.
 *
 * Two supported call shapes, both validated by `DispatchBodySchema`:
 *  1. LiveKit SIP webhook:  { event: "inbound_call", tr_sip_to: "+45…", tr_sip_from: "+45…" }
 *  2. Console dial-in bench: { did: "+45…", caller: "+45…", state: "connected" }
 *
 * **What changed from the first cut of this route.** Latency used to be
 * `150 + Math.round(Math.random() * 40)`. The numbers are now the *budget* the
 * tenant is configured against — the same ceilings the provider socket measures
 * against — and `telemetry.source` says whether a figure is a budget or a
 * measurement. A dashboard of invented latencies is worse than no dashboard: it
 * teaches an operator to trust a number that means nothing.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const parsed = DispatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid dispatch payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const dialedRaw = input.did || input.tr_sip_to || input.called_number || "";
  const callerRaw = input.caller || input.tr_sip_from || input.caller_number || "";

  if (!dialedRaw) {
    return jsonError("Missing dialed number (did / tr_sip_to). Provide the +45 DID the caller dialled.");
  }

  // The carrier record supplies the media profile. A webhook may *name* a number,
  // but it does not get to describe the trunk it arrived on.
  const number = await findNumberByDialed(dialedRaw);
  const line: TrunkLineProfile | null = number
    ? {
        e164: number.e164,
        codec: number.codec,
        sampleRateHz: number.sampleRate,
        ringBehavior: number.ringBehavior,
        jitterMs: number.jitterMs,
        packetLossPct: number.packetLoss,
        dispatchRuleId: number.dispatchRuleId,
        sipTrunkHost: number.sipTrunkHost,
        sipUsername: number.sipUsername,
        status: number.status === "paused" ? "paused" : number.status === "pool" ? "pool" : "active",
        forwardTo: null,
      }
    : null;

  // A signed-in operator may pin the workspace they are testing. A webhook cannot:
  // the DID is the only tenant selector on the carrier path.
  const session = await apiSession();
  const outcome = await dispatchInboundCall(
    {
      did: dialedRaw,
      callerNumber: callerRaw || null,
      event: input.event,
      requestedState: input.state,
      transcriptPreview: input.transcriptPreview ?? null,
      tenantIdOverride: session ? input.tenantId ?? null : null,
      actor: session ? { kind: "user", userId: session.userId } : null,
      line,
      languageHint: input.language ?? null,
    },
    // Node's global fetch: the Cal.com slot query and the ElevenLabs signed-URL mint
    // are the only two outbound calls on this path, and both are optional.
    { fetchImpl: globalThis.fetch },
  );

  if (!outcome.ok) {
    return Response.json(
      {
        ok: false,
        error: outcome.message,
        action: outcome.action,
        reason: outcome.reason,
        sipStatus: outcome.sipStatus,
        forwardTo: outcome.forwardTo,
        dialed: prettyDanishNumber(dialedRaw),
        caller: callerRaw ? prettyDanishNumber(callerRaw) : "anonymous",
        telemetry: outcome.telemetry,
        session: null,
      },
      // 302/404 are SIP statuses; HTTP says why the JSON looks the way it does.
      { status: outcome.sipStatus === 404 ? 404 : 409 },
    );
  }

  const { grounding, room, voice, calendar, telemetry, bargeIn, session: live, open } = outcome;
  const roundTrip = roundTripOf(LATENCY_BUDGETS);
  const verdict = judgeLatency(live.latencyMs, bargeIn.budgetMs);
  const dispatchRuleId = room.dispatchRuleId;
  const agency = await getAgencyWorkspace();

  const state =
    input.state === "ringing" || live.status === "connecting"
      ? "ringing"
      : input.state === "completed"
        ? "completed"
        : "connected";

  const recorded = await recordSipSession({
    agencyId: agency.id,
    workspaceId: grounding.tenantId,
    numberId: number?.id ?? "",
    roomName: room.roomName,
    callerNumber: outcome.session.callerNumber === "anonymous" ? null : outcome.session.callerNumber,
    dialedNumber: prettyDanishNumber(outcome.dialed),
    state,
    codec: number?.codec ?? "PCMA",
    ringDelayMs: telemetry.ringDelayMs,
    sttLatencyMs: telemetry.sttLatencyMs,
    llmFirstTokenMs: telemetry.llmFirstTokenMs,
    ttsFirstByteMs: telemetry.ttsFirstByteMs,
    roundTripMs: telemetry.roundTripMs || roundTrip,
    jitterMs: telemetry.jitterMs,
    packetLossPct: telemetry.packetLossPct,
    mos: telemetry.mos,
    transcriptPreview:
      input.transcriptPreview?.trim() ||
      (open.isOpen ? voice.greeting : `Closed · ${open.reason} · ${grounding.agentName} takes a message`),
    startedAt: live.startedAtIso,
    endedAt: state === "connected" || state === "ringing" ? null : new Date().toISOString(),
  });

  return Response.json({
    ok: true,
    action: "accept",
    event: input.event,
    sipStatus: 200,
    callId: outcome.callId,
    caller: outcome.caller ? prettyDanishNumber(outcome.caller) : "anonymous",
    dialed: prettyDanishNumber(outcome.dialed),
    tenant: {
      id: grounding.tenantId,
      slug: grounding.slug,
      name: grounding.name,
      agentName: grounding.agentName,
      language: grounding.language,
      receptionMode: grounding.receptionMode,
    },
    dispatch: {
      provider: "livekit",
      dispatchRuleId,
      roomName: room.roomName,
      agentName: grounding.agentName,
      metadata: {
        workspaceSlug: grounding.slug,
        agencySlug: agency.slug,
        did: prettyDanishNumber(outcome.dialed),
        caller: outcome.caller ? prettyDanishNumber(outcome.caller) : "anonymous",
        attempt: outcome.callId.slice(-6),
        codec: number?.codec ?? "PCMA",
        sampleRate: number?.sampleRate ?? 16000,
        ringDelayMs: telemetry.ringDelayMs,
        voiceModel: voice.provider,
        greetingLanguage: live.language,
      },
      agent: {
        kind: "AgentSession",
        entrypoint: "agent-worker:entrypoint",
        participantIdentity: room.agentIdentity,
        identityPrefix: "sip_",
      },
      websocketUrl: room.websocketUrl,
      sipEndpoint: room.sipEndpoint,
      // Trunk credentials are never echoed — not even masked. The dispatch rule
      // owns them on the LiveKit side; a console payload that carries a prefix of a
      // SIP password is a secret in a browser's network log.
      trunkAuth: { username: room.sipUsername, passwordIncluded: false },
      callControl: {
        method: "POST",
        path: "/api/telephony/session",
        actions: ["turn", "barge_in", "end", "book"],
      },
    },
    telemetry: {
      ...telemetry,
      roundTripMs: telemetry.roundTripMs || roundTrip,
      budgets: {
        ...LATENCY_BUDGETS,
        bargeInMs: bargeIn.budgetMs,
        roundTripMs: roundTrip,
      },
      measured: {
        sessionLatencyMs: live.latencyMs,
        withinBudget: verdict.withinBudget,
        overByMs: verdict.overByMs,
      },
    },
    bargeIn: {
      budgetMs: BARGE_IN_BUDGET_MS,
      tenantBudgetMs: bargeIn.budgetMs,
      policy: bargeIn.policy,
      measurementPoint: bargeIn.measurementPoint,
    },
    voice: {
      provider: voice.provider,
      configured: voice.configured,
      reason: voice.reason,
      agentId: voice.agentId,
      greeting: voice.greeting,
      signedUrlExpiresAtMs: voice.signedUrlExpiresAtMs,
      audioFormat: voice.audioFormatExpectation,
      turnHandling: voice.turnHandling,
    },
    calendar: {
      configured: calendar.configured,
      reason: calendar.reason,
      timeZone: calendar.timeZone,
      availableSlots: calendar.availableCount,
      nextSlot: calendar.nextSlot,
      staleAfterMs: calendar.staleAfterMs,
    },
    open: {
      isOpen: open.isOpen,
      localTime: open.localTime,
      reason: open.reason,
    },
    grounded: {
      knowledgeCount: grounding.knowledge.length,
      pricingEntries: grounding.pricing.length,
      escalationPhone: grounding.escalationPhone,
      persisted: outcome.persisted,
    },
    capacity: outcome.capacity,
    session: recorded ?? null,
  });
}
