import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, MessageSquare, Phone } from 'lucide-react';
import { requireUser } from '@/lib/auth/guard';
import { getContact, getTenantFacts, listCallsForContact, listMessages } from '@/lib/db/queries';
import { Badge, Card, CardHeader, StagePill } from '@/components/ui/core';
import { Avatar, EmptyState, PageHeader, ScoreBar } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { CallPanel } from '@/components/call/CallPanel';
import { CallRecording } from '@/components/call/CallRecording';
import { LeadDetailForm } from './LeadDetailForm';

export const dynamic = 'force-dynamic';

const dkk = (n: number) => n.toLocaleString('da-DK', { maximumFractionDigits: 0 });

function when(iso: string) {
  return new Date(iso).toLocaleString('da-DK', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  // RLS decides visibility: a cross-tenant id returns null, not someone else's data.
  const [contact, tenant] = await Promise.all([
    getContact(session.userId, id),
    getTenantFacts(session.userId, tenantId),
  ]);

  if (!contact || !tenant) notFound();

  const messages = await listMessages(session.userId, contact.id);
  const calls = await listCallsForContact(session.userId, contact.id);
  const isDanish = tenant.default_language === 'da-DK';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isDanish ? 'Kunde' : 'Caller'}
        title={contact.full_name ?? (isDanish ? 'Unavngivet' : 'Unnamed caller')}
        description={
          [contact.phone_number, contact.email].filter(Boolean).join(' · ') ||
          (isDanish ? 'Ingen kontaktoplysninger' : 'No contact details')
        }
        actions={
          <Link href="/portal/leads" className={buttonClass('ghost', 'sm')}>
            <ArrowLeft size={13} />
            {isDanish ? 'Alle kunder' : 'All callers'}
          </Link>
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <Avatar name={contact.full_name} size={44} />
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {contact.full_name ?? '—'}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StagePill stage={contact.pipeline_stage} danish={isDanish} />
                    <Badge tone={contact.ai_auto_reply_enabled ? 'success' : 'warning'} dot>
                      AI{' '}
                      {isDanish
                        ? contact.ai_auto_reply_enabled
                          ? 'til'
                          : 'sat på pause'
                        : contact.ai_auto_reply_enabled
                          ? 'on'
                          : 'paused'}
                    </Badge>
                    <Badge tone="neutral">
                      {contact.preferred_language === 'da' ? 'Dansk' : 'English'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 text-right">
                <div>
                  <div className="text-eyebrow">{isDanish ? 'Værdi' : 'Value'}</div>
                  <div className="mt-1 font-mono text-sm font-bold tabular-nums">
                    {dkk(contact.estimated_value_dkk)}
                  </div>
                </div>
                <div>
                  <div className="text-eyebrow">{isDanish ? 'Score' : 'Score'}</div>
                  <div className="mt-1">
                    <ScoreBar score={contact.lead_score} />
                  </div>
                </div>
              </div>
            </div>

            {contact.shared_memory_summary ? (
              <p className="mt-4 rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {contact.shared_memory_summary}
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title={isDanish ? 'Ring til kunden' : 'Call this customer'}
              hint={
                isDanish
                  ? 'Åbner en LiveKit-samtale med AI-receptionisten.'
                  : 'Opens a live LiveKit session with the AI receptionist.'
              }
              action={
                <Badge tone="accent" dot>
                  LiveKit
                </Badge>
              }
            />
            <div className="p-5">
              <CallPanel
                tenantId={tenant.id}
                tenantSlug={tenant.slug}
                contactId={contact.id}
                contactName={contact.full_name ?? 'Caller'}
                isDanish={isDanish}
              />
            </div>
          </Card>

          {calls.length > 0 ? (
            <section className="space-y-3">
              <p className="text-eyebrow flex items-center gap-1.5">
                <Phone size={11} />
                {isDanish ? 'Opkald' : 'Calls'} · {calls.length}
              </p>
              {calls.map((call, i) => (
                <CallRecording
                  key={call.id}
                  call={call}
                  isDanish={isDanish}
                  index={i}
                  total={calls.length}
                />
              ))}
            </section>
          ) : null}

          <Card>
            <CardHeader
              title={isDanish ? 'Samtale' : 'Conversation'}
              hint={
                messages.length === 0
                  ? isDanish
                    ? 'Ingen beskeder endnu'
                    : 'No messages yet'
                  : `${messages.length} ${isDanish ? 'beskeder' : 'messages'}`
              }
              action={<MessageSquare size={14} className="text-[var(--text-muted)]" />}
            />
            {messages.length === 0 ? (
              <EmptyState
                icon={<MessageSquare size={18} />}
                title={isDanish ? 'Ingen samtale endnu' : 'No conversation yet'}
                description={
                  isDanish
                    ? 'Når kunden skriver på WhatsApp eller taler med AI’en, vises det her.'
                    : 'When the customer messages on WhatsApp or talks to the AI, it appears here.'
                }
              />
            ) : (
              <ul className="space-y-3 p-5">
                {messages.map((m) => {
                  const inbound = m.direction === 'inbound';
                  return (
                    <li key={m.id} className={inbound ? 'flex justify-start' : 'flex justify-end'}>
                      <div
                        className={
                          inbound
                            ? 'max-w-[80%] rounded-[var(--r-md)] rounded-bl-sm border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-2'
                            : 'max-w-[80%] rounded-[var(--r-md)] rounded-br-sm bg-[var(--accent-soft)] px-3 py-2'
                        }
                      >
                        <div className="mb-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                          <span>{m.sender}</span>
                          <span>{when(m.created_at)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-primary)]">
                          {m.content}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <LeadDetailForm
          contactId={contact.id}
          isDanish={isDanish}
          defaultStage={contact.pipeline_stage}
          defaultScore={contact.lead_score}
          defaultValue={contact.estimated_value_dkk}
          defaultSummary={contact.shared_memory_summary}
          autoReply={contact.ai_auto_reply_enabled}
        />
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <Phone size={11} />
        {isDanish ? 'Oprettet ' : 'Created '}
        {when(contact.created_at)}
      </p>
    </div>
  );
}
