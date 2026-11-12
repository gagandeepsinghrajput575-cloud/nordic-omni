'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { createCallerAction } from '@/app/(client)/portal/leads/actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { STAGES } from '@/lib/pipeline';
import { Card, CardHeader } from '@/components/ui/core';
import { Field, Input, Select, Textarea, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function CreateCallerForm({ isDanish }: { isDanish: boolean }) {
  const [state, formAction] = useActionState(createCallerAction, EMPTY_STATE);
  const err = (field: string) => state.field === field ? state.error : undefined;
  const t = (da: string, en: string) => isDanish ? da : en;
  return (
    <form action={formAction} className="max-w-3xl">
      <Card>
        <CardHeader title={t('Kundeoplysninger', 'Caller details')} hint={t('Telefon eller email kræves, så kunden kan nås.', 'A phone number or email is required so the caller can be reached.')} />
        <div className="space-y-5 p-5">
          {state.error && !state.field ? <FormAlert tone="error">{state.error}</FormAlert> : null}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field htmlFor="fullName" label={t('Fulde navn', 'Full name')} required error={err('fullName')} className="sm:col-span-2"><Input id="fullName" name="fullName" autoComplete="name" placeholder={t('Fx Anna Jensen', 'e.g. Anna Jensen')} required maxLength={120} /></Field>
            <Field htmlFor="phoneNumber" label={t('Telefon', 'Phone')} hint="+45 …" error={err('phoneNumber')}><Input id="phoneNumber" name="phoneNumber" type="tel" autoComplete="tel" placeholder="+45 20 12 34 56" /></Field>
            <Field htmlFor="email" label="Email" error={err('email')}><Input id="email" name="email" type="email" autoComplete="email" placeholder="name@company.com" /></Field>
            <Field htmlFor="preferredLanguage" label={t('Sprog', 'Language')}><Select id="preferredLanguage" name="preferredLanguage" defaultValue={isDanish ? 'da' : 'en'}><option value="da">Dansk</option><option value="en">English</option></Select></Field>
            <Field htmlFor="pipelineStage" label={t('Startstadie', 'Starting stage')}><Select id="pipelineStage" name="pipelineStage" defaultValue="new_lead">{STAGES.map(([value, da, en]) => <option key={value} value={value}>{t(da, en)}</option>)}</Select></Field>
            <Field htmlFor="leadScore" label={t('Kundescore', 'Lead score')} hint="0–100"><Input id="leadScore" name="leadScore" type="number" min={0} max={100} defaultValue={50} /></Field>
            <Field htmlFor="estimatedValueDkk" label={t('Anslået værdi', 'Estimated value')} hint="DKK"><Input id="estimatedValueDkk" name="estimatedValueDkk" type="number" min={0} step={100} defaultValue={0} /></Field>
            <Field htmlFor="summary" label={t('Hvad vi ved', 'What we know')} hint={t('AI’en læser det før samtalen', 'The AI reads this before the conversation')} className="sm:col-span-2"><Textarea id="summary" name="summary" rows={4} maxLength={2000} placeholder={t('Fx: interesserede i et tilbud, ringede sidst i marts.', 'e.g. interested in a quote, called last March.')} /></Field>
          </div>
        </div>
        <div className="form-footer justify-start"><SubmitButton pendingLabel={t('Opretter…', 'Creating…')}>{t('Opret kunde', 'Create caller')}</SubmitButton><Link href="/portal/leads" className={buttonClass('ghost')}>{t('Annuller', 'Cancel')}</Link></div>
      </Card>
    </form>
  );
}
