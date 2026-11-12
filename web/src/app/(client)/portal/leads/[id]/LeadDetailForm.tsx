'use client';

import { useActionState } from 'react';
import { updateCallerAction, closeCallerAction } from '@/app/(client)/portal/leads/actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card, CardHeader } from '@/components/ui/core';
import { Field, Input, Select, Textarea, FormAlert } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

const STAGES = [
  ['new_lead', 'Ny kunde', 'New lead'],
  ['contacted', 'Kontaktet', 'Contacted'],
  ['qualified', 'Kvalificeret', 'Qualified'],
  ['booked', 'Booket', 'Booked'],
  ['dire_escalated', 'Akut', 'Emergency'],
  ['closed_won', 'Vundet', 'Won'],
  ['closed_lost', 'Tabt', 'Lost'],
] as const;

export function LeadDetailForm({
  contactId,
  isDanish,
  defaultStage,
  defaultScore,
  defaultValue,
  defaultSummary,
  autoReply,
}: {
  contactId: string;
  isDanish: boolean;
  defaultStage: string;
  defaultScore: number;
  defaultValue: number;
  defaultSummary: string;
  autoReply: boolean;
}) {
  const [state, formAction] = useActionState(updateCallerAction, EMPTY_STATE);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={isDanish ? 'Pipeline' : 'Pipeline'}
          hint={
            isDanish
              ? 'Flyt kunden, og justér hvad opkaldet er værd.'
              : 'Move the caller and adjust what the job is worth.'
          }
        />
        <form action={formAction} className="space-y-4 p-5">
          <input type="hidden" name="contactId" value={contactId} />

          {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}
          {state.ok && state.message ? (
            <FormAlert tone="success">{state.message}</FormAlert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field htmlFor="pipelineStage" label={isDanish ? 'Stadie' : 'Stage'}>
              <Select id="pipelineStage" name="pipelineStage" defaultValue={defaultStage}>
                {STAGES.map(([value, da, en]) => (
                  <option key={value} value={value}>
                    {isDanish ? da : en}
                  </option>
                ))}
              </Select>
            </Field>

            <Field htmlFor="leadScore" label={isDanish ? 'Kundescore' : 'Lead score'} hint="0–100">
              <Input
                id="leadScore"
                name="leadScore"
                type="number"
                min={0}
                max={100}
                defaultValue={defaultScore}
              />
            </Field>

            <Field htmlFor="estimatedValueDkk" label={isDanish ? 'Værdi' : 'Value'} hint="DKK">
              <Input
                id="estimatedValueDkk"
                name="estimatedValueDkk"
                type="number"
                min={0}
                step={100}
                defaultValue={defaultValue}
              />
            </Field>
          </div>

          <Field
            htmlFor="summary"
            label={isDanish ? 'Hvad ved vi' : 'What we know'}
            hint={isDanish ? 'Læses af AI’en før næste opkald' : 'Read by the AI before the next call'}
          >
            <Textarea id="summary" name="summary" rows={4} defaultValue={defaultSummary} />
          </Field>

          <label className="flex cursor-pointer items-start gap-3 rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-3">
            <input type="hidden" name="aiAutoReplyEnabled" value="off" />
            <input
              type="checkbox"
              name="aiAutoReplyEnabled"
              defaultChecked={autoReply}
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent-primary)]"
            />
            <span className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">
                {isDanish ? 'AI må svare denne kunde' : 'AI may reply to this caller'}
              </span>
              <br />
              {isDanish
                ? 'Slå fra, når du selv tager over. Så holder AI’en sig væk.'
                : 'Turn off when you take over yourself. The AI then stays out of the way.'}
            </span>
          </label>

          <div className="flex items-center gap-2">
            <SubmitButton pendingLabel={isDanish ? 'Gemmer…' : 'Saving…'}>
              {isDanish ? 'Gem ændringer' : 'Save changes'}
            </SubmitButton>
          </div>
        </form>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--text-primary)]">
              {isDanish ? 'Arkivér kunden' : 'Archive this caller'}
            </p>
            <p className="mt-0.5 max-w-sm text-[11px] leading-relaxed text-[var(--text-muted)]">
              {isDanish
                ? 'Sætter kunden til “tabt”. Sletning af kundedata er en bureau-handling, ikke noget du kan gøre her — det håndhæves i databasen.'
                : 'Moves them to “closed lost”. Deleting caller data is an agency action, not something available here — enforced in the database.'}
            </p>
          </div>
          <form action={closeCallerAction}>
            <input type="hidden" name="contactId" value={contactId} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="…">
              {isDanish ? 'Arkivér' : 'Archive'}
            </SubmitButton>
          </form>
        </div>
      </Card>
    </div>
  );
}
