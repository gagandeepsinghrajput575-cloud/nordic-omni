import Link from 'next/link';
import { Building2, Plus } from 'lucide-react';
import { requireAgency } from '@/lib/auth/guard';
import { listTenants } from '@/lib/db/queries';
import { Badge, Card } from '@/components/ui/core';
import { EmptyState, PageHeader } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';

export const dynamic = 'force-dynamic';

const dkk = (n: number) => n.toLocaleString('da-DK', { maximumFractionDigits: 0 });

export default async function AgencyClientsPage() {
  const session = await requireAgency();
  const tenants = await listTenants(session.userId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agency"
        title="Clients"
        description="Every workspace you operate. Open one to edit its AI behaviour, facts, knowledge and access."
        actions={
          <Link href="/agency/clients/new" className={buttonClass('primary', 'md')}>
            <Plus size={14} />
            New client
          </Link>
        }
      />

      <Card className="overflow-hidden">
        {tenants.length === 0 ? (
          <EmptyState
            icon={<Building2 size={18} />}
            title="No workspaces yet"
            description="Create your first client workspace. It gets its own AI receptionist, portal and pipeline in one step."
            action={
              <Link href="/agency/clients/new" className={buttonClass('primary', 'md')}>
                <Plus size={14} />
                Create the first client
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Workspace</th>
                  <th className="px-3 py-2.5 font-medium">Language</th>
                  <th className="px-3 py-2.5 text-right font-medium">Callers</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pipeline</th>
                  <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                  <th className="px-3 py-2.5 text-right font-medium">Open dire</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {tenants.map((t) => (
                  <tr
                    key={t.id}
                    className="group transition-colors hover:bg-[var(--bg-raised)]/50"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--text-primary)]">{t.name}</span>
                        {t.status !== 'active' ? (
                          <Badge tone="warning">{t.status}</Badge>
                        ) : null}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--text-muted)]">
                        /{t.slug}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone="neutral">
                        {t.default_language === 'da-DK' ? 'Dansk' : 'English'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {t.contact_count}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {dkk(t.pipeline_dkk)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{t.call_count}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {t.open_dire > 0 ? (
                        <span className="text-[var(--danger)]">{t.open_dire}</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">0</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/agency/clients/${t.id}`}
                        className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-primary)]"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

