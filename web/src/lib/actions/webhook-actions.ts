'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import {
  WEBHOOK_EVENTS,
  createWebhook,
  deleteWebhook,
  rotateWebhookSecret,
  sendTestWebhook,
  updateWebhook,
  type WebhookEvent,
} from '@/lib/webhooks';

const EventSet = new Set<string>(WEBHOOK_EVENTS);
const UuidSchema = z.string().uuid();

export interface WebhookActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  secret?: string;
}

function parseEvents(formData: FormData): WebhookEvent[] {
  const raw = formData.getAll('events').map((v) => String(v));
  const unique = Array.from(new Set(raw.filter((v) => EventSet.has(v))));
  return unique as WebhookEvent[];
}

async function authorizeScope(rawTenantId: FormDataEntryValue | null) {
  const session = await requireUser();
  const value = String(rawTenantId ?? '').trim();
  if (!value) {
    if (!session.isAgency) throw new Error('Agency privileges required.');
    return { session, tenantId: null as string | null };
  }
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid tenant identifier.');
  if (!session.isAgency && !session.tenantIds.includes(parsed.data)) {
    throw new Error('Not authorized for this workspace.');
  }
  return { session, tenantId: parsed.data };
}

function revalidateWebhookPaths(tenantId: string | null) {
  revalidatePath('/agency');
  if (tenantId) {
    revalidatePath(`/agency/clients/${tenantId}`);
    revalidatePath('/portal/settings');
  }
}

export async function createWebhookAction(formData: FormData): Promise<WebhookActionResult> {
  try {
    const { session, tenantId } = await authorizeScope(formData.get('tenantId'));
    const name = String(formData.get('name') ?? '').trim();
    const url = String(formData.get('url') ?? '').trim();
    const events = parseEvents(formData);
    if (!name) return { ok: false, error: 'Enter a webhook name.' };
    if (!url) return { ok: false, error: 'Enter a destination URL.' };
    if (events.length === 0) return { ok: false, error: 'Select at least one event.' };

    const created = await createWebhook(session.userId, { tenantId, name, url, events });
    revalidateWebhookPaths(tenantId);
    return { ok: true, message: 'Webhook created.', secret: created.signing_secret };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to create webhook.' };
  }
}

export async function updateWebhookAction(formData: FormData): Promise<WebhookActionResult> {
  try {
    const { session, tenantId } = await authorizeScope(formData.get('tenantId'));
    const webhookId = UuidSchema.parse(String(formData.get('webhookId') ?? ''));
    const name = String(formData.get('name') ?? '').trim();
    const url = String(formData.get('url') ?? '').trim();
    const events = parseEvents(formData);
    const activeValues = formData.getAll('isActive').map(String);
    const isActive = activeValues.includes('on') || activeValues.includes('true');

    if (!name) return { ok: false, error: 'Enter a webhook name.' };
    if (!url) return { ok: false, error: 'Enter a destination URL.' };
    if (events.length === 0) return { ok: false, error: 'Select at least one event.' };

    await updateWebhook(session.userId, webhookId, { name, url, events, isActive });
    revalidateWebhookPaths(tenantId);
    return { ok: true, message: 'Webhook saved.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update webhook.' };
  }
}

export async function rotateWebhookSecretAction(formData: FormData): Promise<WebhookActionResult> {
  try {
    const { session, tenantId } = await authorizeScope(formData.get('tenantId'));
    const webhookId = UuidSchema.parse(String(formData.get('webhookId') ?? ''));
    const secret = await rotateWebhookSecret(session.userId, webhookId);
    revalidateWebhookPaths(tenantId);
    return { ok: true, message: 'Signing secret rotated.', secret };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to rotate secret.' };
  }
}

export async function deleteWebhookAction(formData: FormData): Promise<WebhookActionResult> {
  try {
    const { session, tenantId } = await authorizeScope(formData.get('tenantId'));
    const webhookId = UuidSchema.parse(String(formData.get('webhookId') ?? ''));
    await deleteWebhook(session.userId, webhookId);
    revalidateWebhookPaths(tenantId);
    return { ok: true, message: 'Webhook deleted.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete webhook.' };
  }
}

export async function testWebhookAction(formData: FormData): Promise<WebhookActionResult> {
  try {
    const { session, tenantId } = await authorizeScope(formData.get('tenantId'));
    const webhookId = UuidSchema.parse(String(formData.get('webhookId') ?? ''));
    const outcome = await sendTestWebhook(session.userId, webhookId);
    revalidateWebhookPaths(tenantId);
    if (!outcome.success) {
      return {
        ok: false,
        error: `Test delivery failed (${outcome.statusCode ?? 'network'}): ${outcome.error ?? 'Unknown error'}`,
      };
    }
    return { ok: true, message: `Test delivered (HTTP ${outcome.statusCode}).` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Test failed.' };
  }
}
