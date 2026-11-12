import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, History, Phone, ShieldCheck } from 'lucide-react';
import { requireAgency } from '@/lib/auth/guard';
import { getTenantFacts, getTenantOverview, getAgentConfig, listKnowledge, listConfigHistory, listContacts } from '@/lib/db/queries';
import { listWebhooks, listWorkspaceMembers } from '@/lib/db/agency';
import { getLatestBrainBundle } from '@/lib/db/brain';
import type { BrainPayload } from '@/lib/ai/brain';
import { Badge, Card, CardHeader, Stat, StatGroup } from '@/components/ui/core';
import { EmptyState, PageHeader, SectionTitle } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { WorkspaceStudio } from '@/components/agency/WorkspaceStudio';
import { WorkspaceControls } from '@/components/agency/WorkspaceControls';
import { TeamManager } from '@/components/agency/TeamManager';
import { WebhookHub } from '@/components/agency/WebhookHub';
import { AgencyHoursEditor, AgencyPricingEditor } from '@/components/agency/WorkspaceFactsEditor';
import { PromptEditor } from './PromptEditor';
import { KnowledgeEditor } from './KnowledgeEditor';
import { AiBrainPanel } from './AiBrainPanel';
import { restoreAgentConfigForm } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Manage workspace' };
const dkk = (value: number) => value.toLocaleString('da-DK', { maximumFractionDigits: 0 });

export default async function AgencyClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAgency();
  const tenant = await getTenantFacts(session.userId, id);
  if (!tenant) notFound();
  const [overview, config, knowledge, history, contacts, brain, members, endpoints] = await Promise.all([
    getTenantOverview(session.userId, id), getAgentConfig(session.userId, id),
    listKnowledge(session.userId, id), listConfigHistory(session.userId, id), listContacts(session.userId, id, 1),
    getLatestBrainBundle(session.userId, id), listWorkspaceMembers(session.userId, id), listWebhooks(session.userId, id),
  ]);
  const isDanish = tenant.default_language === 'da-DK';
  const promptHistory = <Card>
    <CardHeader title="Prompt history" hint="Every save creates a reversible snapshot." action={<Badge tone="neutral"><History size={12} />{history.length}</Badge>} />
    {!history.length ? <EmptyState compact icon={<History size={18} />} title="No previous versions yet" description="The first saved prompt change will appear here." /> : <ul className="divide-y divide-[var(--line)]">{history.map((entry) => <li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"><div className="min-w-0 flex-1 basis-64"><p className="text-[12px] tabular-nums text-[var(--muted)]">{new Date(entry.changed_at).toLocaleString('en-GB', { timeZone: 'Europe/Copenhagen' })}</p><p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">{entry.customer_system_prompt}</p></div><form action={restoreAgentConfigForm}><input type="hidden" name="tenantId" value={tenant.id} /><input type="hidden" name="historyId" value={entry.id} /><SubmitButton variant="secondary" size="sm" pendingLabel="Restoring…">Restore</SubmitButton></form></li>)}</ul>}
  </Card>;

  return <div className="space-y-7">
    <PageHeader eyebrow="Client workspace" title={tenant.name} description={`/${tenant.slug} · ${isDanish ? 'Danish' : 'English'} reception · Full agency control`} actions={<><Badge tone={tenant.status === 'active' ? 'success' : 'warning'} dot>{tenant.status}</Badge><Link href="/agency/clients" className={buttonClass('ghost', 'sm')}><ArrowLeft size={13} />All clients</Link></>} />
    <StatGroup><Stat label="Callers" value={overview.contacts} hint="In this workspace" /><Stat label="Pipeline" value={dkk(overview.pipeline_dkk)} unit="DKK" hint="Estimated caller value" /><Stat label="Calls" value={overview.calls} hint="Recorded sessions" /><Stat label="Urgent escalations" value={overview.dire} tone={overview.dire > 0 ? 'danger' : 'default'} hint="Open emergency cases" /></StatGroup>
    <WorkspaceStudio panels={{
      overview: <div className="space-y-5"><WorkspaceControls tenantId={id} status={tenant.status} receptionMode={tenant.reception_mode} did={tenant.flynumber_did} /><Card><CardHeader title="Business identity" hint="Contact facts are shared with the client portal." /><dl className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-4">{[['Owner', tenant.owner_name], ['Owner phone', tenant.owner_phone], ['Owner email', tenant.owner_email], ['Assigned DID', tenant.flynumber_did ?? 'Browser calls only']].map(([label,value]) => <div key={label} className="min-w-0"><dt className="text-[12px] text-[var(--muted)]">{label}</dt><dd className="mt-1 break-words text-[13px] font-medium">{value || '—'}</dd></div>)}</dl><div className="border-t border-[var(--line)] p-5"><h3 className="mb-2 text-[13px] font-medium">Operational notice</h3><p className="text-[13px] text-[var(--text-secondary)]">{tenant.active_broadcast_message || 'No active notice.'}</p></div></Card><div className="notice notice-info"><Phone size={17} className="shrink-0" /><p className="text-[12px]">Carrier setup remains external: point the DID at your LiveKit SIP trunk and run the SIP provisioning script. Saving controls here does not purchase a number or claim a carrier connection.</p></div></div>,
      team: <TeamManager tenantId={id} members={members} />,
      hours: <AgencyHoursEditor tenantId={id} hours={tenant.business_hours ?? {}} />,
      pricing: <AgencyPricingEditor tenantId={id} rows={(tenant.pricing_catalog ?? []).map((row) => ({ ...row, price_dkk: row.price_dkk ?? 0, unit: row.unit ?? 'fixed' }))} />,
      knowledge: <div className="space-y-6"><AiBrainPanel tenantId={id} bundle={brain ? { ...brain, payload: brain.payload as BrainPayload } : null} /><KnowledgeEditor tenantId={id} items={knowledge.map((item) => ({ id: item.id, title: item.title, content: item.content, category: String(item.category), priority: item.priority }))} /></div>,
      prompt: <div className="space-y-6"><section><SectionTitle action={<Badge tone="accent"><ShieldCheck size={12} />Agency only</Badge>}>Receptionist instructions</SectionTitle><Card className="p-5">{config ? <PromptEditor tenantId={id} tenantSlug={tenant.slug} tenantName={tenant.name} defaultLanguage={tenant.default_language} contactId={contacts[0]?.id} contactName={contacts[0]?.full_name ?? 'Caller'} initial={{ customer_system_prompt: config.customer_system_prompt, copilot_system_prompt: config.copilot_system_prompt, greeting_script: config.greeting_script, voice_id: config.voice_id }} /> : <EmptyState compact title="No agent configuration" description="This workspace has no agent configuration on file." />}</Card></section>{promptHistory}</div>,
      webhooks: <WebhookHub tenantId={id} endpoints={endpoints} />,
    }} />
  </div>;
}
