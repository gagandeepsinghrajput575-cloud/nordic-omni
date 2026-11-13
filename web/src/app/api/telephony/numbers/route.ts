import {
  createTelephonyNumber,
  getAgencyWorkspace,
  getTelephonyHealth,
  getTelephonyNumbers,
  listClientWorkspaces,
  updateTelephonyNumber,
} from "@/lib/data";
import { jsonError, readJson, readString, resolveRequestWorkspace } from "@/lib/api-utils";
import type { RingBehavior, SipCodec, TelephonyMode, TelephonyNumberView } from "@/lib/types";

export const dynamic = "force-dynamic";

const MODES: TelephonyMode[] = ["webrtc", "sip"];
const RINGS: RingBehavior[] = ["immediate", "one-ring", "two-rings"];
const CODECS: SipCodec[] = ["PCMA", "PCMU", "OPUS", "AMR-WB"];
const RING_DELAY: Record<RingBehavior, number> = { immediate: 0, "one-ring": 1200, "two-rings": 2400 };

export async function GET(): Promise<Response> {
  const agency = await getAgencyWorkspace();
  const [numbers, health, clients] = await Promise.all([
    getTelephonyNumbers(agency.id),
    getTelephonyHealth(agency.id),
    listClientWorkspaces(agency.id),
  ]);
  return Response.json({
    numbers,
    health,
    clients: clients.map((client) => ({ id: client.id, name: client.name, slug: client.slug, agentName: client.agentName })),
    ringDelayMap: RING_DELAY,
  });
}

export async function PUT(request: Request): Promise<Response> {
  const agency = await getAgencyWorkspace();
  const body = await readJson(request);
  const id = readString(body, "id").trim();
  if (!id) return jsonError("Number id is required");

  const patch: Partial<TelephonyNumberView> = {};

  const mode = readString(body, "mode");
  if (MODES.includes(mode as TelephonyMode)) {
    patch.mode = mode as TelephonyMode;
    if (mode === "webrtc") {
      patch.codec = "OPUS";
      patch.sampleRate = 48000;
    } else if (mode === "sip") {
      patch.codec = "PCMA";
      patch.sampleRate = 16000;
    }
  }

  const ringBehavior = readString(body, "ringBehavior");
  if (RINGS.includes(ringBehavior as RingBehavior)) {
    patch.ringBehavior = ringBehavior as RingBehavior;
  }

  const codec = readString(body, "codec");
  if (CODECS.includes(codec as SipCodec)) {
    patch.codec = codec as SipCodec;
    patch.sampleRate = codec === "OPUS" ? 48000 : codec === "AMR-WB" ? 16000 : 8000;
  }

  const label = readString(body, "label").trim();
  if (label) patch.label = label.slice(0, 80);

  const status = readString(body, "status");
  if (["active", "paused", "pool"].includes(status)) patch.status = status;

  const workspaceId = readString(body, "workspaceId").trim();
  if (workspaceId === "unassigned") {
    patch.workspaceId = null;
    patch.status = "pool";
  } else if (workspaceId) {
    const clients = await listClientWorkspaces(agency.id);
    if (!clients.some((client) => client.id === workspaceId) && workspaceId !== agency.id) {
      return jsonError("Assign the number to one of your own client workspaces", 422);
    }
    patch.workspaceId = workspaceId;
    patch.status = "active";
  }

  if (readString(body, "regenerateCredentials") === "true") {
    const suffix = Math.random().toString(36).slice(2, 8);
    patch.sipUsername = `omni_${suffix}`;
    patch.sipPassword = `sk_live_${Math.random().toString(36).slice(2, 14)}`;
    patch.dispatchRuleId = `SDR_${suffix}_${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  }

  if (Object.keys(patch).length === 0) {
    return jsonError("No editable telephony fields were supplied");
  }

  const updated = await updateTelephonyNumber(agency.id, id, patch);
  if (!updated) return jsonError("Telephony number not found", 404);

  const numbers = await getTelephonyNumbers(agency.id);
  return Response.json({ ok: true, numbers, updated });
}

export async function POST(request: Request): Promise<Response> {
  const agency = await getAgencyWorkspace();
  const body = await readJson(request);
  const workspace = await resolveRequestWorkspace(body);
  if (!workspace) return jsonError("Workspace not found", 404);

  const numbers = await getTelephonyNumbers(agency.id);
  const existing = numbers.find((n) => n.workspaceId === workspace.id);
  if (existing) {
    return Response.json({ ok: true, id: existing.id, reused: true, number: existing });
  }

  const label = readString(body, "label").trim() || `${workspace.name} reception`;
  const created = await createTelephonyNumber(agency.id, workspace.id, label);

  return Response.json({
    ok: true,
    id: created.id,
    number: created,
    reused: false,
  });
}
