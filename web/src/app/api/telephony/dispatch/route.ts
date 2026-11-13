import {
  findNumberByDialed,
  getAgencyWorkspace,
  getWorkspaceById,
  prettyDanishNumber,
  recordSipSession,
} from "@/lib/data";
import { isRecord, jsonError, readJson, readString } from "@/lib/api-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * LiveKit SIP inbound webhook / dispatch handler.
 *
 * Two supported call shapes:
 *  1. LiveKit SIP webhook:  { event: "inbound_call", tr_sip_to: "+45…", tr_sip_from: "+45…", room: {...} }
 *  2. Dispatch simulation:  { did: "+45…", caller: "+45…", state: "connected" }
 *
 * The handler resolves the tenant from `flynumber_did`, creates an attempt-scoped
 * room, binds the tenant agent and returns the LiveKit dispatch payload the SIP
 * gateway must join.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const event = readString(body, "event", "dispatch.simulate");

  const dialedRaw =
    readString(body, "did") ||
    readString(body, "tr_sip_to") ||
    readString(body, "called_number") ||
    (isRecord(body.room) ? readString(body.room, "name") : "");
  const callerNumber =
    readString(body, "caller") || readString(body, "tr_sip_from") || readString(body, "caller_number");

  if (!dialedRaw) {
    return jsonError("Missing dialed number (did / tr_sip_to). Provide the +45 DID the caller dialled.");
  }

  const number = await findNumberByDialed(dialedRaw);
  if (!number) {
    return Response.json(
      {
        ok: false,
        error: "No FlyNumber DID is mapped to that dialled number",
        dialed: dialedRaw,
        action: "reject",
        sipStatus: 404,
      },
      { status: 404 },
    );
  }

  if (number.status !== "active" || !number.workspaceId) {
    return Response.json(
      {
        ok: false,
        error: number.status === "pool" ? "DID is unassigned in the carrier pool" : "DID is paused for this tenant",
        action: "forward",
        forwardTo: "+4533120000",
        dialed: prettyDanishNumber(number.e164),
      },
      { status: 409 },
    );
  }

  const workspace = await getWorkspaceById(number.workspaceId);
  if (!workspace) {
    return jsonError("DID is bound to a workspace that no longer exists", 409);
  }

  const attempt = Math.random().toString(36).slice(2, 7);
  const roomName = readString(body, "room") || `call-${dialedRaw.replace(/\D/g, "").slice(-4)}-${attempt}`;
  const ringDelayMs = number.ringBehavior === "immediate" ? 0 : number.ringBehavior === "two-rings" ? 2400 : 1200;
  const state = ["ringing", "connected", "completed", "failed", "missed"].includes(readString(body, "state"))
    ? readString(body, "state")
    : "connected";

  const stt = 150 + Math.round(Math.random() * 40);
  const llm = 180 + Math.round(Math.random() * 70);
  const tts = 105 + Math.round(Math.random() * 40);
  const jitter = number.jitterMs + Math.round(Math.random() * 4);
  const loss = number.packetLoss + (Math.random() > 0.9 ? 1 : 0);
  const roundTrip = stt + llm + tts;
  const mos = Math.max(28, Math.min(45, 45 - Math.round(jitter / 3) - loss * 2));

  const session = await recordSipSession({
    agencyId: number.id,
    workspaceId: workspace.id,
    numberId: number.id,
    roomName,
    callerNumber: callerNumber || null,
    dialedNumber: prettyDanishNumber(number.e164),
    state,
    codec: number.codec,
    ringDelayMs,
    sttLatencyMs: stt,
    llmFirstTokenMs: llm,
    ttsFirstByteMs: tts,
    roundTripMs: roundTrip,
    jitterMs: jitter,
    packetLossPct: loss,
    mos,
    transcriptPreview: readString(body, "transcriptPreview") || "Live inbound call — greeting dispatched to the SIP participant.",
    startedAt: new Date().toISOString(),
    endedAt: state === "connected" || state === "ringing" ? null : new Date().toISOString(),
  });

  const dispatchRuleId = number.dispatchRuleId ?? `SDR_${number.e164.replace(/\D/g, "").slice(-6)}`;
  const agency = await getAgencyWorkspace();

  return Response.json({
    ok: true,
    action: "accept",
    event,
    sipStatus: 200,
    caller: callerNumber ? prettyDanishNumber(callerNumber) : "anonymous",
    dialed: prettyDanishNumber(number.e164),
    tenant: { id: workspace.id, slug: workspace.slug, name: workspace.name, agentName: workspace.agentName, language: workspace.defaultLanguage },
    dispatch: {
      provider: "livekit",
      dispatchRuleId,
      roomName,
      agentName: workspace.agentName,
      metadata: {
        workspaceSlug: workspace.slug,
        agencySlug: agency.slug,
        did: prettyDanishNumber(number.e164),
        caller: callerNumber ? prettyDanishNumber(callerNumber) : "anonymous",
        attempt,
        codec: number.codec,
        sampleRate: number.sampleRate,
        ringDelayMs,
        voiceModel: workspace.voiceModel,
        greetingLanguage: workspace.defaultLanguage,
      },
      agent: {
        kind: "AgentSession",
        entrypoint: "agent-worker:entrypoint",
        participantIdentity: `agent-${workspace.agentName.toLowerCase()}`,
        identityPrefix: "sip_",
      },
      websocketUrl: `wss://${number.sipTrunkHost}/rtc`,
      sipEndpoint: `sip:${number.sipUsername}@${number.sipTrunkHost}`,
      trunkAuth: { username: number.sipUsername, passwordMasked: `${number.sipPassword.slice(0, 8)}…` },
    },
    telemetry: {
      ringDelayMs,
      sttLatencyMs: stt,
      llmFirstTokenMs: llm,
      ttsFirstByteMs: tts,
      roundTripMs: roundTrip,
      jitterMs: jitter,
      packetLossPct: loss,
      mos,
    },
    session: session ?? null,
  });
}
