import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, CalendarCheck, MessageSquare, Phone } from 'lucide-react';
import { requireUser } from '@/lib/auth/guard';
import { getContact, getTenantFacts, listCallsForContact, listInspectionRequests, listMessages, listProjectEstimates } from '@/lib/db/queries';
import { Badge, Card, CardHeader, StagePill } from '@/components/ui/core';
import { Avatar, EmptyState, PageHeader, ScoreBar, SectionTitle } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { CallPanel } from '@/components/call/CallPanel';
import { CallRecording } from '@/components/call/CallRecording';
import { LeadDetailForm } from './LeadDetailForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Caller' };
const dkk = (value: number) => value.toLocaleString('da-DK', { maximumFractionDigits: 0 });

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');
  // RLS decides visibility: a cross-tenant id returns null, not someone else's data.
  const [contact, tenant] = await Promise.all([getContact(session.userId, id), getTenantFacts(session.userId, tenantId)]);
  if (!contact || !tenant) notFound();
  const [messages, calls, estimates, inspections] = await Promise.all([
    listMessages(session.userId, contact.id), listCallsForContact(session.userId, contact.id),
    listProjectEstimates(session.userId, contact.id), listInspectionRequests(session.userId, contact.id),
  ]);
  const isDanish = tenant.default_language === 'da-DK';
  const t = (da: string, en: string) => isDanish ? da : en;
  const when = (iso: string) => new Date(iso).toLocaleString(isDanish ? 'da-DK' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-7">
      <PageHeader eyebrow={t('Kunde', 'Caller')} title={contact.full_name ?? t('Unavngivet kunde', 'Unnamed caller')} description={[contact.phone_number, contact.email].filter(Boolean).join(' · ') || t('Ingen kontaktoplysninger', 'No contact details')} actions={<Link href="/portal/leads" className={buttonClass('ghost', 'sm')}><ArrowLeft size={13} />{t('Alle kunder', 'All callers')}</Link>} />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex min-w-0 items-center gap-3"><Avatar name={contact.full_name} size={46} /><div className="min-w-0"><h2 className="truncate text-[15px] font-semibold tracking-[-0.02em]">{contact.full_name ?? '—'}</h2><div className="mt-2 flex flex-wrap items-center gap-2"><StagePill stage={contact.pipeline_stage} danish={isDanish} /><Badge tone={contact.ai_auto_reply_enabled ? 'success' : 'warning'} dot>{contact.ai_auto_reply_enabled ? t('AI slået til', 'AI enabled') : t('AI sat på pause', 'AI paused')}</Badge><Badge tone="neutral">{contact.preferred_language === 'da' ? 'Dansk' : 'English'}</Badge></div></div></div>
              <dl className="flex shrink-0 items-center gap-6"><div><dt className="text-[12px] text-[var(--muted)]">{t('Værdi · DKK', 'Value · DKK')}</dt><dd className="mt-1 text-[18px] font-medium tabular-nums tracking-[-0.03em]">{dkk(contact.estimated_value_dkk)}</dd></div><div><dt className="text-[12px] text-[var(--muted)]">{t('Score', 'Score')}</dt><dd className="mt-2"><ScoreBar score={contact.lead_score} /></dd></div></dl>
            </div>
            {contact.shared_memory_summary ? <p className="surface-raised mt-5 whitespace-pre-wrap p-4 text-[13px] leading-6 text-[var(--text-secondary)]">{contact.shared_memory_summary}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">{contact.phone_number ? <a href={`tel:${contact.phone_number}`} className={buttonClass('secondary', 'sm')}><Phone size={13} />{contact.phone_number}</a> : null}{contact.email ? <a href={`mailto:${contact.email}`} className={buttonClass('secondary', 'sm')}>{contact.email}</a> : null}<Link href={`/chat/${contact.id}`} className={buttonClass('ghost', 'sm')}><MessageSquare size={13} />{t('Åbn chatside', 'Open chat page')}</Link></div>
          </Card>

          <Card>
            <CardHeader title={t('Ring til kunden', 'Call this customer')} hint={t('Prøv AI-receptionisten i browseren med kundens kontekst.', 'Try the AI receptionist in your browser with this caller’s context.')} action={<Badge tone="neutral">WebRTC</Badge>} />
            <div className="p-5"><CallPanel tenantId={tenant.id} tenantSlug={tenant.slug} contactId={contact.id} contactName={contact.full_name ?? t('Kunde', 'Caller')} isDanish={isDanish} /></div>
          </Card>

          {calls.length > 0 ? <section><SectionTitle action={<Badge tone="neutral">{calls.length}</Badge>}>{t('Opkald', 'Calls')}</SectionTitle><div className="space-y-4">{calls.slice(0, 3).map((call, index) => <CallRecording key={call.id} call={call} isDanish={isDanish} index={index} total={Math.min(calls.length, 3)} />)}{calls.length > 3 ? <details className="group glass"><summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-medium text-[var(--text-secondary)]">{t(`Vis ældre opkald (${calls.length - 3})`, `Show older calls (${calls.length - 3})`)}</summary><div className="space-y-4 border-t border-[var(--line)] p-4">{calls.slice(3).map((call, index) => <CallRecording key={call.id} call={call} isDanish={isDanish} index={index + 3} total={calls.length} />)}</div></details> : null}</div></section> : null}

          {(estimates.length > 0 || inspections.length > 0) ? <Card><CardHeader title={t('Overslag og besigtigelser', 'Estimates and inspections')} hint={`${estimates.length} ${t('overslag', 'estimates')} · ${inspections.length} ${t('anmodninger', 'requests')}`} /><div className="space-y-4 p-5">{estimates.map((estimate) => <article key={estimate.id} className="surface-raised p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[13px] font-semibold">{estimate.project_type}</h3><span className="text-[11px] tabular-nums text-[var(--muted)]">{when(estimate.created_at)}</span></div><p className="mt-2 text-[17px] font-medium tabular-nums tracking-[-0.02em] text-[var(--accent-primary)]">{dkk(estimate.estimated_min_dkk)}–{dkk(estimate.estimated_max_dkk)} DKK</p><p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{estimate.scope_details}{estimate.square_meters ? ` · ${estimate.square_meters} m²` : ''}</p><p className="mt-2 text-[11px] text-[var(--muted)]">{t('Vejledende overslag, ikke bindende', 'Non-binding estimate')}</p></article>)}{inspections.map((inspection) => <article key={inspection.id} className="surface-raised p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-[13px] font-semibold"><CalendarCheck size={14} className="text-[var(--accent-primary)]" aria-hidden />{t('Besigtigelsesanmodning', 'Inspection request')}</h3><Badge tone="warning">{inspection.status}</Badge></div><p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">{inspection.requested_time_text} · {inspection.address || t('Adresse mangler', 'No address')}</p><p className="mt-2 text-[11px] text-[var(--muted)]">{t('Ønsket tid er ikke bekræftet af kontoret.', 'The requested time is not confirmed by the office.')}</p></article>)}</div></Card> : null}

          <Card>
            <CardHeader title={t('Samtale', 'Conversation')} hint={messages.length === 0 ? t('Ingen beskeder endnu', 'No messages yet') : `${messages.length} ${t('beskeder', 'messages')}`} action={<MessageSquare size={15} className="text-[var(--muted)]" aria-hidden />} />
            {messages.length === 0 ? <EmptyState icon={<MessageSquare size={20} />} title={t('Ingen samtale endnu', 'No conversation yet')} description={t('Når kunden skriver eller taler med AI’en, vises det her.', 'When the customer messages or talks to the AI, it appears here.')} /> : <ul className="space-y-3 p-5">{messages.map((message) => { const inbound = message.direction === 'inbound'; return <li key={message.id} className={inbound ? 'flex justify-start' : 'flex justify-end'}><div className={`chat-bubble ${inbound ? 'chat-bubble-ai' : 'chat-bubble-customer'}`}><div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]"><span>{message.sender}</span><span className="tabular-nums">{when(message.created_at)}</span></div><p className="whitespace-pre-wrap">{message.content}</p></div></li>; })}</ul>}
          </Card>
        </div>
        <LeadDetailForm contactId={contact.id} isDanish={isDanish} defaultStage={contact.pipeline_stage} defaultScore={contact.lead_score} defaultValue={contact.estimated_value_dkk} defaultSummary={contact.shared_memory_summary} autoReply={contact.ai_auto_reply_enabled} />
      </div>
      <p className="text-[12px] text-[var(--muted)]">{t('Oprettet', 'Created')} {when(contact.created_at)}</p>
    </div>
  );
}
