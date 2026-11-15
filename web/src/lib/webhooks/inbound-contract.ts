import { z } from 'zod';

/**
 * Universal Agency Inbound Webhook contract.
 *
 * One endpoint, many actions. The payload is a discriminated union so an
 * unknown or malformed action is a validation failure, never a silent no-op:
 * a dispatcher that falls through to "return null" is how inbound webhooks
 * quietly stop working.
 *
 * Notes on Zod 4: `z.record` requires both key and value schemas, and
 * `z.literal` unions narrow correctly inside `safeParse`.
 */

export const AGENCY_ACTIONS = [
  'fetch_leads',
  'fetch_calls',
  'fetch_clients',
  'fetch_client_detail',
  'fetch_calendar_slots',
  'fetch_metrics',
  'create_lead',
  'dispatch_call',
  'send_sms',
  'book_appointment',
  'update_client',
  'ask_copilot',
] as const;

export type AgencyAction = (typeof AGENCY_ACTIONS)[number];

/** The actions that mutate state. Used for audit and for the UI warning. */
export const MUTATING_ACTIONS = new Set<AgencyAction>([
  'create_lead',
  'dispatch_call',
  'send_sms',
  'book_appointment',
  'update_client',
]);

const IsoDate = /^\d{4}-\d{2}-\d{2}$/;
const Uuid = z.string().uuid();

/** Phone numbers are normalised before use; this is a shape check only. */
const Phone = z.string().min(8).max(40);

export const InboundWebhookPayloadSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('fetch_leads'),
    tenantId: Uuid.optional(),
    status: z.string().max(40).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  z.object({
    action: z.literal('fetch_calls'),
    tenantId: Uuid.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  z.object({ action: z.literal('fetch_clients') }),
  z.object({ action: z.literal('fetch_client_detail'), tenantId: Uuid }),
  z.object({
    action: z.literal('fetch_calendar_slots'),
    tenantId: Uuid,
    date: z.string().regex(IsoDate),
  }),
  z.object({ action: z.literal('fetch_metrics'), tenantId: Uuid.optional() }),
  z.object({
    action: z.literal('create_lead'),
    tenantId: Uuid,
    name: z.string().min(1).max(255),
    phone: Phone,
    note: z.string().max(2000).optional(),
    triggerSms: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('dispatch_call'),
    tenantId: Uuid,
    phone: Phone,
    promptOverride: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal('send_sms'),
    tenantId: Uuid,
    to: Phone,
    message: z.string().min(1).max(480),
  }),
  z.object({
    action: z.literal('book_appointment'),
    tenantId: Uuid,
    slotStart: z.string().min(10).max(40),
    slotEnd: z.string().min(10).max(40),
    customerName: z.string().min(1).max(255),
    customerPhone: Phone,
  }),
  z.object({
    action: z.literal('update_client'),
    tenantId: Uuid,
    // Zod 4 requires an explicit key schema; the spec's one-argument
    // `z.record(z.any())` no longer compiles.
    businessHours: z.record(z.string(), z.unknown()).optional(),
    broadcastMessage: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('ask_copilot'),
    tenantId: Uuid,
    query: z.string().min(1).max(1000),
  }),
]);

export type InboundWebhookPayload = z.infer<typeof InboundWebhookPayloadSchema>;

// -----------------------------------------------------------------------------
// Standard response envelope
// -----------------------------------------------------------------------------

export interface GatewaySuccess<T = unknown> {
  ok: true;
  action: AgencyAction;
  deliveryId: string;
  timestamp: string;
  data: T;
}

export interface GatewayFailure {
  ok: false;
  action: AgencyAction | null;
  deliveryId: string;
  timestamp: string;
  error: string;
  /** Machine-readable reason, so a caller can branch without string matching. */
  code:
    | 'invalid_payload'
    | 'unknown_action'
    | 'unauthorized'
    | 'replay'
    | 'rate_limited'
    | 'not_found'
    | 'conflict'
    | 'upstream'
    | 'internal';
}

/** Format a validation issue list as something a caller can actually act on. */
export function describeIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
