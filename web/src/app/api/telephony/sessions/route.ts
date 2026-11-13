import { getAgencyWorkspace, getSipSessions, getTelephonyHealth, updateSipSession } from "@/lib/data";
import { jsonError, readJson, readString } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const agency = await getAgencyWorkspace();
  const limitParam = Number(new URL(request.url).searchParams.get("limit") ?? "12");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, Math.round(limitParam))) : 12;
  const [sessions, health] = await Promise.all([getSipSessions(agency.id, limit), getTelephonyHealth(agency.id)]);
  return Response.json({ sessions, health, generatedAt: new Date().toISOString() });
}

export async function PUT(request: Request): Promise<Response> {
  const agency = await getAgencyWorkspace();
  const body = await readJson(request);
  const id = readString(body, "id").trim();
  const state = readString(body, "state", "completed");
  if (!id) return jsonError("Session id is required");
  if (!["ringing", "connected", "completed", "failed", "missed"].includes(state)) {
    return jsonError("state must be ringing, connected, completed, failed or missed");
  }

  const updated = await updateSipSession(agency.id, id, state);
  if (!updated) return jsonError("Session not found", 404);

  const sessions = await getSipSessions(agency.id, 12);
  return Response.json({ ok: true, session: updated, sessions });
}
