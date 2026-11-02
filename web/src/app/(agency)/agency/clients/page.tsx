import Link from 'next/link';
import { requireAgency } from '@/lib/auth/guard';
import { listTenants } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export default async function AgencyClientsPage() {
  const session = await requireAgency();
  const tenants = await listTenants(session.userId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Clients</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Open a workspace to edit its AI behaviour, facts and access.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--bg-raised)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-2.5 font-medium">Workspace</th>
              <th className="px-4 py-2.5 font-medium">Language</th>
              <th className="px-4 py-2.5 text-right font-medium">Leads</th>
              <th className="px-4 py-2.5 text-right font-medium">Pipeline (DKK)</th>
              <th className="px-4 py-2.5 text-right font-medium">Calls</th>
              <th className="px-4 py-2.5 text-right font-medium">Emergencies</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {tenants.map((t) => (
              <tr key={t.id} className="bg-[var(--bg-surface)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{t.name}</div>
                  <div className="font-mono text-[10px] text-[var(--text-muted)]">/{t.slug}</div>
                </td>
                <td className="px-4 py-3 font-mono text-[10px] uppercase text-[var(--text-secondary)]">
                  {t.default_language}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{t.contact_count}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {t.pipeline_dkk.toLocaleString('da-DK', { maximumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{t.call_count}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {t.open_dire > 0 ? (
                    <span className="text-[var(--danger)]">{t.open_dire}</span>
                  ) : (
                    <span className="text-[var(--text-muted)]">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/agency/clients/${t.id}`}
                    className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {tenants.length === 0 && (
          <div className="bg-[var(--bg-surface)] px-4 py-10 text-center">
            <p className="text-xs text-[var(--text-muted)]">
              No tenants yet. Provisioning arrives in the next milestone.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
