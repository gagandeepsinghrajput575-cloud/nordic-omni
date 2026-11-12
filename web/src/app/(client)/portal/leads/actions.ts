'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { clientScope } from '@/lib/actions/scope';
import {
  createContact,
  updateContact,
  DuplicateError,
} from '@/lib/db/mutations';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import type { ActionState } from '@/lib/actions/types';

/**
 * Caller mutations for the client workspace.
 *
 * This is the code path that did not exist before: there was no way to create a
 * caller anywhere in the application. Every write below lands through
 * `withUser()`, so RLS — not TypeScript — is what stops a client writing into
 * another tenant.
 */

/**
 * Mirrors the `pipeline_stage` enum in Postgres EXACTLY:
 *   new_lead, contacted, qualified, booked, dire_escalated, closed_won, closed_lost
 *
 * An earlier version of this file invented `contact_made`, `quote_sent` and
 * `completed`. Those do not exist in the enum, so choosing one raised
 * `invalid input value for enum pipeline_stage` on write.
 */
const STAGES = [
  'new_lead',
  'contacted',
  'qualified',
  'booked',
  'dire_escalated',
  'closed_won',
  'closed_lost',
] as const;

const stageEnum = z.enum(STAGES);

const callerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the caller’s name.').max(120),
  phoneNumber: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+0-9 ()-]*$/, 'Only digits, spaces, + and ( ) are allowed.')
    .optional()
    .default(''),
  email: z
    .union([z.string().trim().email('Enter a valid email address.'), z.literal('')])
    .optional()
    .default(''),
  preferredLanguage: z.enum(['da', 'en']).default('da'),
  pipelineStage: stageEnum.default('new_lead'),
  leadScore: z.coerce.number().int().min(0).max(100).default(50),
  estimatedValueDkk: z.coerce.number().min(0).max(100_000_000).default(0),
  summary: z.string().trim().max(2000).optional().default(''),
});

export async function createCallerAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { session, tenantId } = await clientScope();

  const parsed = callerSchema.safeParse({
    fullName: formData.get('fullName'),
    phoneNumber: formData.get('phoneNumber') ?? '',
    email: formData.get('email') ?? '',
    preferredLanguage: formData.get('preferredLanguage') ?? 'da',
    pipelineStage: formData.get('pipelineStage') ?? 'new_lead',
    leadScore: formData.get('leadScore') ?? 50,
    estimatedValueDkk: formData.get('estimatedValueDkk') ?? 0,
    summary: formData.get('summary') ?? '',
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? '') };
  }

  const v = parsed.data;

  // A caller must be reachable somehow, otherwise the agent has nothing to call.
  if (!v.phoneNumber && !v.email) {
    return {
      ok: false,
      field: 'phoneNumber',
      error: 'Add a phone number or an email address so the caller can be reached.',
    };
  }

  let id: string;
  try {
    const created = await createContact(session.userId, tenantId, {
      fullName: v.fullName,
      phoneNumber: v.phoneNumber || null,
      email: v.email || null,
      preferredLanguage: v.preferredLanguage,
      preferredChannel: v.phoneNumber ? 'voice_instant_webrtc' : 'web_chat',
      pipelineStage: v.pipelineStage,
      leadScore: v.leadScore,
      estimatedValueDkk: v.estimatedValueDkk,
      sharedMemorySummary: v.summary,
    });
    id = created.id;
  } catch (e) {
    if (e instanceof DuplicateError) {
      const uiField = e.field === 'phone_number' ? 'phoneNumber' : e.field;
      return {
        ok: false,
        field: uiField,
        error:
          uiField === 'phoneNumber'
            ? 'A caller with that phone number already exists in this workspace.'
            : 'A caller with that email already exists in this workspace.',
      };
    }
    return { ok: false, error: 'Could not create the caller. Please try again.' };
  }

  void dispatchWebhookEvent(tenantId, 'lead.created', {
    contactId: id,
    fullName: v.fullName,
    phoneNumber: v.phoneNumber || null,
    email: v.email || null,
    pipelineStage: v.pipelineStage,
  });

  revalidatePath('/portal');
  revalidatePath('/portal/leads');
  redirect(`/portal/leads/${id}`);
}

/** Move stage, adjust score/value, edit the memory note, or suspend the AI. */
export async function updateCallerAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { session, tenantId } = await clientScope();
  const contactId = String(formData.get('contactId') ?? '');
  if (!contactId) return { ok: false, error: 'Missing caller.' };

  const stage = formData.get('pipelineStage');
  const score = formData.get('leadScore');
  const value = formData.get('estimatedValueDkk');
  const autoReplyValues = formData.getAll('aiAutoReplyEnabled').map(String);
  const summary = formData.get('summary');

  const patch: Parameters<typeof updateContact>[2] = {};
  if (typeof stage === 'string' && stageEnum.safeParse(stage).success) {
    patch.pipelineStage = stage;
  }
  if (typeof score === 'string' && score !== '') patch.leadScore = Number(score);
  if (typeof value === 'string' && value !== '') patch.estimatedValueDkk = Number(value);
  if (typeof summary === 'string') patch.sharedMemorySummary = summary;
  if (autoReplyValues.length > 0) {
    patch.aiAutoReplyEnabled = autoReplyValues.includes('on') || autoReplyValues.includes('true');
  }

  const affected = await updateContact(session.userId, contactId, patch);
  if (affected === 0) return { ok: false, error: 'That caller could not be updated.' };

  if (patch.pipelineStage) {
    void dispatchWebhookEvent(tenantId, 'pipeline.stage_changed', {
      contactId,
      pipelineStage: patch.pipelineStage,
    });
  }

  revalidatePath(`/portal/leads/${contactId}`);
  revalidatePath('/portal/leads');
  revalidatePath('/portal');
  return { ok: true, message: 'Saved.' };
}

/**
 * Archiving a caller.
 *
 * There is deliberately no delete here: `contacts_delete` in Postgres is
 * `USING (is_agency())`, so a client's DELETE affects 0 rows. Rather than ship a
 * button that silently does nothing, the client archives by moving the stage —
 * which `contacts_update` does permit — and only the agency can hard-delete.
 */
export async function closeCallerAction(formData: FormData): Promise<void> {
  const { session, tenantId } = await clientScope();
  const contactId = String(formData.get('contactId') ?? '');
  if (!contactId) return;

  await updateContact(session.userId, contactId, { pipelineStage: 'closed_lost' });

  void dispatchWebhookEvent(tenantId, 'pipeline.stage_changed', {
    contactId,
    pipelineStage: 'closed_lost',
  });

  revalidatePath(`/portal/leads/${contactId}`);
  revalidatePath('/portal/leads');
  revalidatePath('/portal');
}


