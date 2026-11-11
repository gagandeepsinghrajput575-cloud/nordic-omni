'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAgency } from '@/lib/auth/guard';
import { getTenantFacts } from '@/lib/db/queries';
import { approveBrainDraft, rejectBrainDraft, saveBrainDraft } from '@/lib/db/brain';
import { compileBusinessBrain, type BrainSourceInput } from '@/lib/ai/brain';
import { fetchWebsiteSources } from '@/lib/ai/website';
import type { ActionState } from '@/lib/actions/types';

const InputSchema = z.object({
  tenantId: z.string().uuid(),
  websiteUrl: z.string().trim().max(600).optional(),
  notes: z.string().trim().max(20_000).optional(),
  documentText: z.string().trim().max(20_000).optional(),
});

export async function compileBrainAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAgency();
  const parsed = InputSchema.safeParse({
    tenantId: formData.get('tenantId'),
    websiteUrl: String(formData.get('websiteUrl') || '').trim() || undefined,
    notes: String(formData.get('notes') || '').trim() || undefined,
    documentText: String(formData.get('documentText') || '').trim() || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'Invalid input.' };
  }
  const { tenantId, websiteUrl, notes, documentText } = parsed.data;
  const tenant = await getTenantFacts(session.userId, tenantId);
  if (!tenant) return { ok: false, error: 'Workspace not found.' };

  const sources: BrainSourceInput[] = [];
  const warnings: string[] = [];

  if (websiteUrl) {
    if (!/^https?:\/\//i.test(websiteUrl)) {
      return { ok: false, error: 'Website URL must start with http:// or https://.' };
    }
    try {
      const pages = await fetchWebsiteSources(websiteUrl);
      for (const page of pages) {
        sources.push({
          kind: page.kind,
          title: page.title,
          location: page.location,
          rawText: page.rawText,
        });
      }
    } catch (error) {
      warnings.push(
        `Website could not be imported: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  if (notes) {
    sources.push({
      kind: 'notes',
      title: 'Ejerens noter',
      location: null,
      rawText: notes,
    });
  }
  if (documentText) {
    sources.push({
      kind: 'file',
      title: 'Indsat dokumenttekst',
      location: null,
      rawText: documentText,
    });
  }

  if (sources.length === 0) {
    return {
      ok: false,
      error: warnings[0] || 'Add a website or paste business information first.',
    };
  }

  const compilation = await compileBusinessBrain({
    tenantName: tenant.name,
    language: tenant.default_language.startsWith('da') ? 'da' : 'en',
    sources,
  });
  if (warnings.length > 0) compilation.warnings.push(...warnings);

  await saveBrainDraft(session.userId, tenantId, sources, compilation);
  revalidatePath(`/agency/clients/${tenantId}`);
  return {
    ok: true,
    message: `Draft created from ${sources.length} source(s). Review it before approving.`,
  };
}

export async function approveBrainAction(formData: FormData): Promise<void> {
  const session = await requireAgency();
  const tenantId = String(formData.get('tenantId') || '');
  const bundleId = String(formData.get('bundleId') || '');
  if (!tenantId || !bundleId) return;
  await approveBrainDraft(session.userId, tenantId, bundleId);
  revalidatePath(`/agency/clients/${tenantId}`);
}

export async function rejectBrainAction(formData: FormData): Promise<void> {
  const session = await requireAgency();
  const tenantId = String(formData.get('tenantId') || '');
  const bundleId = String(formData.get('bundleId') || '');
  if (!tenantId || !bundleId) return;
  await rejectBrainDraft(session.userId, tenantId, bundleId);
  revalidatePath(`/agency/clients/${tenantId}`);
}
