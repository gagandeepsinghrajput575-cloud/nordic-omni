import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { getTenantOverview, listContacts, getTenantFacts } from '@/lib/db/queries';
import { CallPanel } from '@/components/call/CallPanel';

export const dynamic = 'force-dynamic';

function dkk(n: number, locale: string) {
  return n.toLocaleString(locale === 'da-DK' ? 'da-DK' : 'en-US', {
    maximumFractionDigits: 0,
  });
}

export default async function PortalOverviewPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  // Real aggregates from PostgreSQL. No invented deltas, no fake sparklines.
  const [overview, recent, tenant] = await Promise.all([
    getTenantOverview(session.userId, tenantId),
    listContacts(session.userId, tenantId, 6),
    getTenantFacts(session.userId, tenantId),
  ]);

  const kpis = [
    { label: 'Pipeline value', value: dkk(overview.pipeline_dkk, 'da-DK'), unit: 'DKK' },
    { label: 'Active leads', value: String(overview.contacts), unit: 'contacts' },
    { label: 'Booked', value: String(overview.booked), unit: 'appointments' },
    { label: 'Calls', value: String(overview.calls), unit: 'sessions' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Live figures from your workspace. Updated on every request.
        </p>
      </div>

      {tenant && recent.length > 0 && (
        <CallPanel
          tenantId={tenant.id}
          tenantSlug={tenant.slug}
          contactId={recent[0].id}
          contactName={recent[0].full_name ?? 'Caller'}
          isDanish={tenant.default_language === 'da-DK'}
        />
      )}

      {overview.dire > 0 && (
        <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3">
          <p className="text-xs font-semibold text-[var(--danger)]">
            {overview.dire} emergency {overview.dire === 1 ? 'case needs' : 'cases need'} attention
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
          >
            <div className="text-xs text-[var(--text-secondary)]">{k.label}</div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-bold tabular-nums tracking-tight">
                {k.value}
              </span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-3 text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
          Recent leads
        </h2>

        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-10 text-center">
            <p className="text-xs text-[var(--text-muted)]">No leads yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-raised)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                  <th className="px-4 py-2.5 text-right font-medium">AI replies</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {recent.map((c) => (
                  <tr key={c.id} className="bg-[var(--bg-surface)]">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{c.full_name ?? '—'}</div>
                      <div className="font-mono text-[10px] text-[var(--text-muted)]">
                        {c.phone_number ?? 'no phone'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                      {c.pipeline_stage.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {dkk(c.estimated_value_dkk, 'da-DK')}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={
                          c.ai_auto_reply_enabled
                            ? 'text-[var(--success)]'
                            : 'text-[var(--warning)]'
                        }
                      >
                        {c.ai_auto_reply_enabled ? 'on' : 'paused'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
