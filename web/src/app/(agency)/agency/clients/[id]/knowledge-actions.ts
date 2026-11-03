'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { agencyScope } from '@/lib/actions/scope';
import {
  createKnowledgeItem,
  updateKnowledgeItem,
  deleteKnowledgeItem,
} from '@/lib/db/mutations';
import type { ActionState } from '@/lib/actions/types';

/**
 * Knowledge is BEHAVIOUR: it governs what the agent is willing to promise, so
 * only agency staff may write it. That is enforced by `knowledge_agency_write`
 * in Postgres, not by hiding this form — a client POSTing here affects 0 rows.
 */

const schema = z.object({
  tenantId: z.string().uuid('Missing workspace.'),
  title: z.string().trim().min(2, 'Give the rule a short title.').max(160),
  content: z.string().trim().min(5, 'Write what the agent should know.').max(4000),
  category: z.string().trim().max(60).default('general'),
  priority: z.coerce.number().int().min(0).max(100).default(50),
});

function readForm(formData: FormData) {
  return {
    tenantId: formData.get('tenantId'),
    title: formData.get('title'),
    content: formData.get('content'),
    category: formData.get('category') ?? 'general',
    priority: formData.get('priority') ?? 50,
  };
}

export async function createKnowledgeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { session } = await agencyScope();

  const parsed = schema.safeParse(readForm(formData));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? '') };
  }

  const { tenantId, ...item } = parsed.data;
  await createKnowledgeItem(session.userId, tenantId, item);

  revalidatePath(`/agency/clients/${tenantId}`);
  return { ok: true, message: 'Added. The agent uses this on the next call.' };
}

export async function updateKnowledgeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { session } = await agencyScope();
  const itemId = String(formData.get('itemId') ?? '');
  if (!itemId) return { ok: false, error: 'Missing item.' };

  const parsed = schema.safeParse(readForm(formData));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? '') };
  }

  const { tenantId, ...item } = parsed.data;
  const affected = await updateKnowledgeItem(session.userId, itemId, item);
  if (affected === 0) {
    return { ok: false, error: 'That item could not be updated.' };
  }

  revalidatePath(`/agency/clients/${tenantId}`);
  return { ok: true, message: 'Updated.' };
}

export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  const { session } = await agencyScope();
  const itemId = String(formData.get('itemId') ?? '');
  const tenantId = String(formData.get('tenantId') ?? '');
  if (itemId) await deleteKnowledgeItem(session.userId, itemId);
  if (tenantId) revalidatePath(`/agency/clients/${tenantId}`);
}
