'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { withUser } from '@/lib/db/client';

export async function resolveEscalationAction(formData: FormData): Promise<void> {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  const escalationId = String(formData.get('escalationId') || '');
  if (!tenantId || !escalationId) return;

  await withUser(session.userId, async (tx) => {
    await tx`
      update conversation_escalations
         set status = 'resolved', resolved_at = now(), updated_at = now()
       where id = ${escalationId} and tenant_id = ${tenantId}
    `;
  });
  revalidatePath('/portal');
}
