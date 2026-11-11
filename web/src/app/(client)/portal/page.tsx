import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  Banknote,
  CalendarCheck,
  MessageSquare,
  Phone,
  Plus,
  TrendingUp,
  Users,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/guard';
import {
  getTenantOverview,
  listContacts,
  getTenantFacts,
  listOpenEscalations,
} from '@/lib/db/queries';
import { Badge, Card, CardHeader, StagePill, Stat } from '@/components/ui/core';
import { Avatar, EmptyState, PageHeader, SectionTitle } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { CallPanel } from '@/components/call/CallPanel';
import { AiCopilotBar } from '@/components/portal/AiCopilotBar';
import { resolveEscalationAction } from './escalation-actions';

export const dynamic = 'force-dynamic';

const dkk = (n: number) => n.toLocaleString('da-DK', { maximumFractionDigits: 0 });

const STAGE_ORDER = [
  ['new_lead', 'Nye', 'New'],
  ['contacted', 'Kontaktet', 'Contacted'],
  ['qualified', 'Kvalificeret', 'Qualified'],
  ['booked', 'Booket', 'Booked'],
  ['dire_escalated', 'Akut', 'Emergency'],
  ['closed_won', 'Vundet', 'Won'],
  ['closed_lost', 'Tabt', 'Lost'],
] as const;

export default async function PortalOverviewPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  const [overview, recent, tenant, all, escalations] = await Promise.all([
    getTenantOverview(session.userId, tenantId),
    listContacts(session.userId, tenantId, 5),
    getTenantFacts(session.userId, tenantId),
    listContacts(session.userId, tenantId, 200),
    listOpenEscalations(session.userId, tenantId, 5),
  ]);

  if (!tenant) redirect('/no-access');
  const isDanish = tenant.default_language === 'da-DK';

  const byStage = new Map<string, number>();
  for (const c of all) byStage.set(c.pipeline_stage, (byStage.get(c.pipeline_stage) ?? 0) + 1);
  const maxStage = Math.max(1, ...Array.from(byStage.values()));

  const STAGE_BAR_COLORS: Record<string, string> = {
    new_lead: 'var(--muted)',
    contacted: 'var(--accent-secondary)',
    qualified: 'var(--accent-primary)',
    booked: 'var(--success)',
    dire_escalated: 'var(--danger)',
    closed_won: 'var(--success)',
    closed_lost: 'var(--warning)',
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isDanish ? 'Overblik' : 'Overview'}
        title={tenant.name}
        description={
          isDanish
            ? 'Live tal fra dit arbejdsrum. Opdateres ved hver sidevisning.'
            : 'Live figures from your workspace. Refreshed on every page view.'
        }
        actions={
          <Link href="/portal/leads/new" className={buttonClass('primary', 'md')}>
            <Plus size={14} />
            {isDanish ? 'Ny kunde' : 'New caller'}
          </Link>
        }
      />

      {/* Natural Language AI Operations Bar */}
      <AiCopilotBar isDanish={isDanish} />

      {overview.dire > 0 ? (
        <div className="animate-rise flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-lg)] border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="animate-dire flex h-6 w-6 items-center justify-center rounded-full bg-[var(--danger)]/15">
              <AlertTriangle size={13} className="text-[var(--danger)]" />
            </span>
            <p className="text-xs font-semibold text-[var(--danger)]">
              {isDanish
                ? `${overview.dire} ${
                    overview.dire === 1 ? 'akut sag kræver' : 'akutte sager kræver'
                  } din opmærksomhed`
                : `${overview.dire} ${
                    overview.dire === 1 ? 'emergency case needs' : 'emergency cases need'
                  } your attention`}
            </p>
          </div>
          <Link
            href="/portal/leads"
            className="font-mono text-[10px] uppercase tracking-wider text-[var(--danger)] underline underline-offset-2"
          >
            {isDanish ? 'Se nu' : 'Review'}
          </Link>
        </div>
      ) : null}

      {escalations.length > 0 ? (
        <Card>
          <CardHeader
            title={isDanish ? 'Kræver opfølgning' : 'Needs follow-up'}
            hint={
              isDanish
                ? 'Kunder hvor assistenten har bedt om en person eller markeret en risiko.'
                : 'Customers where the assistant requested a person or flagged risk.'
            }
            action={<Badge tone="danger">{escalations.length}</Badge>}
          />
          <ul className="divide-y divide-[var(--line)]">
            {escalations.map((escalation) => {
              const reason =
                isDanish
                  ? {
                      angry_customer: 'Frustreret kunde',
                      high_value_emergency: 'Akut / høj værdi',
                      ai_unanswered_question: 'AI kunne ikke svare',
                      human_requested: 'Kunden bad om en person',
                    }[escalation.reason] ?? escalation.reason
                  : escalation.reason.replaceAll('_', ' ');
              const body = (
                <div className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--danger-soft)] text-[var(--danger)]">
                    {escalation.channel === 'web_chat' ? (
                      <MessageSquare size={13} />
                    ) : (
                      <Phone size={13} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-[var(--text)]">
                        {escalation.contact_name || (isDanish ? 'Ukendt kunde' : 'Unknown caller')}
                      </span>
                      <Badge tone="danger">{reason}</Badge>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {escalation.n8n_status === 'delivered'
                          ? isDanish
                            ? 'Sendt til arbejdsgang'
                            : 'Sent to workflow'
                          : isDanish
                            ? 'Kun registreret'
                            : 'Recorded only'}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                      {escalation.briefing}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                    {new Date(escalation.created_at).toLocaleTimeString('da-DK', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              );
              return (
                <li key={escalation.id} className="flex items-center gap-2 pr-4">
                  {escalation.contact_id ? (
                    <Link
                      href={`/portal/leads/${escalation.contact_id}`}
                      className="min-w-0 flex-1 transition-colors hover:bg-[var(--bg-raised)]"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1">{body}</div>
                  )}
                  <form action={resolveEscalationAction}>
                    <input type="hidden" name="escalationId" value={escalation.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                    >
                      {isDanish ? 'Marker klaret' : 'Resolve'}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          label={isDanish ? 'Pipeline' : 'Pipeline value'}
          value={dkk(overview.pipeline_dkk)}
          unit="DKK"
          tone="accent"
          icon={<TrendingUp size={14} />}
          hint={isDanish ? 'Sum af alle kunders værdi' : 'Sum of every caller’s value'}
        />
        <Stat
          label={isDanish ? 'Kunder' : 'Callers'}
          value={overview.contacts}
          unit={isDanish ? 'i alt' : 'total'}
          icon={<Users size={14} />}
        />
        <Stat
          label={isDanish ? 'Booket' : 'Booked'}
          value={overview.booked}
          unit={isDanish ? 'aftaler' : 'appointments'}
          tone={overview.booked > 0 ? 'success' : 'default'}
          icon={<CalendarCheck size={14} />}
        />
        <Stat
          label={isDanish ? 'Opkald' : 'Calls'}
          value={overview.calls}
          unit={
            isDanish
              ? overview.calls === 1
                ? 'session'
                : 'sessioner'
              : overview.calls === 1
                ? 'session'
                : 'sessions'
          }
          icon={<Phone size={14} />}
          hint={
            overview.messages > 0
              ? `${overview.messages} ${isDanish ? 'beskeder' : 'messages'}`
              : undefined
          }
        />
      </div>

      {/* Pipeline + live call */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Card>
          <CardHeader
            title={isDanish ? 'Pipeline' : 'Pipeline'}
            hint={isDanish ? 'Hvor kunderne står lige nu' : 'Where your callers stand right now'}
            action={<Banknote size={14} className="text-[var(--text-muted)]" />}
          />
          <div className="space-y-2.5 p-5">
            {STAGE_ORDER.map(([key, da, en]) => {
              const count = byStage.get(key) ?? 0;
              const pct = Math.round((count / maxStage) * 100);
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {isDanish ? da : en}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-raised)]">
                    <div
                      className="h-full rounded-full transition-[width] duration-700"
                      style={{
                        width: `${pct}%`,
                        background: STAGE_BAR_COLORS[key] || 'var(--accent-primary)',
                      }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        {recent.length > 0 ? (
          <Card>
            <CardHeader
              title={isDanish ? 'Test AI’en' : 'Test the AI'}
              hint={isDanish ? 'Ring som kunden ville gøre' : 'Call the way a customer would'}
              action={
                <Badge tone="neutral">
                  WebRTC
                </Badge>
              }
            />
            <div className="p-5">
              <CallPanel
                tenantId={tenant.id}
                tenantSlug={tenant.slug}
                contactId={recent[0].id}
                contactName={recent[0].full_name ?? 'Caller'}
                isDanish={isDanish}
              />
            </div>
          </Card>
        ) : null}
      </div>

      <section>
        <SectionTitle
          action={
            <Link
              href="/portal/leads"
              className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:text-[var(--accent-primary)]"
            >
              {isDanish ? 'Se alle' : 'View all'} →
            </Link>
          }
        >
          {isDanish ? 'Seneste kunder' : 'Recent callers'}
        </SectionTitle>

        <Card className="overflow-hidden">
          {recent.length === 0 ? (
            <EmptyState
              icon={<Users size={18} />}
              title={isDanish ? 'Ingen kunder endnu' : 'No callers yet'}
              description={
                isDanish
                  ? 'Opret din første kunde for at se pipelinen og teste AI’en.'
                  : 'Create your first caller to see the pipeline and test the AI.'
              }
              action={
                <Link href="/portal/leads/new" className={buttonClass('primary', 'sm')}>
                  <Plus size={13} />
                  {isDanish ? 'Opret kunde' : 'Create caller'}
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {recent.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/portal/leads/${c.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--bg-raised)]/50"
                  >
                    <Avatar name={c.full_name} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-[var(--text-primary)]">
                        {c.full_name ?? '—'}
                      </div>
                      <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                        {c.phone_number ?? c.email ?? 'no contact detail'}
                      </div>
                    </div>
                    <StagePill stage={c.pipeline_stage} danish={isDanish} />
                    <span className="hidden font-mono text-[11px] tabular-nums text-[var(--text-secondary)] sm:inline">
                      {dkk(c.estimated_value_dkk)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
