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

  const err = (f: string) => (state.field === f ? state.error : undefined);
  const effectiveSlug = slugTouched ? slug : slugify(name);

  return (
    <form action={formAction} className="space-y-5">
      {state.error && !state.field ? <FormAlert tone="error">{state.error}</FormAlert> : null}

      <Card>
        <CardHeader
          title="The business"
          hint="This becomes the workspace name and its public address."
        />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Field htmlFor="name" label="Business name" required error={err('name')}>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Københavns VVS Service"
              invalid={Boolean(err('name'))}
              required
            />
          </Field>

          <Field
            htmlFor="slug"
            label="Slug"
            hint="a-z, 0-9, hyphens"
            error={err('slug')}
          >
            <Input
              id="slug"
              name="slug"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="kbh-vvs"
              invalid={Boolean(err('slug'))}
              className="font-mono"
            />
          </Field>

          <Field htmlFor="defaultLanguage" label="Agent language">
            <Select id="defaultLanguage" name="defaultLanguage" defaultValue="da-DK">
              <option value="da-DK">Dansk</option>
              <option value="en-US">English</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="The owner"
          hint="Who the agent escalates emergencies to, and who gets portal access."
        />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Field htmlFor="ownerName" label="Owner name" required error={err('ownerName')}>
            <Input
              id="ownerName"
              name="ownerName"
              placeholder="Jens Hansen"
              invalid={Boolean(err('ownerName'))}
              required
            />
          </Field>
          <Field htmlFor="ownerPhone" label="Owner phone" hint="+45 …" required error={err('ownerPhone')}>
            <Input
              id="ownerPhone"
              name="ownerPhone"
              inputMode="tel"
              placeholder="+45 40 12 34 56"
              invalid={Boolean(err('ownerPhone'))}
              required
            />
          </Field>
          <Field
            htmlFor="ownerEmail"
            label="Owner email"
            required
            error={err('ownerEmail')}
            className="sm:col-span-2"
          >
            <Input
              id="ownerEmail"
              name="ownerEmail"
              type="email"
              placeholder="jens@kbhvvs.dk"
              invalid={Boolean(err('ownerEmail'))}
              required
            />
          </Field>
        </div>
      </Card>

      <Card className="border-[var(--accent-line)] bg-[var(--accent-soft)] p-4">
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
          <span className="font-medium text-[var(--text-primary)]">What gets created.</span>{' '}
          The workspace, its agent configuration, and a starting prompt and greeting in the
          chosen language — nothing else. Opening hours, prices and callers start empty and
          the client fills them in. No placeholder leads, no invented owner, no fabricated
          opening hours.
        </p>
      </Card>

      <div className="flex items-center gap-2">
        <SubmitButton pendingLabel="Creating…">Create workspace</SubmitButton>
        <Link href="/agency/clients" className={buttonClass('ghost')}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
