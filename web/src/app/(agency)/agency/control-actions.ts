'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { agencyScope } from '@/lib/actions/scope';
import { assertPublicUrl } from '@/lib/ai/website';
import { manageMember, provisionMember, saveWebhook, setWorkspaceControls, webhookAction } from '@/lib/db/agency';
import { updateTenantFacts } from '@/lib/db/mutations';
import { getTenantFacts } from '@/lib/db/queries';
import type { CatalogItem } from '@/lib/estimation';
import { testWebhook } from '@/lib/webhooks/dispatcher';
import { WEBHOOK_EVENTS, newWebhookSecret } from '@/lib/webhooks/protocol';
import type { ActionState } from '@/lib/actions/types';

const idSchema = z.string().uuid();
function refresh(tenantId?: string | null) {
  revalidatePath('/agency');
  revalidatePath('/agency/clients');
  revalidatePath('/agency/webhooks');
  if (tenantId) revalidatePath(`/agency/clients/${tenantId}`);
}
function failure(error: unknown): ActionState {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('EMAIL_EXISTS')) return { ok: false, field: 'email', error: 'That email already has an account.' };
  const safe = new Set([
    'Workspace not found.', 'Endpoint not found.', 'Unknown event type.',
    'Account not found in this workspace.', 'Account is not available in this workspace',
    'Agency access required', 'Invalid membership role', 'Workspace not found',
    'Only http and https websites can be imported.', 'Website URLs cannot contain credentials.',
    'Local and private addresses are not allowed.', 'The website hostname did not resolve.',
  ]);
  if (safe.has(message)) return { ok: false, error: message };
  if (error instanceof Error && /^fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(message)) return { ok: false, error: 'The endpoint hostname could not be reached. Check its public DNS and HTTPS configuration.' };
  return { ok: false, error: 'The change could not be saved. Check the values and try again.' };
}

export async function workspaceControlsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session } = await agencyScope();
  const parsed = z.object({
    tenantId: idSchema, status: z.enum(['active', 'paused', 'suspended']),
    receptionMode: z.enum(['voice_ai', 'human_forward', 'hybrid']),
    did: z.string().trim().max(40).transform((v) => v.replace(/[^0-9+]/g, '') || null)
      .refine((v) => !v || /^\+[1-9]\d{6,14}$/.test(v), 'Use an international DID such as +4532123456.'),
  }).safeParse({ tenantId: formData.get('tenantId'), status: formData.get('status'), receptionMode: formData.get('receptionMode'), did: formData.get('did') || '' });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  try {
    await setWorkspaceControls(session.userId, parsed.data.tenantId, parsed.data.status, parsed.data.receptionMode, parsed.data.did);
    refresh(parsed.data.tenantId);
    return { ok: true, message: 'Workspace controls saved. Non-active workspaces cannot accept calls or client sign-ins.' };
  } catch (error) { return failure(error); }
}

export async function provisionMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session } = await agencyScope();
  const parsed = z.object({
    tenantId: idSchema, fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(320).toLowerCase(),
    password: z.string().min(12, 'Use at least 12 characters for the initial password.').max(128),
    role: z.enum(['owner', 'staff']),
  }).safeParse(Object.fromEntries(['tenantId', 'fullName', 'email', 'password', 'role'].map((key) => [key, formData.get(key)])));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0]) };
  try {
    await provisionMember(session.userId, parsed.data.tenantId, parsed.data);
    refresh(parsed.data.tenantId);
    return { ok: true, message: 'Login provisioned. Share the initial password securely; it must be changed at sign-in.' };
  } catch (error) { return failure(error); }
}

export async function memberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session } = await agencyScope();
  const tenantId = String(formData.get('tenantId') || '');
  const memberId = String(formData.get('memberId') || '');
  const action = String(formData.get('action') || '');
  if (!idSchema.safeParse(tenantId).success || !idSchema.safeParse(memberId).success || !['suspend', 'reactivate', 'reset', 'role'].includes(action)) return { ok: false, error: 'Invalid account request.' };
  const password = String(formData.get('password') || '');
  const role = String(formData.get('role') || 'staff');
  if (action === 'reset' && (password.length < 12 || password.length > 128)) return { ok: false, error: 'Use a temporary password of 12–128 characters.' };
  if (action === 'role' && !['owner', 'staff'].includes(role)) return { ok: false, error: 'Invalid role.' };
  try {
    await manageMember(session.userId, tenantId, memberId, action as 'suspend' | 'reactivate' | 'reset' | 'role', password, role);
    refresh(tenantId);
    return { ok: true, message: action === 'reset' ? 'Password reset. Existing sessions revoked; a new password is required at sign-in.' : 'Account access updated. Existing sessions revoked.' };
  } catch (error) { return failure(error); }
}

export async function saveWebhookAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session } = await agencyScope();
  const id = String(formData.get('id') || '');
  const tenantId = String(formData.get('tenantId') || '');
  const name = String(formData.get('name') || '').trim();
  const url = String(formData.get('url') || '').trim();
  const secret = String(formData.get('secret') || '').trim();
  const events = formData.getAll('events').map(String);
  if ((id && !idSchema.safeParse(id).success) || (tenantId && !idSchema.safeParse(tenantId).success)) return { ok: false, error: 'Invalid webhook scope.' };
  if (name.length < 2 || name.length > 120 || url.length > 2000 || (secret && secret.length < 32)) return { ok: false, error: 'Enter a name, HTTPS URL and optional signing secret of at least 32 characters.' };
  if (!events.length || events.some((event) => !WEBHOOK_EVENTS.includes(event as typeof WEBHOOK_EVENTS[number]))) return { ok: false, error: 'Select at least one supported event.' };
  try {
    const parsed = await assertPublicUrl(url);
    if (parsed.protocol !== 'https:') return { ok: false, error: 'Webhook endpoints must use HTTPS.' };
    const createdSecret = !id && !secret ? newWebhookSecret() : undefined;
    await saveWebhook(session.userId, { id: id || undefined, tenantId: tenantId || null, name, url: parsed.toString(), events, enabled: formData.get('enabled') === 'on', secret: secret || createdSecret });
    refresh(tenantId);
    return { ok: true, message: createdSecret ? `Endpoint saved. Signing secret (shown once): ${createdSecret}. Use Send test to verify the receiver.` : 'Endpoint saved. Use Send test to verify the receiver.' };
  } catch (error) { return failure(error); }
}

export async function webhookControlAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session } = await agencyScope();
  const id = String(formData.get('id') || '');
  const action = String(formData.get('action') || '');
  if (!idSchema.safeParse(id).success || !['delete', 'toggle', 'retry', 'secret', 'test'].includes(action)) return { ok: false, error: 'Invalid webhook request.' };
  try {
    if (action === 'test') {
      const result = await testWebhook(session.userId, id);
      return result.ok ? { ok: true, message: `Test delivered · HTTP ${result.status}.` } : { ok: false, error: result.error || 'Test failed.' };
    }
    const secret = await webhookAction(session.userId, id, action as 'delete' | 'toggle' | 'retry' | 'secret');
    refresh(String(formData.get('tenantId') || '') || null);
    return { ok: true, message: secret ? `New signing secret (shown once): ${secret}` : action === 'retry' ? 'Failed deliveries queued for retry.' : 'Endpoint updated.' };
  } catch (error) { return failure(error); }
}

const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export async function agencyFactsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session } = await agencyScope();
  const tenantId = String(formData.get('tenantId') || '');
  if (!idSchema.safeParse(tenantId).success) return { ok: false, error: 'Invalid workspace.' };
  const section = formData.get('section');
  try {
    if (section === 'hours') {
      const hours: Record<string, { open: string; close: string; closed: boolean }> = {};
      for (const day of days) {
        const open = String(formData.get(`${day}_open`) || '08:00');
        const close = String(formData.get(`${day}_close`) || '16:00');
        const closed = formData.get(`${day}_closed`) === 'on';
        if (!closed && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close) || open >= close)) return { ok: false, error: `${day}: use valid times with closing after opening.` };
        hours[day] = { open, close, closed };
      }
      await updateTenantFacts(session.userId, tenantId, { businessHours: hours });
    } else if (section === 'pricing') {
      const existing = await getTenantFacts(session.userId, tenantId);
      if (!existing) return { ok: false, error: 'Workspace not found.' };
      const catalog: CatalogItem[] = [];
      for (let i = 0; i < 40; i++) {
        const service = String(formData.get(`service_${i}`) || '').trim();
        if (!service) continue;
        const price = Number(formData.get(`price_${i}`));
        if (!Number.isFinite(price) || price < 0) return { ok: false, error: `${service}: enter a non-negative price.` };
        const previous = (existing.pricing_catalog as CatalogItem[]).find((item) => item.service === service);
        catalog.push({ ...previous, id: previous?.id || service.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), service, price_dkk: price, unit: String(formData.get(`unit_${i}`) || 'fixed') });
      }
      await updateTenantFacts(session.userId, tenantId, { pricingCatalog: catalog });
    } else return { ok: false, error: 'Unknown settings section.' };
    refresh(tenantId);
    return { ok: true, message: 'Saved. The receptionist uses these facts on the next conversation.' };
  } catch (error) { return failure(error); }
}
