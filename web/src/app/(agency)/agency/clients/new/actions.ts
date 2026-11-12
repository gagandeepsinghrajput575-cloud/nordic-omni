'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { agencyScope } from '@/lib/actions/scope';
import { createTenantWithAgent, DuplicateError } from '@/lib/db/mutations';
import { slugify } from '@/lib/slug';
import type { ActionState } from '@/lib/actions/types';

/**
 * Creates a workspace and its agent configuration in a single transaction.
 *
 * This replaces the deleted provisioning wizard, which returned hardcoded fiction
 * (owner always "Lars Henriksen", hours always 08:00-16:30) and inserted a fake
 * test lead into the client's CRM. This version invents nothing: if a field is
 * not supplied, it is empty, and the client fills it in from their own portal.
 */

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the business name.').max(120),
  slug: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/,
      'Use lowercase letters, digits and hyphens (3–48 characters).'
    ),
  ownerName: z.string().trim().min(2, 'Enter the owner’s name.').max(120),
  ownerPhone: z.string().trim().min(6, 'Enter a phone number the agent can escalate to.').max(40),
  ownerEmail: z.string().trim().email('Enter a valid email address.'),
  defaultLanguage: z.enum(['da-DK', 'en-US']).default('da-DK'),
  did: z.string().trim().max(40).optional().transform((value) => value?.replace(/[^0-9+]/g, '') || null)
    .refine((value) => !value || /^\+[1-9]\d{6,14}$/.test(value), 'Use an international DID, e.g. +4532123456.'),
  initialPassword: z.string().min(12, 'Use an initial password of at least 12 characters.').max(128),
});


export async function createWorkspaceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { session } = await agencyScope();

  const rawName = String(formData.get('name') ?? '').trim();
  const rawSlug = String(formData.get('slug') ?? '').trim();

  const parsed = schema.safeParse({
    name: rawName,
    slug: rawSlug || slugify(rawName),
    ownerName: formData.get('ownerName'),
    ownerPhone: formData.get('ownerPhone'),
    ownerEmail: formData.get('ownerEmail'),
    defaultLanguage: formData.get('defaultLanguage') ?? 'da-DK',
    did: formData.get('did'),
    initialPassword: formData.get('initialPassword'),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? '') };
  }

  let created: { id: string; slug: string };
  try {
    created = await createTenantWithAgent(session.userId, parsed.data);
  } catch (e) {
    if (e instanceof DuplicateError) {
      return {
        ok: false,
        field: e.field,
        error: e.field === 'phone_number' ? 'That DID is already assigned to another workspace.' : e.field === 'email' ? 'That email already has an account.' : 'That slug is already taken. Pick another one.',
      };
    }
    return { ok: false, error: 'Could not create the workspace. Please try again.' };
  }

  revalidatePath('/agency');
  revalidatePath('/agency/clients');
  redirect(`/agency/clients/${created.id}`);
}
