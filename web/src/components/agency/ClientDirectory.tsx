'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Building2, Plus, Search, SearchX } from 'lucide-react';
import type { TenantSummary } from '@/lib/db/queries';
import { Badge, Card } from '@/components/ui/core';
import { Avatar, EmptyState } from '@/components/ui/feedback';
import { buttonClass, Input, Select } from '@/components/ui/form';

const dkk = (value: number) => value.toLocaleString('da-DK', { maximumFractionDigits: 0 });

export function ClientDirectory({ tenants }: { tenants: TenantSummary[] }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const filtered = useMemo(() => tenants.filter((tenant) => {
    const matchesQuery = `${tenant.name} ${tenant.slug}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesQuery && (status === 'all' || tenant.status === status);
  }), [tenants, query, status]);
  const clear = () => { setQuery(''); setStatus('all'); };

  if (!tenants.length) return <Card><EmptyState icon={<Building2 size={20} />} title="Your first client starts here" description="Create a business workspace with its own AI receptionist, customer portal and pipeline." action={<Link href="/agency/clients/new" className={buttonClass('primary')}><Plus size={15} />Create a client</Link>} /></Card>;

  return (
    <Card className="overflow-hidden">
      <div className="table-toolbar">
        <div className="table-search"><Search size={16} aria-hidden /><label htmlFor={`${id}-search`} className="sr-only">Search workspaces</label><Input id={`${id}-search`} type="search" placeholder="Search workspaces…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <label htmlFor={`${id}-status`} className="sr-only">Workspace status</label>
        <Select id={`${id}-status`} value={status} onChange={(event) => setStatus(event.target.value)} className="w-auto min-w-36"><option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></Select>
        {query || status !== 'all' ? <button type="button" onClick={clear} className={buttonClass('ghost', 'sm')}>Clear filters</button> : null}
      </div>
      {filtered.length === 0 ? <EmptyState compact icon={<SearchX size={20} />} title="No matching workspaces" description="Try another name or clear the status filter." action={<button type="button" onClick={clear} className={buttonClass('secondary', 'sm')}>Clear filters</button>} /> : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <caption className="sr-only">Client workspaces, {filtered.length} matching results</caption>
            <thead><tr><th scope="col">Workspace</th><th scope="col">Language</th><th scope="col" className="num">Callers</th><th scope="col" className="num">Pipeline · DKK</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Emergencies</th><th scope="col"><span className="sr-only">Open workspace</span></th></tr></thead>
            <tbody>{filtered.map((tenant) => (
              <tr key={tenant.id}>
                <td><div className="flex min-w-0 items-center gap-3"><Avatar name={tenant.name} size={36} /><div className="min-w-0"><Link href={`/agency/clients/${tenant.id}`} className="block max-w-64 truncate text-[13px] font-semibold hover:underline">{tenant.name}</Link><div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted)]"><span className="truncate">/{tenant.slug}</span>{tenant.status !== 'active' ? <Badge tone="warning">{tenant.status}</Badge> : null}</div></div></div></td>
                <td data-label="Language"><Badge tone="neutral">{tenant.default_language === 'da-DK' ? 'Dansk' : 'English'}</Badge></td>
                <td className="num" data-label="Callers">{tenant.contact_count}</td>
                <td className="num font-medium" data-label="Pipeline · DKK">{dkk(tenant.pipeline_dkk)}</td>
                <td className="num" data-label="Calls">{tenant.call_count}</td>
                <td className="num" data-label="Emergencies">{tenant.open_dire > 0 ? <Badge tone="danger">{tenant.open_dire} open</Badge> : <span className="text-[var(--muted)]">0</span>}</td>
                <td><Link href={`/agency/clients/${tenant.id}`} className={buttonClass('ghost', 'sm')} aria-label={`Open ${tenant.name}`}>Open<ArrowRight size={13} aria-hidden /></Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="table-footer"><span aria-live="polite">{filtered.length} of {tenants.length} workspaces</span><span>Pipeline in DKK</span></div>
    </Card>
  );
}
