import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, TrendingUp, Users, CheckCircle, Clock } from 'lucide-react';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts, listContacts } from '@/lib/db/queries';
import { PageHeader } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { CallerDirectory } from '@/components/portal/CallerDirectory';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Callers' };

const dkk = (value: number) => value.toLocaleString('da-DK', { maximumFractionDigits: 0 });

export default async function PortalLeadsPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  const [contacts, tenant] = await Promise.all([
    listContacts(session.userId, tenantId, 200),
    getTenantFacts(session.userId, tenantId),
  ]);
  if (!tenant) redirect('/no-access');

  const isDanish = tenant.default_language === 'da-DK';
  const t = (da: string, en: string) => (isDanish ? da : en);

  // Compute pipeline intelligence metrics
  const totalPipelineValue = contacts.reduce((sum, c) => sum + (c.estimated_value_dkk || 0), 0);
  const activeOpportunities = contacts.filter((c) =>
    ['new_lead', 'contacted', 'qualified', 'booked'].includes(c.pipeline_stage),
  ).length;
  const closedWonCount = contacts.filter((c) => c.pipeline_stage === 'closed_won').length;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={t('Arbejdsrum', 'Workspace')}
        title={t('Dine kunder & pipeline', 'Your callers & pipeline')}
        description={
          t(
            'Følg samtalerne, vurder mulighederne med AI-overslag, og find det næste skridt for hver kunde.',
            'Follow conversations, qualify opportunities with AI estimates, and find the next step for every caller.',
          )
        }
        actions={
          <Link href="/portal/leads/new" className={buttonClass('primary')}>
            <Plus size={15} />
            {t('Ny kunde', 'New caller')}
          </Link>
        }
      />

      {/* Pipeline Intelligence Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-5">
          <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-2">
            <span>{t('Samlet pipeline værdi', 'Total Pipeline Value')}</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums">
            {dkk(totalPipelineValue)} DKK
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            {t('Vejledende estimater fra samtaler og henvendelser', 'Estimates based on call scoping and inquiries')}
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-5">
          <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-2">
            <span>{t('Aktive sager i spil', 'Active Opportunities')}</span>
            <Clock className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums">
            {activeOpportunities}
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            {t('Nye henvendelser, kvalificerede og bookede sager', 'New leads, qualified, and booked inspections')}
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-5">
          <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-2">
            <span>{t('Vundne opgaver', 'Closed Won Jobs')}</span>
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums">
            {closedWonCount}
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            {t('Gennemførte sager klar til Google Review Gatekeeper', 'Completed jobs ready for review follow-up')}
          </p>
        </div>
      </div>

      <CallerDirectory contacts={contacts} isDanish={isDanish} />
    </div>
  );
}
