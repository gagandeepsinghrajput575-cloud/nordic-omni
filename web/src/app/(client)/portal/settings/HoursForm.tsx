'use client';

import { useActionState } from 'react';
import { saveHoursAction } from './actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card, CardHeader } from '@/components/ui/core';
import { Input, FormAlert } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

const DAYS: Array<[string, string, string]> = [
  ['mon', 'Mandag', 'Monday'], ['tue', 'Tirsdag', 'Tuesday'], ['wed', 'Onsdag', 'Wednesday'],
  ['thu', 'Torsdag', 'Thursday'], ['fri', 'Fredag', 'Friday'], ['sat', 'Lørdag', 'Saturday'], ['sun', 'Søndag', 'Sunday'],
];
export interface HoursValue { open: string; close: string; closed: boolean }

export function HoursForm({ isDanish, hours }: { isDanish: boolean; hours: Record<string, HoursValue> }) {
  const [state, formAction] = useActionState(saveHoursAction, EMPTY_STATE);
  const t = (da: string, en: string) => isDanish ? da : en;
  return (
    <Card>
      <CardHeader title={t('Åbningstider', 'Opening hours')} hint={t('AI’en bruger disse timer til at svare på, om I har åbent.', 'The AI uses these hours to tell callers whether you are open.')} />
      <form action={formAction}>
        {(state.error || state.message) ? <div className="px-5 pt-4"><FormAlert tone={state.error ? 'error' : 'success'}>{state.error || state.message}</FormAlert></div> : null}
        <div className="divide-y divide-[var(--line)]">{DAYS.map(([key, da, en]) => {
          const day = hours[key] ?? { open: '08:00', close: '16:00', closed: key === 'sun' };
          return <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-3 sm:grid-cols-[110px_90px_1fr]"><span className="text-[13px] font-medium text-[var(--text-secondary)]">{t(da, en)}</span><label className="flex min-h-8 cursor-pointer items-center gap-2"><input type="checkbox" name={`${key}_closed`} defaultChecked={day.closed} /><span className="text-[12px] text-[var(--muted)]">{t('Lukket', 'Closed')}</span></label><div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:justify-end"><Input type="time" name={`${key}_open`} defaultValue={day.open} aria-label={`${t(da, en)} ${t('åbner', 'opens')}`} className="w-[110px] tabular-nums sm:w-[116px]" /><span className="text-[12px] text-[var(--muted)]" aria-hidden>–</span><Input type="time" name={`${key}_close`} defaultValue={day.close} aria-label={`${t(da, en)} ${t('lukker', 'closes')}`} className="w-[110px] tabular-nums sm:w-[116px]" /></div></div>;
        })}</div>
        <div className="form-footer"><SubmitButton pendingLabel={t('Gemmer…', 'Saving…')}>{t('Gem åbningstider', 'Save hours')}</SubmitButton></div>
      </form>
    </Card>
  );
}
