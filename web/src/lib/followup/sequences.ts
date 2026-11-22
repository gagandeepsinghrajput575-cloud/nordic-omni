import { withUser, jsonb } from '@/lib/db/client';
import {
  recordScheduleFollowupsAdmin,
  recordCancelPendingFollowupsAdmin,
  recordSweepPendingFollowups,
} from '@/lib/db/trusted-records';

export interface FollowupSequenceItem {
  id: string;
  tenant_id: string;
  contact_id: string;
  step: number;
  channel: string;
  scheduled_at: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ScheduleFollowupInput {
  tenantId: string;
  contactId: string;
  customerName?: string | null;
  phone?: string | null;
  projectType?: string;
  businessName?: string;
  step1DelayHours?: number; // default 3.5
  step2DelayHours?: number; // default 24
}

/**
 * Schedule automated timed follow-up sequence:
 * Step 1 (+3.5h): Gentle SMS check-in on the ballpark estimate.
 * Step 2 (+24h): Inspection booking invitation.
 */
export async function scheduleFollowupSequence(
  userId: string,
  input: ScheduleFollowupInput,
): Promise<FollowupSequenceItem[]> {
  const {
    tenantId,
    contactId,
    customerName,
    projectType = 'projektet',
    businessName = 'os',
    step1DelayHours = 3.5,
    step2DelayHours = 24,
  } = input;

  const nowMs = Date.now();
  const step1Date = new Date(nowMs + step1DelayHours * 3600 * 1000);
  const step2Date = new Date(nowMs + step2DelayHours * 3600 * 1000);

  const nameGreeting = customerName ? ` ${customerName.trim().split(' ')[0]}` : '';

  const step1Text = `Hej${nameGreeting}, tak for din henvendelse vedr. ${projectType}. Har du haft mulighed for at kigge på det vejledende overslag? Sig til, hvis vi skal booke en uforpligtende besigtigelse. Mvh ${businessName}`;
  const step2Text = `Hej${nameGreeting}, vi følger lige op fra ${businessName}. Vores mester har ledige tider til en uforpligtende besigtigelse i denne uge. Passer det dig bedst formiddag eller eftermiddag?`;

  const payload1 = {
    messageText: step1Text,
    customerName: customerName || null,
    projectType,
    businessName,
  };

  const payload2 = {
    messageText: step2Text,
    customerName: customerName || null,
    projectType,
    businessName,
  };

  return withUser(userId, async (tx) => {
    // 1. Cancel any existing pending followups for this contact so we don't double-schedule
    await tx`
      update public.followup_sequences
         set status = 'cancelled',
             payload = payload || ${jsonb({ cancellation_reason: 'rescheduled_on_new_estimate' })}::jsonb,
             updated_at = now()
       where contact_id = ${contactId}
         and status = 'pending'
    `;

    // 2. Insert Step 1 (+3.5h) and Step 2 (+24h)
    const rows = await tx`
      insert into public.followup_sequences (
        tenant_id, contact_id, step, channel, scheduled_at, status, payload
      ) values
        (${tenantId}, ${contactId}, 1, 'sms', ${step1Date.toISOString()}, 'pending', ${jsonb(payload1)}::jsonb),
        (${tenantId}, ${contactId}, 2, 'sms', ${step2Date.toISOString()}, 'pending', ${jsonb(payload2)}::jsonb)
      returning id, tenant_id, contact_id, step, channel, scheduled_at, status, payload, created_at, updated_at
    `;

    return rows as unknown as FollowupSequenceItem[];
  });
}



/**
 * Cancels all pending follow-up steps immediately when a customer:
 * - Replies with an inbound message
 * - Books an appointment / inspection
 * - Opts out / requests human takeover
 */
export async function cancelPendingFollowups(
  userId: string,
  contactId: string,
  reason: string,
): Promise<number> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      update public.followup_sequences
         set status = 'cancelled',
             payload = payload || ${jsonb({ cancellation_reason: reason, cancelled_at: new Date().toISOString() })}::jsonb,
             updated_at = now()
       where contact_id = ${contactId}
         and status = 'pending'
      returning id
    `;
    return rows.length;
  });
}

/**
 * Server/admin version for unauthenticated webhooks (incoming SMS/SIP/webhook).
 */
export async function cancelPendingFollowupsAdmin(
  tenantId: string,
  contactId: string,
  reason: string,
): Promise<number> {
  return recordCancelPendingFollowupsAdmin(tenantId, contactId, reason);
}

/**
 * Sweep pending follow-ups that have matured past scheduled_at and mark them sent.
 */
export async function sweepPendingFollowups(limit = 50): Promise<FollowupSequenceItem[]> {
  const rows = await recordSweepPendingFollowups(limit);
  return rows as unknown as FollowupSequenceItem[];
}

/**
 * List all follow-up sequence steps for a lead.
 */
export async function listContactFollowups(
  userId: string,
  contactId: string,
): Promise<FollowupSequenceItem[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, tenant_id, contact_id, step, channel, scheduled_at, status, payload, created_at, updated_at
        from public.followup_sequences
       where contact_id = ${contactId}
       order by step asc, scheduled_at asc
    `;
    return rows as unknown as FollowupSequenceItem[];
  });
}

/**
 * Server/admin version for quote generation & background jobs where session is absent.
 */
export async function scheduleFollowupSequenceAdmin(
  input: ScheduleFollowupInput,
): Promise<FollowupSequenceItem[]> {
  const {
    tenantId,
    contactId,
    customerName,
    projectType = 'projektet',
    businessName = 'os',
    step1DelayHours = 3.5,
    step2DelayHours = 24,
  } = input;

  const nowMs = Date.now();
  const step1Date = new Date(nowMs + step1DelayHours * 3600 * 1000);
  const step2Date = new Date(nowMs + step2DelayHours * 3600 * 1000);

  const nameGreeting = customerName ? ` ${customerName.trim().split(' ')[0]}` : '';

  const step1Text = `Hej${nameGreeting}, tak for din henvendelse vedr. ${projectType}. Har du haft mulighed for at kigge på det vejledende overslag? Sig til, hvis vi skal booke en uforpligtende besigtigelse. Mvh ${businessName}`;
  const step2Text = `Hej${nameGreeting}, vi følger lige op fra ${businessName}. Vores mester har ledige tider til en uforpligtende besigtigelse i denne uge. Passer det dig bedst formiddag eller eftermiddag?`;

  const payload1 = {
    messageText: step1Text,
    customerName: customerName || null,
    projectType,
    businessName,
  };

  const payload2 = {
    messageText: step2Text,
    customerName: customerName || null,
    projectType,
    businessName,
  };

  const rows = await recordScheduleFollowupsAdmin(
    tenantId,
    contactId,
    step1Date.toISOString(),
    payload1,
    step2Date.toISOString(),
    payload2,
  );

  return rows as unknown as FollowupSequenceItem[];
}
