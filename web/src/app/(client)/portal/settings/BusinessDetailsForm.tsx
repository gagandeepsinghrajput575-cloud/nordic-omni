'use client';

import { useActionState } from 'react';
import { saveFactsAction } from './actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card, CardHeader } from '@/components/ui/core';
import { Field, Input, Textarea, FormAlert } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function BusinessDetailsForm({ isDanish, ownerName, ownerPhone, ownerEmail, broadcast }: {
  isDanish: boolean; ownerName: string; ownerPhone: string; ownerEmail: string; broadcast: string;
}) {
  const [state, formAction] = useActionState(saveFactsAction, EMPTY_STATE);
  const err = (field: string) => state.field === field ? state.error : undefined;
  const t = (da: string, en: string) => isDanish ? da : en;
  return (
    <Card>
      <CardHeader title={t('Virksomhed og ejer', 'Business and owner')} hint={t('Bruges når AI’en skal sende en sag videre til et menneske.', 'Used when the AI hands a case to a person.')} />
      <form action={formAction}>
        <div className="space-y-5 p-5">
          {state.error && !state.field ? <FormAlert tone="error">{state.error}</FormAlert> : null}
          {state.ok && state.message ? <FormAlert tone="success">{state.message}</FormAlert> : null}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field htmlFor="ownerName" label={t('Ejer', 'Owner')} required error={err('ownerName')}><Input id="ownerName" name="ownerName" autoComplete="name" defaultValue={ownerName} required /></Field>
            <Field htmlFor="ownerPhone" label={t('Telefon', 'Phone')} hint="+45 …"><Input id="ownerPhone" name="ownerPhone" type="tel" autoComplete="tel" defaultValue={ownerPhone} /></Field>
            <Field htmlFor="ownerEmail" label="Email" error={err('ownerEmail')} className="sm:col-span-2"><Input id="ownerEmail" name="ownerEmail" type="email" autoComplete="email" defaultValue={ownerEmail} /></Field>
          </div>
          <Field htmlFor="broadcast" label={t('Driftsmeddelelse', 'Operational notice')} hint={t('Læses højt af AI’en', 'Read out by the AI')}><Textarea id="broadcast" name="broadcast" rows={3} defaultValue={broadcast} placeholder={t('Fx: Vi har ekstra åbent i uge 42. Akutte sager går altid foran.', 'e.g. We have extended hours in week 42. Emergencies always come first.')} /></Field>
          <p className="text-[12px] text-[var(--muted)]">{t('Lad feltet stå tomt for at fjerne meddelelsen.', 'Leave the field empty to remove the notice.')}</p>
        </div>
        <div className="form-footer"><SubmitButton pendingLabel={t('Gemmer…', 'Saving…')}>{t('Gem oplysninger', 'Save details')}</SubmitButton></div>
      </form>
    </Card>
  );
}
