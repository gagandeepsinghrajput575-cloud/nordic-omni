'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus, Search, SearchX, Users } from 'lucide-react';
import type { ContactRow } from '@/lib/db/queries';
import { STAGES } from '@/lib/pipeline';
import { Badge, Card, StagePill } from '@/components/ui/core';
import { Avatar, EmptyState, ScoreBar } from '@/components/ui/feedback';
import { buttonClass, Input, Select } from '@/components/ui/form';

const dkk = (value: number) => value.toLocaleString('da-DK', { maximumFractionDigits: 0 });

export function CallerDirectory({ contacts, isDanish }: { contacts: ContactRow[]; isDanish: boolean }) {
  const id = useId();
  const t = (da: string, en: string) => isDanish ? da : en;
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [ai, setAi] = useState('all');
  const filtered = useMemo(() => contacts.filter((contact) => {
    const matchesQuery = `${contact.full_name ?? ''} ${contact.phone_number ?? ''} ${contact.email ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesQuery && (stage === 'all' || contact.pipeline_stage === stage) && (ai === 'all' || contact.ai_auto_reply_enabled === (ai === 'on'));
  }), [contacts, query, stage, ai]);
  const clear = () => { setQuery(''); setStage('all'); setAi('all'); };

  if (!contacts.length) return <Card><EmptyState icon={<Users size={20} />} title={t('Ingen kunder endnu', 'No callers yet')} description={t('Opret din første kunde for at komme i gang med samtaler og opfølgning.', 'Create your first caller to start tracking conversations and follow-ups.')} action={<Link href="/portal/leads/new" className={buttonClass('primary')}><Plus size={15} />{t('Opret kunde', 'Create caller')}</Link>} /></Card>;

  return (
    <Card className="overflow-hidden">
      <div className="table-toolbar">
        <div className="table-search"><Search size={16} aria-hidden /><label htmlFor={`${id}-search`} className="sr-only">{t('Søg blandt kunder', 'Search callers')}</label><Input id={`${id}-search`} type="search" placeholder={t('Søg navn, telefon eller email…', 'Search name, phone or email…')} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <label htmlFor={`${id}-stage`} className="sr-only">{t('Filtrér på stadie', 'Filter by stage')}</label>
        <Select id={`${id}-stage`} value={stage} onChange={(event) => setStage(event.target.value)} className="w-auto min-w-32"><option value="all">{t('Alle stadier', 'All stages')}</option>{STAGES.map(([value, da, en]) => <option key={value} value={value}>{t(da, en)}</option>)}</Select>
        <label htmlFor={`${id}-ai`} className="sr-only">{t('Filtrér på AI-svar', 'Filter by AI replies')}</label>
        <Select id={`${id}-ai`} value={ai} onChange={(event) => setAi(event.target.value)} className="w-auto min-w-28"><option value="all">{t('Alt AI', 'All AI states')}</option><option value="on">{t('AI slået til', 'AI enabled')}</option><option value="paused">{t('AI sat på pause', 'AI paused')}</option></Select>
      </div>
      {filtered.length === 0 ? <EmptyState compact icon={<SearchX size={20} />} title={t('Ingen matchende kunder', 'No matching callers')} description={t('Prøv en anden søgning, eller nulstil filtrene.', 'Try another search, or clear your filters.')} action={<button type="button" onClick={clear} className={buttonClass('secondary', 'sm')}>{t('Nulstil filtre', 'Clear filters')}</button>} /> : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <caption className="sr-only">{t('Kunder', 'Callers')}, {filtered.length} {t('matchende resultater', 'matching results')}</caption>
            <thead><tr><th scope="col">{t('Kunde', 'Caller')}</th><th scope="col">{t('Stadie', 'Stage')}</th><th scope="col">{t('Score', 'Score')}</th><th scope="col" className="num">{t('Værdi · DKK', 'Value · DKK')}</th><th scope="col">{t('AI-svar', 'AI replies')}</th><th scope="col"><span className="sr-only">{t('Åbn kunde', 'Open caller')}</span></th></tr></thead>
            <tbody>{filtered.map((contact) => (
              <tr key={contact.id}>
                <td><div className="flex min-w-0 items-center gap-3"><Avatar name={contact.full_name} size={36} /><div className="min-w-0"><Link href={`/portal/leads/${contact.id}`} className="block max-w-60 truncate text-[13px] font-semibold hover:underline">{contact.full_name || t('Unavngivet kunde', 'Unnamed caller')}</Link><p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{contact.phone_number || contact.email || t('Ingen kontaktoplysninger', 'No contact details')}</p></div></div></td>
                <td data-label={t('Stadie', 'Stage')}><StagePill stage={contact.pipeline_stage} danish={isDanish} /></td>
                <td data-label={t('Score', 'Score')}><ScoreBar score={contact.lead_score} /></td>
                <td className="num font-medium" data-label={t('Værdi · DKK', 'Value · DKK')}>{dkk(contact.estimated_value_dkk)}</td>
                <td data-label={t('AI-svar', 'AI replies')}><Badge tone={contact.ai_auto_reply_enabled ? 'success' : 'warning'} dot>{contact.ai_auto_reply_enabled ? t('Slået til', 'Enabled') : t('Pauset', 'Paused')}</Badge></td>
                <td><Link href={`/portal/leads/${contact.id}`} className={buttonClass('ghost', 'sm')} aria-label={`${t('Åbn', 'Open')} ${contact.full_name || t('kunde', 'caller')}`}><span className="hidden sm:inline">{t('Åbn', 'Open')}</span><ArrowRight size={14} aria-hidden /></Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="table-footer"><span aria-live="polite">{filtered.length} {t('af', 'of')} {contacts.length} {t('indlæste kunder', 'loaded callers')}</span>{query || stage !== 'all' || ai !== 'all' ? <button type="button" onClick={clear} className="font-medium text-[var(--text-secondary)] hover:underline">{t('Nulstil filtre', 'Clear filters')}</button> : <span>{t('Værdi i DKK', 'Value in DKK')}</span>}</div>
      {contacts.length >= 200 ? <p className="border-t border-[var(--line)] px-5 py-3 text-[12px] text-[var(--muted)]">{t('De 200 senest opdaterede kunder vises.', 'The 200 most recently updated callers are shown.')}</p> : null}
    </Card>
  );
}
