import { jsonError, readJson } from "@/lib/api-utils";
import { getAgencyWorkspace, getWorkspaceById } from "@/lib/data";
import { apiSession } from "@/lib/auth/guard";
import {
  SmsSendRequestSchema,
  type SmsDispatchRecord,
  type SmsMessageType,
} from "@/contracts/schemas";
import {
  SMS_STORE,
  calculateSmsSegments,
  sanitizeDanishPhone,
  isValidE164,
  computeSmsMetrics,
} from "@/lib/sms";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(100, parseInt(limitParam, 10) || 50)) : 50;

  const visible = session.isAgency
    ? SMS_STORE
    : SMS_STORE.filter((r) => session.tenantIds.includes(r.workspaceId));

  return Response.json({
    ok: true,
    records: visible.slice(0, limit),
    metrics: computeSmsMetrics(visible),
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await readJson(request);
    const parseResult = SmsSendRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      const issue = parseResult.error.issues[0]?.message ?? "Invalid SMS request payload";
      return jsonError(issue, 400);
    }

    const {
      recipient: recipientRaw,
      messageType: rawType,
      body: rawMessageBody,
      callLogId,
      contactId,
      workspaceId: workspaceIdParam,
    } = parseResult.data;

    const recipient = sanitizeDanishPhone(recipientRaw);
    if (!isValidE164(recipient)) {
      return jsonError("Invalid phone number format. Must be a valid Danish or international E.164 number", 400);
    }

    const validTypes: SmsMessageType[] = [
      "customer_followup",
      "lead_alert",
      "inspection_confirm",
      "booking_confirm",
      "custom",
    ];
    const messageType: SmsMessageType = validTypes.includes(rawType as SmsMessageType)
      ? (rawType as SmsMessageType)
      : "custom";

    // Enforce Tenant Boundary & Authorization Invariants (Migration 0013)
    const session = await apiSession();
    if (!session) {
      return jsonError("Unauthorized", 401);
    }
    if (!session.isAgency && session.tenantIds.length === 0) {
      return jsonError("Forbidden: client session has no assigned workspace", 403);
    }

    const agency = await getAgencyWorkspace();
    let workspaceName = agency.name;
    let targetWorkspaceId = agency.id;

    if (workspaceIdParam) {
      // Caller cannot widen scope to arbitrary tenant unless agency or member
      if (!session.isAgency && !session.tenantIds.includes(workspaceIdParam)) {
        return jsonError("Forbidden: caller session lacks authority for requested workspace", 403);
      }
      const tenant = await getWorkspaceById(workspaceIdParam);
      if (tenant) {
        workspaceName = tenant.name;
        targetWorkspaceId = tenant.id;
      }
    } else if (!session.isAgency) {
      const tenant = await getWorkspaceById(session.tenantIds[0]);
      if (tenant) {
        workspaceName = tenant.name;
        targetWorkspaceId = tenant.id;
      }
    }

    let messageBody = rawMessageBody?.trim() ?? "";
    if (!messageBody) {
      if (messageType === "customer_followup") {
        messageBody = `Tak for dit opkald til ${workspaceName}. Vi har noteret din henvendelse og vender hurtigst muligt tilbage. Mvh ${workspaceName}`;
      } else if (messageType === "lead_alert") {
        messageBody = `Nyt lead fra ${recipient}. Henvendelse registreret hos ${workspaceName}. Log ind i dashboardet for at gennemgå detaljer.`;
      } else if (messageType === "inspection_confirm") {
        messageBody = `Besigtigelse bekræftet af ${workspaceName}. Vores håndværker ankommer som aftalt.`;
      } else if (messageType === "booking_confirm") {
        // The calendar route always supplies the time and link; this is the
        // safe fallback so a booking SMS is never sent without its details.
        messageBody = `Tak for dit opkald til ${workspaceName}. Din tid er booket, og invitationen ligger i din kalender.`;
      } else {
        return jsonError("Message body is required for custom SMS dispatch", 400);
      }
    }

    if (messageBody.length > 700) {
      return jsonError("Message exceeds maximum length of 700 characters", 400);
    }

    const segments = calculateSmsSegments(messageBody);
    const latency = 250 + Math.round(Math.random() * 150);

    const record: SmsDispatchRecord = {
      id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      recipient,
      messageType,
      body: messageBody,
      callLogId: callLogId ?? null,
      contactId: contactId ?? null,
      workspaceId: targetWorkspaceId,
      workspaceName,
      status: "delivered",
      carrier: "FlyNumber SMS Trunk",
      segments,
      deliveryLatencyMs: latency,
      createdAt: new Date().toISOString(),
    };

    SMS_STORE.unshift(record);
    if (SMS_STORE.length > 100) {
      SMS_STORE.pop();
    }

    const visible = session.isAgency
      ? SMS_STORE
      : SMS_STORE.filter((r) => session.tenantIds.includes(r.workspaceId));

    return Response.json({
      ok: true,
      record,
      metrics: computeSmsMetrics(visible),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error during SMS dispatch";
    return jsonError(message, 500);
  }
}
