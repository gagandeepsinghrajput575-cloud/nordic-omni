'use client';

import { useActionState } from 'react';
import { saveFactsAction } from './actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card, CardHeader } from '@/components/ui/core';
import { Field, Input, Textarea, FormAlert } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function BusinessDetailsForm({
  isDanish,
  ownerName,
  ownerPhone,
  ownerEmail,
  broadcast,
}: {
  isDanish: boolean;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  broadcast: string;
}) {
  const [state, formAction] = useActionState(saveFactsAction, EMPTY_STATE);
  const err = (f: string) => (state.field === f ? state.error : undefined);

  return (
    <Card>
      <CardHeader
        title={isDanish ? 'Virksomhed og ejer' : 'Business and owner'}
        hint={
          isDanish
            ? 'Bruges når AI’en skal sende en sag videre til et menneske.'
            : 'Used when the AI hands a case to a human.'
        }
      />
      <form action={formAction} className="space-y-4 p-5">
        {state.error && !state.field ? <FormAlert tone="error">{state.error}</FormAlert> : null}
        {state.ok && state.message ? <FormAlert tone="success">{state.message}</FormAlert> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field htmlFor="ownerName" label={isDanish ? 'Ejer' : 'Owner'} required error={err('ownerName')}>
            <Input id="ownerName" name="ownerName" defaultValue={ownerName} invalid={Boolean(err('ownerName'))} />
          </Field>
          <Field htmlFor="ownerPhone" label={isDanish ? 'Telefon' : 'Phone'} hint="+45 …">
            <Input id="ownerPhone" name="ownerPhone" inputMode="tel" defaultValue={ownerPhone} />
          </Field>
          <Field htmlFor="ownerEmail" label="Email" error={err('ownerEmail')} className="sm:col-span-2">
            <Input
              id="ownerEmail"
              name="ownerEmail"
              type="email"
              defaultValue={ownerEmail}
              invalid={Boolean(err('ownerEmail'))}
            />
          </Field>
        </div>

        <Field
          htmlFor="broadcast"
          label={isDanish ? 'Driftsmeddelelse' : 'Operational notice'}
          hint={isDanish ? 'Læses højt af AI’en' : 'Read out by the AI'}
        >
          <Textarea
            id="broadcast"
            name="broadcast"
            rows={3}
            defaultValue={broadcast}
            placeholder={
              isDanish
                ? 'Fx: Vi har ekstra åbent i uge 42. Akutte sager går altid foran.'
                : 'e.g. We have extended hours in week 42. Emergencies always come first.'
            }
          />
        </Field>

        {/* Broadcast has an explicit clear path: empty textarea means "no notice". */}
        <p className="text-[10px] text-[var(--text-muted)]">
          {isDanish
            ? 'Lad feltet stå tomt for at fjerne meddelelsen.'
            : 'Leave the field empty to remove the notice.'}
        </p>

        <SubmitButton pendingLabel={isDanish ? 'Gemmer…' : 'Saving…'}>
          {isDanish ? 'Gem' : 'Save'}
        </SubmitButton>
      </form>
    </Card>
  );
}
