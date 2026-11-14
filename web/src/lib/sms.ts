import {
  type SmsDispatchRecord,
  type SmsSummaryMetrics,
} from "@/contracts/schemas";

// In-memory ring buffer for ephemeral telemetry & arena evaluations
export const SMS_STORE: SmsDispatchRecord[] = [
  {
    id: "sms-seed-1",
    recipient: "+4527441802",
    messageType: "customer_followup",
    body: "Tak for dit opkald til Murermester & Byg ApS. Freja har noteret dine ønsker til badeværelsesrenovering på 18 m². Vi vender hurtigst muligt tilbage med et prisoverslag.",
    callLogId: "call-log-101",
    contactId: "contact-101",
    workspaceId: "ws-seed-1",
    workspaceName: "Murermester & Byg ApS",
    status: "delivered",
    carrier: "FlyNumber SMS Trunk",
    segments: 2,
    deliveryLatencyMs: 340,
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
  },
  {
    id: "sms-seed-2",
    recipient: "+4533120000",
    messageType: "lead_alert",
    body: "Nyt lead fra +4527441802 (Jens Hansen). Projekt: Tagrenovering 120 m². Estimeret værdi: 145.000 DKK. Se fuld transskription i portalen.",
    callLogId: "call-log-102",
    contactId: "contact-102",
    workspaceId: "ws-seed-1",
    workspaceName: "Murermester & Byg ApS",
    status: "delivered",
    carrier: "FlyNumber SMS Trunk",
    segments: 1,
    deliveryLatencyMs: 290,
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
];

// GSM 03.38 7-bit character set validation (includes Danish æ, ø, å)
const GSM_BASIC_REGEX = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/;

export function calculateSmsSegments(text: string): number {
  if (!text) return 1;
  const isGsm = GSM_BASIC_REGEX.test(text);
  if (isGsm) {
    return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
  }
  // UCS-2 fallback for emojis or special unicode
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
}

export function sanitizeDanishPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, "");
  if (cleaned.startsWith("+45")) return cleaned;
  if (cleaned.startsWith("0045")) return "+" + cleaned.slice(2);
  if (/^\d{8}$/.test(cleaned)) return `+45${cleaned}`;
  return cleaned;
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function computeSmsMetrics(records: SmsDispatchRecord[]): SmsSummaryMetrics {
  const total = records.length;
  if (total === 0) {
    return {
      totalSent24h: 0,
      deliveredCount: 0,
      failedCount: 0,
      deliveryRatePct: 100,
      avgLatencyMs: 320,
      carrierStatus: "healthy",
    };
  }
  const delivered = records.filter((r) => r.status === "delivered").length;
  const failed = records.filter((r) => r.status === "failed").length;
  const sumLatency = records.reduce((acc, r) => acc + r.deliveryLatencyMs, 0);

  return {
    totalSent24h: total,
    deliveredCount: delivered,
    failedCount: failed,
    deliveryRatePct: Math.round((delivered / total) * 100),
    avgLatencyMs: Math.round(sumLatency / total),
    carrierStatus: failed / total > 0.1 ? "degraded" : "healthy",
  };
}
