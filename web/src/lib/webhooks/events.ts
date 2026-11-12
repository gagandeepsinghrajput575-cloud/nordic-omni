/** Browser-safe event names. Signing secrets and crypto stay in protocol.ts (Node only). */
export const WEBHOOK_EVENTS = [
  'call.started', 'call.completed', 'call.missed',
  'lead.created', 'lead.updated', 'escalation.created', 'escalation.resolved',
] as const;
export type WebhookEventType = typeof WEBHOOK_EVENTS[number];
