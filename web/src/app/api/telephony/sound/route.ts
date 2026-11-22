import { buildSoundProfile, getAgencyWorkspace, getWorkspaceById, getWorkspaceBySlug } from "@/lib/data";
import { jsonError, readJson, readNumber, readString } from "@/lib/api-utils";
import { apiSession } from "@/lib/auth/guard";
import type { PersonaVoiceModel, SoundProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

const VOICE_MODELS: Record<PersonaVoiceModel, { label: string; model: string; engine: string; latencyMs: number }> = {
  "azure-christel": { label: "Azure Christel", model: "da-DK-ChristelNeural", engine: "Azure Christel Neural", latencyMs: 168 },
  "azure-jeppe": { label: "Azure Jeppe", model: "da-DK-JeppeNeural", engine: "Azure Christel Neural", latencyMs: 172 },
  "elevenlabs-turbo-da": { label: "ElevenLabs Turbo v2.5 DA", model: "eleven_turbo_v2_5", engine: "ElevenLabs Custom", latencyMs: 214 },
  "azure-sofie": { label: "Azure Sofie", model: "da-DK-SofieNeural", engine: "Azure Christel Neural", latencyMs: 165 },
};

const EQ_PROFILES: Record<string, { lowShelf: string; mid: string; highShelf: string; notes: string }> = {
  "warm-mid": { lowShelf: "+2.5dB @ 120Hz", mid: "+1.2dB @ 1.2kHz", highShelf: "-4.5dB above 6kHz", notes: "Warm Danish mid-range, tames tinny mobile speakers" },
  flat: { lowShelf: "0dB", mid: "0dB", highShelf: "0dB", notes: "Neutral reference — use for wired desk phones" },
  presence: { lowShelf: "-1.0dB @ 120Hz", mid: "+2.4dB @ 2.4kHz", highShelf: "0dB above 6kHz", notes: "Adds clarity for noisy car Bluetooth" },
};

export async function GET(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError("Unauthorized", 401);

  const slug = new URL(request.url).searchParams.get("workspace") ?? "";
  let workspace = null;

  if (slug) {
    workspace = await getWorkspaceBySlug(slug);
    if (!session.isAgency) {
      if (!workspace || !session.tenantIds.includes(workspace.id)) {
        return jsonError("Forbidden: caller session lacks authority for requested workspace", 403);
      }
    } else if (!workspace) {
      return jsonError("Workspace not found", 404);
    }
  } else {
    if (!session.isAgency) {
      const tenantId = session.tenantIds[0];
      if (!tenantId) {
        return jsonError("Forbidden: client session has no assigned workspace", 403);
      }
      workspace = await getWorkspaceById(tenantId);
    } else {
      workspace = await getAgencyWorkspace();
    }
    if (!workspace) return jsonError("Workspace not found", 404);
  }

  return Response.json({
    profile: buildSoundProfile(workspace),
    voiceModels: Object.entries(VOICE_MODELS).map(([key, value]) => ({ key, ...value })),
    eqProfiles: Object.entries(EQ_PROFILES).map(([key, value]) => ({ key, ...value })),
  });
}

export async function PUT(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError("Unauthorized", 401);

  const body = await readJson(request);
  const slug = readString(body, "workspaceSlug").trim();
  let workspace = null;

  if (slug) {
    workspace = await getWorkspaceBySlug(slug);
    if (!session.isAgency) {
      if (!workspace || !session.tenantIds.includes(workspace.id)) {
        return jsonError("Forbidden: caller session lacks authority for requested workspace", 403);
      }
    } else if (!workspace) {
      return jsonError("Workspace not found", 404);
    }
  } else {
    if (!session.isAgency) {
      const tenantId = session.tenantIds[0];
      if (!tenantId) {
        return jsonError("Forbidden: client session has no assigned workspace", 403);
      }
      workspace = await getWorkspaceById(tenantId);
    } else {
      workspace = await getAgencyWorkspace();
    }
    if (!workspace) return jsonError("Workspace not found", 404);
  }

  const voiceModel = readString(body, "voiceModel") as PersonaVoiceModel;
  const speed = readNumber(body, "speechRate", 1);
  const vad = readNumber(body, "vadThreshold", 65);
  const bargeIn = readNumber(body, "bargeInSensitivity", 85);
  const gain = readNumber(body, "gainDb", -2.0);
  const eqKey = readString(body, "telephonyEq", "warm-mid");
  const comfort = typeof body.comfortNoise === "boolean" ? body.comfortNoise : true;

  const validVoiceModel = voiceModel in VOICE_MODELS ? voiceModel : "azure-christel";
  const eq = EQ_PROFILES[eqKey] ?? EQ_PROFILES["warm-mid"];

  const updatedProfile: SoundProfile = {
    voiceModel: validVoiceModel,
    telephonyEq: eqKey in EQ_PROFILES ? eqKey : "warm-mid",
    speechRate: Math.min(1.05, Math.max(0.95, speed)),
    vadThreshold: Math.min(90, Math.max(10, vad)),
    bargeInSensitivity: Math.min(100, Math.max(0, bargeIn)),
    gainDb: Math.min(6, Math.max(-12, gain)),
    comfortNoise: comfort,
    fillersDa: typeof body.fillersDa === "boolean" ? body.fillersDa : true,
  };

  return Response.json({
    ok: true,
    profile: updatedProfile,
    eq,
    voiceModel: VOICE_MODELS[validVoiceModel],
  });
}
