import { createHash } from 'node:crypto';
import { withUser, jsonb } from '@/lib/db/client';
import { brainKnowledgeItems, type BrainCompilation } from '@/lib/ai/brain';

export interface BrainSourceRow {
  id: string;
  kind: 'website' | 'notes' | 'file';
  title: string;
  location: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

export interface BrainBundleRow {
  id: string;
  tenant_id: string;
  status: 'draft' | 'approved' | 'rejected';
  compiler_model: string;
  source_ids: string[];
  summary: string;
  payload: unknown;
  warnings: string[];
  error: string | null;
  created_at: string;
  approved_at: string | null;
  sources: BrainSourceRow[];
}

const PRIORITY: Record<string, number> = {
  guardrail: 95,
  escalation: 92,
  profile: 90,
  pricing: 85,
  policy: 80,
  tone: 75,
  service: 70,
  qualification: 65,
  faq: 60,
};

function parsedJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function saveBrainDraft(
  userId: string,
  tenantId: string,
  sources: Array<{
    kind: 'website' | 'notes' | 'file';
    title: string;
    location: string | null;
    rawText: string;
  }>,
  compilation: BrainCompilation,
): Promise<{ bundleId: string; sourceCount: number }> {
  return withUser(userId, async (tx) => {
    const sourceIds: string[] = [];
    for (const source of sources) {
      const hash = createHash('sha256').update(source.rawText).digest('hex');
      const rows = await tx`
        insert into knowledge_sources
          (tenant_id, kind, title, location, raw_text, content_hash, status, created_by)
        values (
          ${tenantId}, ${source.kind}, ${source.title.slice(0, 255)},
          ${source.location}, ${source.rawText}, ${hash}, 'ready', ${userId}
        )
        returning id
      `;
      sourceIds.push(rows[0].id as string);
    }

    const arrayLiteral = `{${sourceIds.join(',')}}`;
    const rows = await tx`
      insert into knowledge_bundles
        (tenant_id, compiler_model, source_ids, summary, payload, warnings, created_by)
      values (
        ${tenantId}, ${compilation.model}, ${arrayLiteral}::uuid[],
        ${compilation.payload.business_summary},
        ${jsonb(compilation.payload)},
        ${jsonb(compilation.warnings)},
        ${userId}
      )
      returning id
    `;
    return { bundleId: rows[0].id as string, sourceCount: sourceIds.length };
  });
}


export async function getLatestBrainBundle(
  userId: string,
  tenantId: string,
): Promise<BrainBundleRow | null> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, tenant_id, status, compiler_model, source_ids, summary, payload,
             warnings, error, created_at, approved_at
      from knowledge_bundles
      where tenant_id = ${tenantId}
      order by created_at desc
      limit 1
    `;
    if (!rows[0]) return null;
    const sourceIds = (rows[0].source_ids as string[]) ?? [];
    const sources = sourceIds.length
      ? await tx`
          select id, kind, title, location, status, error, created_at
          from knowledge_sources
          where tenant_id = ${tenantId}
            and id = any(${`{${sourceIds.join(',')}}`}::uuid[])
          order by created_at
        `
      : [];
    return {
      ...(rows[0] as unknown as BrainBundleRow),
      payload: parsedJson(rows[0].payload, {}),
      warnings: parsedJson<string[]>(rows[0].warnings, []),
      sources: sources as unknown as BrainSourceRow[],
    };
  });
}

export async function approveBrainDraft(
  userId: string,
  tenantId: string,
  bundleId: string,
): Promise<{ itemCount: number }> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, status, compiler_model, source_ids, payload
      from knowledge_bundles
      where id = ${bundleId} and tenant_id = ${tenantId}
      for update
    `;
    const bundle = rows[0];
    if (!bundle) throw new Error('Draft not found.');
    if (bundle.status !== 'draft') throw new Error('This bundle is not a draft.');
    if (bundle.compiler_model === 'fallback') {
      throw new Error('This draft was produced without AI and cannot be approved.');
    }

    const payload = parsedJson<Parameters<typeof brainKnowledgeItems>[0] | null>(
      bundle.payload,
      null,
    );
    if (!payload) throw new Error('The draft payload is invalid.');
    const items = brainKnowledgeItems(payload);
    if (items.length === 0) throw new Error('There is nothing to approve.');

    const sourceRows = await tx`
      select title, location from knowledge_sources
      where tenant_id = ${tenantId}
        and id = any(${`{${(bundle.source_ids as string[]).join(',')}}`}::uuid[])
      order by created_at limit 1
    `;
    const sourceLabel = sourceRows[0]?.location
      ? String(sourceRows[0].location)
      : sourceRows[0]?.title
        ? String(sourceRows[0].title)
        : 'AI Brain';

    await tx`
      update knowledge_items
         set is_active = false, updated_at = now()
       where tenant_id = ${tenantId} and bundle_id is not null
    `;

    const sourceId = (bundle.source_ids as string[])[0] ?? null;
    for (const item of items) {
      await tx`
        insert into knowledge_items
          (tenant_id, category, title, content, priority, is_active, updated_by,
           source_id, bundle_id, source_label)
        values (
          ${tenantId}, ${item.category}, ${item.title}, ${item.content},
          ${PRIORITY[item.category] ?? 50}, true, 'ai-brain',
          ${sourceId}, ${bundleId}, ${sourceLabel}
        )
      `;
    }

    await tx`
      update knowledge_bundles
         set status = 'approved', approved_by = ${userId}, approved_at = now(),
             updated_at = now()
       where id = ${bundleId} and tenant_id = ${tenantId}
    `;

    if (payload.escalation_triggers.length > 0) {
      await tx`
        update tenant_agent_config
           set escalation_policy = jsonb_set(
                 escalation_policy,
                 '{emergency_keywords}',
                 coalesce(escalation_policy->'emergency_keywords', '[]'::jsonb)
                   || to_jsonb(${payload.escalation_triggers}::text[]),
                 true
               ),
               updated_by = ${userId}
         where tenant_id = ${tenantId}
      `;
    }

    return { itemCount: items.length };
  });
}

export async function rejectBrainDraft(
  userId: string,
  tenantId: string,
  bundleId: string,
): Promise<void> {
  await withUser(userId, async (tx) => {
    await tx`
      update knowledge_bundles
         set status = 'rejected', updated_at = now()
       where id = ${bundleId} and tenant_id = ${tenantId} and status = 'draft'
    `;
  });
}
