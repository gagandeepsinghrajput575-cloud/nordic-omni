import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Users, Plus, Search } from 'lucide-react';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts, listContacts } from '@/lib/db/queries';
import { Card, StagePill } from '@/components/ui/core';
import { Avatar, EmptyState, PageHeader, ScoreBar } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';

export const dynamic = 'force-dynamic';

const dkk = (n: number) =>
  n.toLocaleString('da-DK', { maximumFractionDigits: 0 });

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isDanish ? 'Kunder' : 'Callers'}
        title={isDanish ? 'Dine kunder' : 'Your callers'}
        description={
          isDanish
            ? `${contacts.length} kunde${contacts.length === 1 ? '' : 'r'} i dette arbejdsrum. Klik for at se samtalen og flytte dem i pipelinen.`
            : `${contacts.length} caller${contacts.length === 1 ? '' : 's'} in this workspace. Open one to see the conversation and move them through the pipeline.`
        }
        actions={
          <Link href="/portal/leads/new" className={buttonClass('primary', 'md')}>
            <Plus size={14} />
            {isDanish ? 'Ny kunde' : 'New caller'}
          </Link>
        }
      />

      <Card className="overflow-hidden">
        {contacts.length === 0 ? (
          <EmptyState
            icon={<Users size={18} />}
            title={isDanish ? 'Ingen kunder endnu' : 'No callers yet'}
            description={
              isDanish
                ? 'Opret din første kunde, eller lad webhooken fra WhatsApp oprette dem automatisk, når den er sat op.'
                : 'Create your first caller, or let the WhatsApp webhook create them automatically once it is wired up.'
            }
            action={
              <Link href="/portal/leads/new" className={buttonClass('primary', 'md')}>
                <Plus size={14} />
                {isDanish ? 'Opret kunde' : 'Create caller'}
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-medium">{isDanish ? 'Kunde' : 'Caller'}</th>
                  <th className="px-3 py-2.5 font-medium">{isDanish ? 'Stadie' : 'Stage'}</th>
                  <th className="px-3 py-2.5 font-medium">Score</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {isDanish ? 'Værdi' : 'Value'}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">AI</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {contacts.map((c) => (
                  <tr
                    key={c.id}
                    className="group transition-colors hover:bg-[var(--bg-raised)]/50"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.full_name} size={30} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-[var(--text-primary)]">
                            {c.full_name ?? '—'}
                          </div>
                          <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                            {c.phone_number ?? c.email ?? 'no contact detail'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StagePill stage={c.pipeline_stage} danish={isDanish} />
                    </td>
                    <td className="px-3 py-3">
                      <ScoreBar score={c.lead_score} />
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {dkk(c.estimated_value_dkk)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span
                        className={
                          c.ai_auto_reply_enabled
                            ? 'font-mono text-[10px] uppercase text-[var(--success)]'
                            : 'font-mono text-[10px] uppercase text-[var(--warning)]'
                        }
                      >
                        {c.ai_auto_reply_enabled ? 'on' : 'paused'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/portal/leads/${c.id}`}
                        className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-primary)]"
                      >
                        {isDanish ? 'Åbn' : 'Open'} →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {contacts.length === 0 ? null : (
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <Search size={12} />
          {isDanish
            ? 'Søgning og filtre kommer sammen med pipelinen.'
            : 'Search and filters arrive with the pipeline view.'}
        </p>
      )}
    </div>
  );
}

