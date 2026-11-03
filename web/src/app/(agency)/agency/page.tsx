import Link from 'next/link';
import { AlertTriangle, Building2, Plus, TrendingUp } from 'lucide-react';
import { requireAgency } from '@/lib/auth/guard';
import { listTenants } from '@/lib/db/queries';
import { Badge, Card, Stat } from '@/components/ui/core';
import { EmptyState, PageHeader, SectionTitle } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';

export const dynamic = 'force-dynamic';

const dkk = (n: number) => n.toLocaleString('da-DK', { maximumFractionDigits: 0 });

export default async function AgencyPortfolioPage() {
  const session = await requireAgency();
  const tenants = await listTenants(session.userId);

  const totalPipeline = tenants.reduce((sum, t) => sum + t.pipeline_dkk, 0);
  const totalContacts = tenants.reduce((sum, t) => sum + t.contact_count, 0);
  const totalCalls = tenants.reduce((sum, t) => sum + t.call_count, 0);
  const totalDire = tenants.reduce((sum, t) => sum + t.open_dire, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agency"
        title="Portfolio"
        description="Every client workspace you operate. Figures are live from PostgreSQL — nothing here is a demo delta."
        actions={
          <>
            <Link href="/agency/clients" className={buttonClass('secondary', 'md')}>
              All clients
            </Link>
            <Link href="/agency/clients/new" className={buttonClass('primary', 'md')}>
              <Plus size={14} />
              New client
            </Link>
          </>
        }
      />

      {totalDire > 0 ? (
        <div className="animate-rise flex items-center gap-2.5 rounded-[var(--r-lg)] border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3">
          <AlertTriangle size={14} className="text-[var(--danger)]" />
          <p className="text-xs font-semibold text-[var(--danger)]">
            {totalDire} open {totalDire === 1 ? 'emergency' : 'emergencies'} across the portfolio
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Managed pipeline"
          value={dkk(totalPipeline)}
          unit="DKK"
          tone="accent"
          icon={<TrendingUp size={14} />}
        />
        <Stat label="Workspaces" value={tenants.length} unit="clients" icon={<Building2 size={14} />} />
        <Stat label="Callers" value={totalContacts} unit="across all" />
        <Stat
          label="Calls handled"
          value={totalCalls}
          unit="sessions"
          tone={totalCalls > 0 ? 'success' : 'default'}
        />
      </div>

      <section>
        <SectionTitle
          action={
            <Link
              href="/agency/clients"
              className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:text-[var(--accent-primary)]"
            >
              Manage →
            </Link>
          }
        >
          Workspaces
        </SectionTitle>

        {tenants.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Building2 size={18} />}
              title="No workspaces yet"
              description="Create your first client. They get a portal, an AI receptionist and a pipeline in one step."
              action={
                <Link href="/agency/clients/new" className={buttonClass('primary', 'md')}>
                  <Plus size={14} />
                  Create a client
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {tenants.map((t) => (
              <Link key={t.id} href={`/agency/clients/${t.id}`} className="block">
                <Card interactive className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {t.name}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                        /{t.slug}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {t.open_dire > 0 ? (
                        <Badge tone="danger" dot>
                          {t.open_dire} dire
                        </Badge>
                      ) : null}
                      <Badge tone={t.status === 'active' ? 'success' : 'warning'}>{t.status}</Badge>
                    </div>
                  </div>

                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--border-subtle)] pt-3">
                    <div>
                      <dt className="text-[10px] text-[var(--text-muted)]">Callers</dt>
                      <dd className="font-mono text-sm tabular-nums">{t.contact_count}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-[var(--text-muted)]">Pipeline</dt>
                      <dd className="font-mono text-sm tabular-nums">{dkk(t.pipeline_dkk)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-[var(--text-muted)]">Calls</dt>
                      <dd className="font-mono text-sm tabular-nums">{t.call_count}</dd>
                    </div>
                  </dl>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

