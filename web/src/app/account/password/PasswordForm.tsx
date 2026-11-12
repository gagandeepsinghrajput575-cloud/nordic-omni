'use client';

import { useActionState } from 'react';
import { changeInitialPassword } from './actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Field, Input, FormAlert } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function PasswordForm() {
  const [state, action] = useActionState(changeInitialPassword, EMPTY_STATE);
  return <form action={action} className="space-y-5">
    <Field htmlFor="currentPassword" label="Temporary password" required><Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required /></Field>
    <Field htmlFor="password" label="New password" hint="At least 12 characters" required><Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field>
    <Field htmlFor="confirmation" label="Confirm new password" required><Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field>
    {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}
    <SubmitButton pendingLabel="Securing your account…">Set password & continue</SubmitButton>
  </form>;
}
