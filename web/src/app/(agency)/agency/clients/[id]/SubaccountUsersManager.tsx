'use client';

import { useState, useTransition } from 'react';
import {
  createSubaccountUserAction,
  resetSubaccountPasswordAction,
  toggleSubaccountUserActiveAction,
} from './subaccount-actions';
import type { SubaccountUserRow } from '@/lib/db/subaccounts';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { Field, FormAlert, Input, Select, buttonClass } from '@/components/ui/form';

export function SubaccountUsersManager({
  tenantId,
  users,
}: {
  tenantId: string;
  users: SubaccountUserRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setFeedback(null);
    startTransition(async () => {
      const res = await fn();
      setFeedback({ ok: res.ok, text: res.ok ? res.message ?? 'Done' : res.error ?? 'Failed' });
    });
  }

  return (
    <Card>
      <CardHeader
        title="Sub-account logins"
        hint="Clients you provision here sign in at /login and only ever see their own /portal workspace."
        action={<Badge tone="neutral">{users.length} accounts</Badge>}
      />

      <div className="space-y-5 p-5">
        {feedback ? (
          <FormAlert tone={feedback.ok ? 'success' : 'error'}>{feedback.text}</FormAlert>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(async () => {
              const res = await createSubaccountUserAction(fd);
              if (res.ok) {
                setEmail('');
                setFullName('');
                setPassword('');
              }
              return res;
            });
          }}
          className="space-y-3 rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-4"
        >
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field htmlFor="sub-name" label="Full name" required>
              <Input
                id="sub-name"
                name="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Morten Bondo"
                required
              />
            </Field>
            <Field htmlFor="sub-email" label="Email" required>
              <Input
                id="sub-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="morten@company.dk"
                required
              />
            </Field>
            <Field htmlFor="sub-pass" label="Initial password" required>
              <Input
                id="sub-pass"
                name="password"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 chars"
                required
              />
            </Field>
            <Field htmlFor="sub-role" label="Role">
              <Select id="sub-role" name="role" defaultValue="owner">
                <option value="owner">Owner</option>
                <option value="staff">Staff</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={isPending} className={buttonClass('primary', 'sm')}>
              {isPending ? 'Provisioning…' : 'Provision login'}
            </button>
          </div>
        </form>

        {users.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            No client logins provisioned for this workspace yet.
          </p>
        ) : (
          <div className="space-y-2.5">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3"
              >
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {u.full_name || u.email}
                    </span>
                    <Badge tone={u.role === 'owner' ? 'accent' : 'neutral'}>{u.role}</Badge>
                    <Badge tone={u.is_active ? 'success' : 'danger'}>
                      {u.is_active ? 'Active' : 'Suspended'}
                    </Badge>
                  </div>
                  <p className="font-mono text-[11px] text-[var(--text-muted)]">{u.email}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {resetUserId === u.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        run(async () => {
                          const res = await resetSubaccountPasswordAction(fd);
                          if (res.ok) {
                            setResetUserId(null);
                            setResetPassword('');
                          }
                          return res;
                        });
                      }}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="userId" value={u.id} />
                      <Input
                        name="password"
                        type="password"
                        minLength={8}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="New password (8+ chars)"
                        className="w-44"
                        required
                      />
                      <button
                        type="submit"
                        disabled={isPending}
                        className={buttonClass('primary', 'sm')}
                      >
                        Set
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResetUserId(null);
                          setResetPassword('');
                        }}
                        className={buttonClass('ghost', 'sm')}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setResetUserId(u.id)}
                      className={buttonClass('ghost', 'sm')}
                    >
                      Reset password
                    </button>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      run(() => toggleSubaccountUserActiveAction(fd));
                    }}
                  >
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="isActive" value={u.is_active ? 'false' : 'true'} />
                    <button
                      type="submit"
                      disabled={isPending}
                      className={buttonClass(u.is_active ? 'danger' : 'secondary', 'sm')}
                    >
                      {u.is_active ? 'Suspend' : 'Reactivate'}
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
