'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAgency } from '@/lib/auth/guard';
import { withUser } from '@/lib/db/client';

/**
 * Agency-only mutation of tenant AI behaviour.
 *
 * Defence in depth, in this order:
 *   1. requireAgency()      -> application layer
 *   2. Zod parse            -> input validation
 *   3. RLS on tenant_agent_config -> only is_agency() may write (see 0001_baseline.sql)
 *
 * Before writing, the previous configuration is snapshotted into
 * agent_config_history so a bad prompt can be rolled back.
 */

const UpdateConfigSchema = z.object({
  tenantId: z.string().uuid(),
  customer_system_prompt: z.string().min(20, 'Prompt must be at least 20 characters').max(8000),
  copilot_system_prompt: z.string().min(20, 'Prompt must be at least 20 characters').max(8000),
  greeting_script: z.string().max(500).optional(),
});

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function updateAgentConfig(formData: FormData): Promise<ActionResult> {
  const session = await requireAgency();

  const parsed = UpdateConfigSchema.safeParse({
    tenantId: formData.get('tenantId'),
    customer_system_prompt: formData.get('customer_system_prompt'),
    copilot_system_prompt: formData.get('copilot_system_prompt'),
    greeting_script: formData.get('greeting_script') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const { tenantId, customer_system_prompt, copilot_system_prompt, greeting_script } = parsed.data;

  try {
    await withUser(session.userId, async (tx) => {
      // 1. Snapshot the current version.
      await tx`
        insert into agent_config_history
          (tenant_id, customer_system_prompt, copilot_system_prompt,
           greeting_script, escalation_policy, voice_id, changed_by)
        select tenant_id, customer_system_prompt, copilot_system_prompt,
               greeting_script, escalation_policy, voice_id, ${session.userId}
        from tenant_agent_config
        where tenant_id = ${tenantId}
      `;

      // 2. Apply the new version.
      const updated = await tx`
        update tenant_agent_config
           set customer_system_prompt = ${customer_system_prompt},
               copilot_system_prompt  = ${copilot_system_prompt},
               greeting_script        = ${greeting_script ?? null},
               updated_by             = ${session.userId}
         where tenant_id = ${tenantId}
        returning tenant_id
      `;

      if (updated.length === 0) {
        throw new Error('No agent config found for this tenant');
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Update failed',
    };
  }

  revalidatePath(`/agency/clients/${tenantId}`);
  return { ok: true, message: 'Agent behaviour updated. The next call uses it.' };
}

const RestoreSchema = z.object({
  tenantId: z.string().uuid(),
  historyId: z.string().uuid(),
});

export async function restoreAgentConfig(formData: FormData): Promise<ActionResult> {
  const session = await requireAgency();

  const parsed = RestoreSchema.safeParse({
    tenantId: formData.get('tenantId'),
    historyId: formData.get('historyId'),
  });
  if (!parsed.success) return { ok: false, error: 'Invalid rollback request' };

  const { tenantId, historyId } = parsed.data;

  try {
    await withUser(session.userId, async (tx) => {
      // Snapshot current before rolling back, so rollback is itself reversible.
      await tx`
        insert into agent_config_history
          (tenant_id, customer_system_prompt, copilot_system_prompt,
           greeting_script, escalation_policy, voice_id, changed_by)
        select tenant_id, customer_system_prompt, copilot_system_prompt,
               greeting_script, escalation_policy, voice_id, ${session.userId}
        from tenant_agent_config
        where tenant_id = ${tenantId}
      `;

      const restored = await tx`
        update tenant_agent_config c
           set customer_system_prompt = h.customer_system_prompt,
               copilot_system_prompt  = h.copilot_system_prompt,
               greeting_script        = h.greeting_script,
               updated_by             = ${session.userId}
          from agent_config_history h
         where h.id = ${historyId}
           and h.tenant_id = ${tenantId}
           and c.tenant_id = ${tenantId}
        returning c.tenant_id
      `;

      if (restored.length === 0) throw new Error('History entry not found');
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Rollback failed' };
  }

  revalidatePath(`/agency/clients/${tenantId}`);
  return { ok: true, message: 'Previous prompt restored.' };
}

/** Void-returning wrapper so it can be used directly as a <form action={...}>. */
export async function restoreAgentConfigForm(formData: FormData): Promise<void> {
  await restoreAgentConfig(formData);
}

