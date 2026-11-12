import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, History, ShieldCheck } from 'lucide-react';
import { requireAgency } from '@/lib/auth/guard';
import { getTenantFacts, getTenantOverview, getAgentConfig, listKnowledge, listConfigHistory, listContacts } from '@/lib/db/queries';
import { getLatestBrainBundle } from '@/lib/db/brain';
import type { BrainPayload } from '@/lib/ai/brain';
import { Badge, Card, CardHeader, Stat, StatGroup } from '@/components/ui/core';
import { EmptyState, PageHeader, SectionTitle } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { PromptEditor } from './PromptEditor';
import { KnowledgeEditor } from './KnowledgeEditor';
import { AiBrainPanel } from './AiBrainPanel';
import { restoreAgentConfigForm } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workspace' };

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']] as const;
const dkk = (value: number) => value.toLocaleString('da-DK', { maximumFractionDigits: 0 });

export default async function AgencyClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAgency();
  const [tenant, overview, config, knowledge, history, contacts, brain] = await Promise.all([
    getTenantFacts(session.userId, id), getTenantOverview(session.userId, id), getAgentConfig(session.userId, id),
    listKnowledge(session.userId, id), listConfigHistory(session.userId, id), listContacts(session.userId, id, 1),
    getLatestBrainBundle(session.userId, id),
  ]);
  if (!tenant) notFound();
  const isDanish = tenant.default_language === 'da-DK';

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Client workspace" title={tenant.name} description={`/${tenant.slug} · ${isDanish ? 'Danish' : 'English'} reception`} actions={<><Badge tone="neutral">{tenant.default_language}</Badge><Link href="/agency/clients" className={buttonClass('ghost', 'sm')}><ArrowLeft size={13} />All clients</Link></>} />
      <StatGroup>
        <Stat label="Callers" value={overview.contacts} hint="In this workspace" />
        <Stat label="Pipeline" value={dkk(overview.pipeline_dkk)} unit="DKK" hint="Estimated caller value" />
        <Stat label="Calls" value={overview.calls} hint="Recorded sessions" />
        <Stat label="Emergencies" value={overview.dire} tone={overview.dire > 0 ? 'danger' : 'default'} hint="Open emergency cases" />
      </StatGroup>

      <Card>
        <CardHeader title="Business facts" hint="The client maintains these details in their own portal." action={<Badge tone="success">Client editable</Badge>} />
        <div className="space-y-6 p-5">
          <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {[['Owner', tenant.owner_name], ['Phone', tenant.owner_phone], ['Email', tenant.owner_email], ['Inbound line', tenant.flynumber_did ?? 'Browser calls only']].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[12px] text-[var(--muted)]">{label}</dt><dd className="mt-1 truncate text-[13px] font-medium" title={value}>{value || '—'}</dd></div>)}
          </dl>
          <div className="grid grid-cols-1 gap-6 border-t border-[var(--line)] pt-5 lg:grid-cols-2">
            <div><h3 className="mb-3 text-[13px] font-medium">Opening hours</h3><ul className="space-y-2">{DAYS.map(([key, label]) => { const day = tenant.business_hours?.[key]; return <li key={key} className="flex items-center justify-between gap-4 text-[12px]"><span className="text-[var(--muted)]">{label}</span><span className="tabular-nums text-[var(--text-secondary)]">{!day || day.closed ? 'Closed' : `${day.open}–${day.close}`}</span></li>; })}</ul></div>
            <div><h3 className="mb-3 text-[13px] font-medium">Price list</h3>{(tenant.pricing_catalog ?? []).length === 0 ? <p className="text-[12px] text-[var(--muted)]">No services configured yet.</p> : <ul className="space-y-2">{(tenant.pricing_catalog ?? []).map((item) => <li key={item.id} className="flex items-start justify-between gap-4 text-[12px]"><span className="min-w-0 text-[var(--text-secondary)]">{item.service}</span><span className="shrink-0 tabular-nums font-medium">{dkk(item.price_dkk)} / {item.unit}</span></li>)}</ul>}</div>
          </div>
          <div className="border-t border-[var(--line)] pt-5"><h3 className="mb-2 text-[13px] font-medium">Operational notice</h3><p className="text-[13px] leading-6 text-[var(--text-secondary)]">{tenant.active_broadcast_message || <span className="text-[var(--muted)]">No active notice.</span>}</p></div>
        </div>
      </Card>

      <section>
        <SectionTitle action={<Badge tone="accent"><ShieldCheck size={12} />Agency only</Badge>}>Agent studio</SectionTitle>
        <Card className="p-5">{config ? <PromptEditor tenantId={tenant.id} tenantSlug={tenant.slug} tenantName={tenant.name} defaultLanguage={tenant.default_language} contactId={contacts[0]?.id} contactName={contacts[0]?.full_name ?? 'Caller'} initial={{ customer_system_prompt: config.customer_system_prompt, copilot_system_prompt: config.copilot_system_prompt, greeting_script: config.greeting_script, voice_id: config.voice_id }} /> : <EmptyState compact title="No agent configuration" description="This workspace does not have an agent configuration on file." />}</Card>
      </section>

      <KnowledgeEditor tenantId={tenant.id} items={knowledge.map((item) => ({ id: item.id, title: item.title, content: item.content, category: String(item.category), priority: item.priority }))} />
      <AiBrainPanel tenantId={tenant.id} bundle={brain ? { ...brain, payload: brain.payload as BrainPayload } : null} />

      <Card>
        <CardHeader title="Prompt history" hint="Saving a prompt creates a snapshot. Restore a previous version if a change misbehaves." action={<Badge tone="neutral"><History size={12} />{history.length}</Badge>} />
        {history.length === 0 ? <EmptyState compact icon={<History size={18} />} title="No previous versions yet" description="The first saved prompt change will appear here." /> : <ul className="divide-y divide-[var(--line)]">{history.map((entry) => <li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"><div className="min-w-0 flex-1 basis-64"><p className="text-[12px] tabular-nums text-[var(--muted)]">{new Date(entry.changed_at).toLocaleString(isDanish ? 'da-DK' : 'en-GB')}</p><p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">{entry.customer_system_prompt}</p></div><form action={restoreAgentConfigForm} className="shrink-0"><input type="hidden" name="tenantId" value={tenant.id} /><input type="hidden" name="historyId" value={entry.id} /><SubmitButton variant="secondary" size="sm" pendingLabel="Restoring…">Restore</SubmitButton></form></li>)}</ul>}
      </Card>
    </div>
  );
}
