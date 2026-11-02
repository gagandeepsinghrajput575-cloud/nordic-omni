import Link from 'next/link';
import { requireAgency } from '@/lib/auth/guard';
import { listTenants } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export default async function AgencyPortfolioPage() {
  const session = await requireAgency();
  const tenants = await listTenants(session.userId);

  const totalPipeline = tenants.reduce((sum, t) => sum + t.pipeline_dkk, 0);
  const totalContacts = tenants.reduce((sum, t) => sum + t.contact_count, 0);
  const totalDire = tenants.reduce((sum, t) => sum + t.open_dire, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Portfolio</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Every client workspace you operate. Figures are live from PostgreSQL.
          </p>
        </div>
        <Link
          href="/agency/clients"
          className="rounded-lg bg-[var(--accent-primary)] px-3 py-2 text-xs font-semibold text-[var(--accent-contrast)] transition hover:opacity-90"
        >
          Manage clients
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="text-xs text-[var(--text-secondary)]">Managed pipeline</div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-bold tabular-nums">
              {totalPipeline.toLocaleString('da-DK', { maximumFractionDigits: 0 })}
            </span>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">DKK</span>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="text-xs text-[var(--text-secondary)]">Active workspaces</div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-bold tabular-nums">{tenants.length}</span>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">tenants</span>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="text-xs text-[var(--text-secondary)]">Open emergencies</div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className={`font-mono text-2xl font-bold tabular-nums ${
                totalDire > 0 ? 'text-[var(--danger)]' : ''
              }`}
            >
              {totalDire}
            </span>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              across {totalContacts} leads
            </span>
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
          Workspaces
        </h2>

        {tenants.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-10 text-center">
            <p className="text-xs text-[var(--text-muted)]">No tenants yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {tenants.map((t) => (
              <Link
                key={t.id}
                href={`/agency/clients/${t.id}`}
                className="group rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 transition hover:border-[var(--border-strong)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{t.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                      /{t.slug} · {t.default_language}
                    </div>
                  </div>
                  <span className="shrink-0 rounded border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-muted)]">
                    {t.status}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--border-subtle)] pt-3">
                  <div>
                    <dt className="text-[10px] text-[var(--text-muted)]">Leads</dt>
                    <dd className="font-mono text-sm tabular-nums">{t.contact_count}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-[var(--text-muted)]">Pipeline</dt>
                    <dd className="font-mono text-sm tabular-nums">
                      {t.pipeline_dkk.toLocaleString('da-DK', { maximumFractionDigits: 0 })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-[var(--text-muted)]">Calls</dt>
                    <dd className="font-mono text-sm tabular-nums">{t.call_count}</dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
