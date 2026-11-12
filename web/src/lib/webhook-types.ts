export const WEBHOOK_EVENTS = [
  'lead.created',
  'call.completed',
  'estimate.recorded',
  'inspection.requested',
  'owner.escalation',
  'pipeline.stage_changed',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookRow {
  id: string;
  tenant_id: string | null;
  name: string;
  url: string;
  signing_secret: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  webhook_name?: string;
  tenant_id: string | null;
  event_type: string;
  status_code: number | null;
  success: boolean;
  error: string | null;
  created_at: string;
}
