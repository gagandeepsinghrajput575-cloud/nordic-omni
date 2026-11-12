'use server';

import { redirect } from 'next/navigation';
import { getSession, verifyUserPassword } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { withUser } from '@/lib/db/client';
import type { ActionState } from '@/lib/actions/types';

export async function changeInitialPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) redirect('/login');
  const current = String(formData.get('currentPassword') || '');
  const password = String(formData.get('password') || '');
  const confirmation = String(formData.get('confirmation') || '');
  if (password.length < 12 || password.length > 128) return { ok: false, error: 'Choose a password of 12–128 characters.' };
  if (password !== confirmation) return { ok: false, error: 'The new passwords do not match.' };
  if (password === current) return { ok: false, error: 'Choose a different password from the temporary one.' };
  const isValid = await verifyUserPassword(session.userId, current);
  if (!isValid) return { ok: false, error: 'The temporary password is incorrect.' };
  const hash = hashPassword(password);
  await withUser(session.userId, async (tx) => { await tx`select complete_password_change(${session.userId}, ${hash})`; });
  redirect(session.isAgency ? '/agency' : '/portal');
}
