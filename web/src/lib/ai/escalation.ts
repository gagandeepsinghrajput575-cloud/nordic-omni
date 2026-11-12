import { createHmac } from 'node:crypto';
import { withPublicContact } from '@/lib/db/client';
import { env } from '@/lib/env';
import { dispatchWebhookEvent } from '@/lib/webhooks';

export type EscalationReason =
  | 'angry_customer'
  | 'high_value_emergency'
  | 'ai_unanswered_question'
  | 'human_requested';

export interface EscalationResult {
  id: string;
  delivered: boolean;
  status: 'delivered' | 'not_configured' | 'failed';
}

function signature(body: string): string | null {
  if (!env.N8N_WEBHOOK_SECRET) return null;
  return `sha256=${createHmac('sha256', env.N8N_WEBHOOK_SECRET).update(body).digest('hex')}`;
}

/**
 * Persist first, notify second. An N8N outage must never lose the owner alert or
 * make the customer think a human is already on the line.
 */
export async function recordEscalation({
  tenant,
  contact,
  channel,
  reason,
  urgency,
  briefing,
}: {
  tenant: {
    id: string;
    name: string;
    slug: string;
    owner_name: string;
    owner_phone: string;
    owner_email: string;
  };
  contact: {
    id: string;
    full_name: string | null;
    phone_number: string | null;
    email: string | null;
  };
  channel: 'web_chat' | 'voice_inbound' | 'voice_instant_webrtc';
  reason: EscalationReason;
  urgency: number;
  briefing: string;
}): Promise<EscalationResult> {
  const payload = {
    event: 'owner_escalation',
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    contact: {
      id: contact.id,
      name: contact.full_name,
      phone: contact.phone_number,
      email: contact.email,
    },
    owner: {
      name: tenant.owner_name,
      phone: tenant.owner_phone,
      email: tenant.owner_email,
    },
    channel,
    reason,
    urgency: Math.max(1, Math.min(5, Math.round(urgency))),
    briefing: briefing.slice(0, 1200),
    createdAt: new Date().toISOString(),
  };
  const body = JSON.stringify(payload);

  const id = await withPublicContact(contact.id, async (tx) => {
    const rows = await tx`
      insert into conversation_escalations (
        tenant_id, contact_id, channel, reason, urgency, briefing, payload
      ) values (
        ${tenant.id}, ${contact.id}, ${channel}, ${reason},
        ${payload.urgency}, ${payload.briefing}, ${body}::jsonb
      )
      returning id
    `;
    if (!rows[0]) throw new Error('Escalation contact is outside the tenant');
    return rows[0].id as string;
  });

  if (!env.N8N_ESCALATION_WEBHOOK_URL) {
    void dispatchWebhookEvent(tenant.id, 'owner.escalation', {
      escalationId: id,
      contact: payload.contact,
      channel,
      reason,
      urgency: payload.urgency,
      briefing: payload.briefing,
    });
    return { id, delivered: false, status: 'not_configured' };
  }

  void dispatchWebhookEvent(tenant.id, 'owner.escalation', {
    escalationId: id,
    contact: payload.contact,
    channel,
    reason,
    urgency: payload.urgency,
    briefing: payload.briefing,
  });

  try {
    const signatureValue = signature(body);
    const response = await fetch(env.N8N_ESCALATION_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signatureValue ? { 'X-OMNI-Signature': signatureValue } : {}),
      },
      body,
      signal: AbortSignal.timeout(7000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    await withPublicContact(contact.id, async (tx) => {
      await tx`
        update conversation_escalations
           set status = 'notified', n8n_status = 'delivered', n8n_error = null
         where id = ${id} and tenant_id = ${tenant.id} and contact_id = ${contact.id}
      `;
    });
    return { id, delivered: true, status: 'delivered' };
  } catch (error) {
    await withPublicContact(contact.id, async (tx) => {
      await tx`
        update conversation_escalations
           set n8n_status = 'failed',
               n8n_error = ${error instanceof Error ? error.message.slice(0, 500) : 'Webhook failed'}
         where id = ${id} and tenant_id = ${tenant.id} and contact_id = ${contact.id}
      `;
    });
    return { id, delivered: false, status: 'failed' };
  }
}
