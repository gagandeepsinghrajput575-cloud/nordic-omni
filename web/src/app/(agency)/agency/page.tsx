import Link from 'next/link';
import { AlertTriangle, ArrowRight, Building2, Plus } from 'lucide-react';
import { requireAgency } from '@/lib/auth/guard';
import { listTenants } from '@/lib/db/queries';
import { Badge, Card, Stat, StatGroup } from '@/components/ui/core';
import { Avatar, EmptyState, PageHeader, SectionTitle } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Portfolio' };
const dkk = (value: number) => value.toLocaleString('da-DK', { maximumFractionDigits: 0 });

export default async function AgencyPortfolioPage() {
  const session = await requireAgency();
  const tenants = await listTenants(session.userId);
  const totalPipeline = tenants.reduce((sum, tenant) => sum + tenant.pipeline_dkk, 0);
  const totalContacts = tenants.reduce((sum, tenant) => sum + tenant.contact_count, 0);
  const totalCalls = tenants.reduce((sum, tenant) => sum + tenant.call_count, 0);
  const totalDire = tenants.reduce((sum, tenant) => sum + tenant.open_dire, 0);

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Agency console" title="Your portfolio" description="The businesses you operate, their customer pipelines and the conversations that need a human touch." actions={<Link href="/agency/clients/new" className={buttonClass('primary')}><Plus size={15} />New client</Link>} />
      {totalDire > 0 ? <div className="notice notice-danger items-center"><AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden /><p className="flex-1 text-[13px] font-medium">{totalDire} open {totalDire === 1 ? 'emergency needs' : 'emergencies need'} attention across your portfolio.</p><Link href="/agency/clients" className={buttonClass('ghost', 'sm', 'text-[var(--danger)]')}>Review clients<ArrowRight size={13} /></Link></div> : null}
      <StatGroup>
        <Stat label="Managed pipeline" value={dkk(totalPipeline)} unit="DKK" hint="Across all client workspaces" />
        <Stat label="Workspaces" value={tenants.length} unit={tenants.length === 1 ? 'client' : 'clients'} hint={`${tenants.filter((tenant) => tenant.status === 'active').length} active`} />
        <Stat label="Callers" value={totalContacts} unit="total" hint="Across your portfolio" />
        <Stat label="Calls handled" value={totalCalls} unit={totalCalls === 1 ? 'session' : 'sessions'} hint="Recorded call sessions" />
      </StatGroup>
      <section>
        <SectionTitle action={<Link href="/agency/clients" className={buttonClass('ghost', 'sm')}>All clients<ArrowRight size={13} aria-hidden /></Link>}>Your workspaces</SectionTitle>
        {tenants.length === 0 ? <Card><EmptyState icon={<Building2 size={20} />} title="Ready for your first client" description="Create a client workspace with an AI receptionist, a private portal and a customer pipeline in one step." action={<Link href="/agency/clients/new" className={buttonClass('primary')}><Plus size={15} />Create a client</Link>} /></Card> : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {tenants.map((tenant) => (
              <Link key={tenant.id} href={`/agency/clients/${tenant.id}`} className="group block min-w-0 rounded-xl">
                <Card interactive className="h-full p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3"><Avatar name={tenant.name} size={42} /><div className="min-w-0"><h3 className="truncate text-[15px] font-semibold tracking-[-0.025em]">{tenant.name}</h3><p className="mt-1 text-[12px] text-[var(--muted)]">/{tenant.slug} · {tenant.default_language === 'da-DK' ? 'Dansk' : 'English'}</p></div></div>
                    <Badge tone={tenant.status === 'active' ? 'success' : 'warning'} dot>{tenant.status === 'active' ? 'Active' : tenant.status}</Badge>
                  </div>
                  <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-[var(--line)] pt-4">
                    <div><dt className="text-[12px] text-[var(--muted)]">Callers</dt><dd className="mt-1.5 text-[21px] font-medium tabular-nums tracking-[-0.03em]">{tenant.contact_count}</dd></div>
                    <div><dt className="text-[12px] text-[var(--muted)]">Pipeline · DKK</dt><dd className="mt-1.5 text-[21px] font-medium tabular-nums tracking-[-0.03em]">{dkk(tenant.pipeline_dkk)}</dd></div>
                    <div><dt className="text-[12px] text-[var(--muted)]">Calls</dt><dd className="mt-1.5 text-[21px] font-medium tabular-nums tracking-[-0.03em]">{tenant.call_count}</dd></div>
                  </dl>
                  <div className="mt-5 flex items-center justify-between gap-3"><span className="text-[12px] text-[var(--muted)]">{tenant.open_dire > 0 ? <span className="flex items-center gap-1.5 text-[var(--danger)]"><AlertTriangle size={13} />{tenant.open_dire} open {tenant.open_dire === 1 ? 'emergency' : 'emergencies'}</span> : 'No open emergencies'}</span><span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Open workspace<ArrowRight size={14} className="transition-transform group-hover:translate-x-1" aria-hidden /></span></div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
      <p className="text-[12px] text-[var(--muted)]">Figures reflect the current workspace records and refresh when you open this page.</p>
    </div>
  );
}
