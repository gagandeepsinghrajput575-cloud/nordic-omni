'use client';

import { useActionState } from 'react';
import { saveHoursAction } from './actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card, CardHeader } from '@/components/ui/core';
import { Input, FormAlert } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

const DAYS: Array<[string, string, string]> = [
  ['mon', 'Mandag', 'Monday'],
  ['tue', 'Tirsdag', 'Tuesday'],
  ['wed', 'Onsdag', 'Wednesday'],
  ['thu', 'Torsdag', 'Thursday'],
  ['fri', 'Fredag', 'Friday'],
  ['sat', 'Lørdag', 'Saturday'],
  ['sun', 'Søndag', 'Sunday'],
];

export interface HoursValue {
  open: string;
  close: string;
  closed: boolean;
}

export function HoursForm({
  isDanish,
  hours,
}: {
  isDanish: boolean;
  hours: Record<string, HoursValue>;
}) {
  const [state, formAction] = useActionState(saveHoursAction, EMPTY_STATE);

  return (
    <Card>
      <CardHeader
        title={isDanish ? 'Åbningstider' : 'Opening hours'}
        hint={
          isDanish
            ? 'AI’en regner selv ud, om I har åbent lige nu.'
            : 'The AI works out for itself whether you are open right now.'
        }
      />
      <form action={formAction}>
        {state.error ? (
          <div className="px-5 pt-4">
            <FormAlert tone="error">{state.error}</FormAlert>
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div className="px-5 pt-4">
            <FormAlert tone="success">{state.message}</FormAlert>
          </div>
        ) : null}

        <div className="divide-y divide-[var(--border-subtle)]">
          {DAYS.map(([key, da, en]) => {
            const day = hours[key] ?? { open: '08:00', close: '16:00', closed: key === 'sun' };
            return (
              <div key={key} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <span className="w-20 shrink-0 text-[11px] font-medium text-[var(--text-secondary)]">
                  {isDanish ? da : en}
                </span>

                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    name={`${key}_closed`}
                    defaultChecked={day.closed}
                    className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
                  />
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {isDanish ? 'Lukket' : 'Closed'}
                  </span>
                </label>

                <div className="ml-auto flex items-center gap-1.5">
                  <Input
                    type="time"
                    name={`${key}_open`}
                    defaultValue={day.open}
                    aria-label={`${isDanish ? da : en} ${isDanish ? 'åbner' : 'opens'}`}
                    className="w-[104px] py-1 font-mono text-[11px]"
                  />
                  <span className="text-[10px] text-[var(--text-muted)]">–</span>
                  <Input
                    type="time"
                    name={`${key}_close`}
                    defaultValue={day.close}
                    aria-label={`${isDanish ? da : en} ${isDanish ? 'lukker' : 'closes'}`}
                    className="w-[104px] py-1 font-mono text-[11px]"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-[var(--border-subtle)] p-5">
          <SubmitButton pendingLabel={isDanish ? 'Gemmer…' : 'Saving…'}>
            {isDanish ? 'Gem åbningstider' : 'Save hours'}
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}
