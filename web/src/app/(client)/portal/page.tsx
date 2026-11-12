import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowRight, MessageSquare, Phone, Plus, Users } from 'lucide-react';
import { requireUser } from '@/lib/auth/guard';
import { getTenantOverview, listContacts, getTenantFacts, listOpenEscalations } from '@/lib/db/queries';
import { Badge, Card, CardHeader, StagePill, Stat, StatGroup } from '@/components/ui/core';
import { Avatar, EmptyState, PageHeader, SectionTitle } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { CallPanel } from '@/components/call/CallPanel';
import { AiCopilotBar } from '@/components/portal/AiCopilotBar';
import { STAGES } from '@/lib/pipeline';
import { resolveEscalationAction } from './escalation-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview' };
const dkk = (value: number) => value.toLocaleString('da-DK', { maximumFractionDigits: 0 });
const STAGE_COLORS: Record<string, string> = {
  new_lead: 'var(--border-strong)', contacted: 'var(--info)', qualified: 'var(--accent-primary)',
  booked: 'var(--success)', dire_escalated: 'var(--danger)', closed_won: 'var(--success)', closed_lost: 'var(--muted)',
};

export default async function PortalOverviewPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');
  const [overview, recent, tenant, all, escalations] = await Promise.all([
    getTenantOverview(session.userId, tenantId), listContacts(session.userId, tenantId, 5),
    getTenantFacts(session.userId, tenantId), listContacts(session.userId, tenantId, 200), listOpenEscalations(session.userId, tenantId, 5),
  ]);
  if (!tenant) redirect('/no-access');
  const isDanish = tenant.default_language === 'da-DK';
  const t = (da: string, en: string) => isDanish ? da : en;
  const byStage = new Map<string, number>();
  for (const contact of all) byStage.set(contact.pipeline_stage, (byStage.get(contact.pipeline_stage) ?? 0) + 1);
  const maxStage = Math.max(1, ...Array.from(byStage.values()));

  return (
    <div className="space-y-7">
      <PageHeader eyebrow={t('Dit arbejdsrum', 'Your workspace')} title={tenant.name} description={t('Et samlet overblik over kunder, samtaler og de sager, der kræver din opmærksomhed.', 'Your callers, conversations and the things that need your attention. All in one place.')} actions={<Link href="/portal/leads/new" className={buttonClass('primary')}><Plus size={15} />{t('Ny kunde', 'New caller')}</Link>} />
      <AiCopilotBar isDanish={isDanish} />
      {overview.dire > 0 ? <div className="notice notice-danger items-center"><AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden /><p className="flex-1 text-[13px] font-medium">{overview.dire} {overview.dire === 1 ? t('akut sag kræver din opmærksomhed', 'emergency case needs your attention') : t('akutte sager kræver din opmærksomhed', 'emergency cases need your attention')}.</p><Link href="/portal/leads" className={buttonClass('ghost', 'sm', 'text-[var(--danger)]')}>{t('Se kunder', 'Review')}<ArrowRight size={13} /></Link></div> : null}
      {escalations.length > 0 ? (
        <Card>
          <CardHeader title={t('Kræver opfølgning', 'Needs follow-up')} hint={t('Kunder hvor assistenten har bedt om en person eller markeret en risiko.', 'Customers where the assistant requested a person or flagged a risk.')} action={<Badge tone="danger">{escalations.length} {t('sager', 'open')}</Badge>} />
          <ul className="divide-y divide-[var(--line)]">{escalations.map((escalation) => {
            const reason = isDanish ? ({ angry_customer: 'Frustreret kunde', high_value_emergency: 'Akut / høj værdi', ai_unanswered_question: 'AI kunne ikke svare', human_requested: 'Kunden bad om en person' }[escalation.reason] ?? escalation.reason) : escalation.reason.replaceAll('_', ' ');
            const body = <div className="flex items-start gap-3 px-5 py-4"><span className="mt-1 shrink-0 text-[var(--danger)]">{escalation.channel === 'web_chat' ? <MessageSquare size={16} /> : <Phone size={16} />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold">{escalation.contact_name || t('Ukendt kunde', 'Unknown caller')}</span><Badge tone="danger">{reason}</Badge></div><p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">{escalation.briefing}</p><p className="mt-1 text-[11px] text-[var(--muted)]">{escalation.n8n_status === 'delivered' ? t('Sendt til arbejdsgang', 'Sent to workflow') : t('Registreret til opfølgning', 'Recorded for follow-up')} · {new Date(escalation.created_at).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}</p></div></div>;
            return <li key={escalation.id} className="flex flex-wrap items-center gap-2 pr-4 sm:flex-nowrap">{escalation.contact_id ? <Link href={`/portal/leads/${escalation.contact_id}`} className="min-w-0 flex-1 transition-colors hover:bg-[var(--bg-raised)]">{body}</Link> : <div className="min-w-0 flex-1">{body}</div>}<form action={resolveEscalationAction} className="ml-12 shrink-0 sm:ml-0"><input type="hidden" name="escalationId" value={escalation.id} /><SubmitButton variant="secondary" size="sm" pendingLabel={t('Gemmer…', 'Saving…')}>{t('Marker klaret', 'Resolve')}</SubmitButton></form></li>;
          })}</ul>
        </Card>
      ) : null}
      <StatGroup>
        <Stat label={t('Pipelineværdi', 'Pipeline value')} value={dkk(overview.pipeline_dkk)} unit="DKK" hint={t('Anslået værdi af alle kunder', 'Estimated value of all callers')} />
        <Stat label={t('Kunder', 'Callers')} value={overview.contacts} unit={t('i alt', 'total')} hint={t('I dit arbejdsrum', 'In your workspace')} />
        <Stat label={t('Booket', 'Booked')} value={overview.booked} unit={t('aftaler', 'appointments')} hint={t('Kunder i booket-stadiet', 'Callers at the booked stage')} />
        <Stat label={t('Opkald', 'Calls')} value={overview.calls} unit={t('sessioner', 'sessions')} hint={`${overview.messages} ${t('beskeder registreret', 'messages recorded')}`} />
      </StatGroup>
      <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Card>
          <CardHeader title="Pipeline" hint={t('Hvor kunderne står lige nu.', 'Where your callers stand right now.')} action={<Link href="/portal/leads" className={buttonClass('ghost', 'sm')}>{t('Se kunder', 'View callers')}<ArrowRight size={13} /></Link>} />
          <div className="space-y-4 p-5">{STAGES.map(([key, da, en]) => {
            const count = byStage.get(key) ?? 0;
            const pct = (count / maxStage) * 100;
            return <div key={key} className="flex items-center gap-3"><span className="w-24 shrink-0 text-[12px] text-[var(--text-secondary)]">{t(da, en)}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-raised)]" aria-hidden><div className="pipeline-fill h-full rounded-full" style={{ width: `${pct}%`, background: STAGE_COLORS[key] }} /></div><span className="w-7 shrink-0 text-right text-[12px] tabular-nums text-[var(--text)]">{count}</span></div>;
          })}</div>
          <p className="border-t border-[var(--line)] px-5 py-3 text-[11px] text-[var(--muted)]">{all.length >= 200 ? t('Baseret på de 200 senest opdaterede kunder.', 'Based on the 200 most recently updated callers.') : t('Baseret på alle kunder i arbejdsrummet.', 'Based on every caller in this workspace.')}</p>
        </Card>
        <Card className="flex flex-col">
          <CardHeader title={t('Prøv receptionisten', 'Try the receptionist')} hint={t('Oplev et opkald, som kunden ville gøre.', 'Experience a call the way a customer would.')} action={<Badge tone="neutral">WebRTC</Badge>} />
          <div className="flex flex-1 flex-col justify-center p-5">{recent.length > 0 ? <CallPanel tenantId={tenant.id} tenantSlug={tenant.slug} contactId={recent[0].id} contactName={recent[0].full_name ?? 'Caller'} isDanish={isDanish} /> : <EmptyState compact icon={<Phone size={20} />} title={t('Klar til den første prøve', 'Ready for a first test')} description={t('Opret en kunde for at prøve AI-receptionisten i browseren.', 'Add a caller to try the AI receptionist in your browser.')} action={<Link href="/portal/leads/new" className={buttonClass('secondary', 'sm')}><Plus size={13} />{t('Opret kunde', 'Create caller')}</Link>} />}</div>
        </Card>
      </div>
      <section>
        <SectionTitle action={<Link href="/portal/leads" className={buttonClass('ghost', 'sm')}>{t('Alle kunder', 'All callers')}<ArrowRight size={13} /></Link>}>{t('Seneste kunder', 'Recent callers')}</SectionTitle>
        <Card className="overflow-hidden">{recent.length === 0 ? <EmptyState icon={<Users size={20} />} title={t('Ingen kunder endnu', 'No callers yet')} description={t('Opret din første kunde for at se pipelinen og prøve AI’en.', 'Create your first caller to see the pipeline and try the AI.')} action={<Link href="/portal/leads/new" className={buttonClass('primary', 'sm')}><Plus size={14} />{t('Opret kunde', 'Create caller')}</Link>} /> : <ul className="divide-y divide-[var(--line)]">{recent.map((contact) => <li key={contact.id}><Link href={`/portal/leads/${contact.id}`} className="list-link"><Avatar name={contact.full_name} size={36} /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{contact.full_name ?? '—'}</p><p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{contact.phone_number ?? contact.email ?? t('Ingen kontaktoplysninger', 'No contact details')}</p></div><div className="flex shrink-0 flex-col items-end gap-1.5"><StagePill stage={contact.pipeline_stage} danish={isDanish} /><span className="text-[11px] tabular-nums text-[var(--muted)]">{dkk(contact.estimated_value_dkk)} DKK</span></div><ArrowRight size={14} className="row-arrow hidden sm:block" aria-hidden /></Link></li>)}</ul>}</Card>
      </section>
      <p className="text-[11px] text-[var(--muted)]">{t('Tal opdateres ved hver sidevisning. Pipelineværdi er vejledende.', 'Figures refresh on each page view. Pipeline values are estimates.')}</p>
    </div>
  );
}
