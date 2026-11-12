'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { createWorkspaceAction } from './actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { slugify } from '@/lib/slug';
import { Card, CardHeader } from '@/components/ui/core';
import { Field, Input, Select, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function CreateWorkspaceForm() {
  const [state, formAction] = useActionState(createWorkspaceAction, EMPTY_STATE);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const err = (field: string) => state.field === field ? state.error : undefined;
  const effectiveSlug = slugTouched ? slug : slugify(name);
  return (
    <form action={formAction} className="max-w-3xl space-y-5">
      {state.error && !state.field ? <FormAlert tone="error">{state.error}</FormAlert> : null}
      <Card>
        <CardHeader title="The business" hint="This becomes the workspace name and its public address." />
        <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
          <Field htmlFor="name" label="Business name" required error={err('name')}><Input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Copenhagen Plumbing Service" required /></Field>
          <Field htmlFor="slug" label="Workspace slug" hint="a–z, 0–9, hyphens" error={err('slug')}><Input id="slug" name="slug" value={effectiveSlug} onChange={(event) => { setSlugTouched(true); setSlug(slugify(event.target.value)); }} placeholder="copenhagen-plumbing" className="font-mono" /></Field>
          <Field htmlFor="defaultLanguage" label="Reception language"><Select id="defaultLanguage" name="defaultLanguage" defaultValue="da-DK"><option value="da-DK">Dansk</option><option value="en-US">English</option></Select></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="The owner" hint="Who the receptionist escalates emergencies to, and who receives portal access." />
        <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
          <Field htmlFor="ownerName" label="Owner name" required error={err('ownerName')}><Input id="ownerName" name="ownerName" autoComplete="name" placeholder="Anna Jensen" required /></Field>
          <Field htmlFor="ownerPhone" label="Owner phone" hint="+45 …" required error={err('ownerPhone')}><Input id="ownerPhone" name="ownerPhone" type="tel" autoComplete="tel" placeholder="+45 40 12 34 56" required /></Field>
          <Field htmlFor="ownerEmail" label="Owner email" required error={err('ownerEmail')} className="sm:col-span-2"><Input id="ownerEmail" name="ownerEmail" type="email" autoComplete="email" placeholder="anna@example.com" required /></Field>
        </div>
      </Card>
      <div className="notice notice-info"><p className="text-[12px] leading-6"><span className="font-medium text-[var(--text)]">What gets created.</span> The workspace, its agent configuration, and a starting prompt and greeting in the chosen language. Opening hours, prices and callers start empty for the client to fill in. No placeholder leads or invented facts.</p></div>
      <div className="flex flex-wrap items-center gap-2"><SubmitButton pendingLabel="Creating…">Create workspace</SubmitButton><Link href="/agency/clients" className={buttonClass('ghost')}>Cancel</Link></div>
    </form>
  );
}
