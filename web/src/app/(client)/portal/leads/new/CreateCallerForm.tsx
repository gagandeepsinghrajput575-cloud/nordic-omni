'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { createCallerAction } from '@/app/(client)/portal/leads/actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card } from '@/components/ui/core';
import { Field, Input, Select, Textarea, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

const STAGES = [
  ['new_lead', 'New lead'],
  ['contact_made', 'Contact made'],
  ['quote_sent', 'Quote sent'],
  ['booked', 'Booked'],
  ['completed', 'Completed'],
  ['closed_lost', 'Closed lost'],
] as const;

export function CreateCallerForm({ isDanish }: { isDanish: boolean }) {
  const [state, formAction] = useActionState(createCallerAction, EMPTY_STATE);

  const err = (f: string) => (state.field === f ? state.error : undefined);

  return (
    <form action={formAction} className="space-y-5">
      {state.error && !state.field ? <FormAlert tone="error">{state.error}</FormAlert> : null}

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            htmlFor="fullName"
            label="Full name"
            required
            error={err('fullName')}
            className="sm:col-span-2"
          >
            <Input
              id="fullName"
              name="fullName"
              autoComplete="name"
              placeholder={isDanish ? 'fx Morten Bondo' : 'e.g. Morten Bondo'}
              invalid={Boolean(err('fullName'))}
              required
            />
          </Field>

          <Field
            htmlFor="phoneNumber"
            label="Phone"
            hint="+45 …"
            error={err('phoneNumber')}
          >
            <Input
              id="phoneNumber"
              name="phoneNumber"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+45 20 12 34 56"
              invalid={Boolean(err('phoneNumber'))}
            />
          </Field>

          <Field htmlFor="email" label="Email" error={err('email')}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="navn@firma.dk"
              invalid={Boolean(err('email'))}
            />
          </Field>

          <Field htmlFor="preferredLanguage" label="Language">
            <Select id="preferredLanguage" name="preferredLanguage" defaultValue="da">
              <option value="da">Dansk</option>
              <option value="en">English</option>
            </Select>
          </Field>

          <Field htmlFor="pipelineStage" label="Starting stage">
            <Select id="pipelineStage" name="pipelineStage" defaultValue="new_lead">
              {STAGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field htmlFor="leadScore" label="Lead score" hint="0–100">
            <Input
              id="leadScore"
              name="leadScore"
              type="number"
              min={0}
              max={100}
              defaultValue={50}
            />
          </Field>

          <Field htmlFor="estimatedValueDkk" label="Estimated value" hint="DKK">
            <Input
              id="estimatedValueDkk"
              name="estimatedValueDkk"
              type="number"
              min={0}
              step={100}
              defaultValue={0}
            />
          </Field>

          <Field
            htmlFor="summary"
            label="What we know"
            hint="The agent reads this before it speaks"
            className="sm:col-span-2"
          >
            <Textarea
              id="summary"
              name="summary"
              rows={3}
              placeholder={
                isDanish
                  ? 'Fx: har et utæt hovedrør i kælderen, ringede sidst i marts.'
                  : 'e.g. leaky pipe in the basement, called last March.'
              }
            />
          </Field>
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <SubmitButton pendingLabel="Creating…">Create caller</SubmitButton>
        <Link href="/portal/leads" className={buttonClass('ghost')}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
