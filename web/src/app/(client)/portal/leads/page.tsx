import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { listContacts } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export default async function PortalLeadsPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  const contacts = await listContacts(session.userId, tenantId, 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {contacts.length} contact{contacts.length === 1 ? '' : 's'} in this workspace.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--bg-raised)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Stage</th>
              <th className="px-4 py-2.5 text-right font-medium">Score</th>
              <th className="px-4 py-2.5 text-right font-medium">Value (DKK)</th>
              <th className="px-4 py-2.5 text-right font-medium">AI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {contacts.map((c) => (
              <tr key={c.id} className="bg-[var(--bg-surface)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{c.full_name ?? '—'}</div>
                  <div className="max-w-md truncate text-[10px] text-[var(--text-muted)]">
                    {c.shared_memory_summary || '—'}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                  {c.pipeline_stage.replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{c.lead_score}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {c.estimated_value_dkk.toLocaleString('da-DK', { maximumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-3 text-right">
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

        {contacts.length === 0 && (
          <div className="bg-[var(--bg-surface)] px-4 py-10 text-center">
            <p className="text-xs text-[var(--text-muted)]">No leads yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
