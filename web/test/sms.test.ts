import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SmsMessageTypeSchema,
  SmsStatusSchema,
  SmsDispatchRecordSchema,
  SmsSummaryMetricsSchema,
  SmsSendRequestSchema,
} from "../src/contracts/schemas";
import {
  SMS_STORE,
  calculateSmsSegments,
  sanitizeDanishPhone,
  isValidE164,
  computeSmsMetrics,
} from "../src/lib/sms";

test("Danish phone normalization sanitizes 8-digit and E.164 strings", () => {
  assert.equal(sanitizeDanishPhone("27441802"), "+4527441802");
  assert.equal(sanitizeDanishPhone("+45 27 44 18 02"), "+4527441802");
  assert.equal(sanitizeDanishPhone("0045 27 44 18 02"), "+4527441802");
  assert.equal(sanitizeDanishPhone("+45 (27) 44-18-02"), "+4527441802");

  assert.equal(isValidE164("+4527441802"), true);
  assert.equal(isValidE164("+14155552671"), true);
  assert.equal(isValidE164("27441802"), false);
  assert.equal(isValidE164("not-a-number"), false);
});

test("SMS segment calculation differentiates GSM 7-bit (with Danish æ, ø, å) and UCS-2 fallback", () => {
  // Danish characters within 160 chars count as 1 segment under GSM 03.38
  const danishText = "Tak for din henvendelse vedrørende tagrenovering og badeværelse. Mvh Murermester ApS.";
  assert.equal(calculateSmsSegments(danishText), 1);

  // 170-char GSM text requires 2 segments (153 chars per concatenated segment)
  const longGsmText = danishText.repeat(2);
  assert.equal(calculateSmsSegments(longGsmText), 2);

  // UCS-2 emoji forces 70-character threshold
  const emojiText = "Nyt lead klar! 🔨🏗️ Tagrenovering 120 kvm.";
  assert.equal(calculateSmsSegments(emojiText), 1);
  const longEmojiText = emojiText.repeat(3);
  assert.ok(calculateSmsSegments(longEmojiText) > 1);
});

test("SMS Zod contracts validate dispatch record, metrics, and send request shapes", () => {
  assert.equal(SmsMessageTypeSchema.parse("customer_followup"), "customer_followup");
  assert.equal(SmsMessageTypeSchema.parse("lead_alert"), "lead_alert");
  assert.equal(SmsStatusSchema.parse("delivered"), "delivered");

  const validRecord = {
    id: "sms-test-1",
    recipient: "+4527441802",
    messageType: "customer_followup",
    body: "Tak for din besked.",
    callLogId: "call-1",
    contactId: "contact-1",
    workspaceId: "ws-1",
    workspaceName: "Test Byg",
    status: "delivered",
    carrier: "FlyNumber SMS Trunk",
    segments: 1,
    deliveryLatencyMs: 310,
    createdAt: new Date().toISOString(),
  };
  const parsed = SmsDispatchRecordSchema.parse(validRecord);
  assert.equal(parsed.id, "sms-test-1");

  const validMetrics = {
    totalSent24h: 42,
    deliveredCount: 40,
    failedCount: 2,
    deliveryRatePct: 95,
    avgLatencyMs: 312,
    carrierStatus: "healthy",
  };
  assert.equal(SmsSummaryMetricsSchema.parse(validMetrics).deliveryRatePct, 95);

  const parsedReq = SmsSendRequestSchema.parse({
    recipient: "+4527441802",
    messageType: "lead_alert",
  });
  assert.equal(parsedReq.messageType, "lead_alert");

  assert.equal(
    SmsSendRequestSchema.safeParse({ recipient: "" }).success,
    false,
  );
});

test("SMS metrics computation calculates correct delivery rates and latency averages", () => {
  const metrics = computeSmsMetrics(SMS_STORE);
  assert.ok(metrics.totalSent24h >= 2);
  assert.equal(metrics.deliveredCount, 2);
  assert.equal(metrics.failedCount, 0);
  assert.equal(metrics.deliveryRatePct, 100);
  assert.equal(metrics.carrierStatus, "healthy");
});

test("SMS route enforces tenant authorization invariants and has no loose any", () => {
  const routeSource = readFileSync(
    new URL("../src/app/api/telephony/sms/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(routeSource, /export const dynamic = ["']force-dynamic["']/);
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /export async function POST/);
  assert.match(routeSource, /apiSession\(\)/);
  assert.match(routeSource, /session\.tenantIds\.includes/);
  assert.doesNotMatch(routeSource, /\bas\s+any\b|@ts-ignore|@ts-expect-error/);
});
