'use client';

import { useActionState, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, UserRoundCog } from 'lucide-react';
import type { WorkspaceMember } from '@/lib/db/agency';
import { memberAction, provisionMemberAction } from '@/app/(agency)/agency/control-actions';
import { EMPTY_STATE, type ActionState } from '@/lib/actions/types';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { EmptyState } from '@/components/ui/feedback';
import { Field, Input, Select, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { Dialog } from '@/components/ui/Dialog';

function MemberReset({ tenantId, member }: { tenantId: string; member: WorkspaceMember }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(memberAction, EMPTY_STATE);
  return <>
    <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setOpen(true)} aria-label={`Reset password for ${member.email}`}><KeyRound size={14} />Reset password</button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Reset account password" description={`Set a temporary password for ${member.email}. All existing sessions will be revoked.`}>
      <form action={action} className="space-y-5">
        <input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="memberId" value={member.id} /><input type="hidden" name="action" value="reset" />
        <Field htmlFor={`reset-${member.id}`} label="Temporary password" hint="12+ characters" required><Input id={`reset-${member.id}`} name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field>
        {state.error || state.message ? <FormAlert tone={state.error ? 'error' : 'success'}>{state.error || state.message}</FormAlert> : null}
        <div className="flex justify-end gap-2"><button type="button" className={buttonClass('ghost')} onClick={() => setOpen(false)}>Close</button><SubmitButton pendingLabel="Resetting…">Reset password</SubmitButton></div>
      </form>
    </Dialog>
  </>;
}

function AccessButton({ tenantId, member, action: verb }: { tenantId: string; member: WorkspaceMember; action: 'suspend' | 'reactivate' }) {
  const [state, formAction] = useActionState<ActionState, FormData>(memberAction, EMPTY_STATE);
  return <form action={formAction} className="inline-flex flex-col gap-1">
    <input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="memberId" value={member.id} /><input type="hidden" name="action" value={verb} />
    <SubmitButton variant={verb === 'suspend' ? 'danger' : 'secondary'} size="sm" pendingLabel="Updating…">{verb === 'suspend' ? 'Suspend' : 'Reactivate'}</SubmitButton>
    {state.error ? <span role="alert" className="max-w-40 text-[11px] text-[var(--danger)]">{state.error}</span> : null}
  </form>;
}

export function TeamManager({ tenantId, members }: { tenantId: string; members: WorkspaceMember[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(provisionMemberAction, EMPTY_STATE);
  return <div className="space-y-5">
    <Card className="overflow-hidden">
      <CardHeader title="Client logins" hint="Only this workspace. Passwords are never visible to the agency after provisioning." action={<button type="button" onClick={() => setOpen(true)} className={buttonClass('primary', 'sm')}><Plus size={14} />Provision login</button>} />
      {!members.length ? <EmptyState icon={<UserRoundCog size={22} />} title="No client logins yet" description="Create an owner or staff account for this business." /> : <div className="overflow-x-auto"><table className="data-table"><caption className="sr-only">Team accounts for this client workspace</caption><thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Access</th><th scope="col">Account controls</th></tr></thead><tbody>
        {members.map((member) => <tr key={member.id}><td><p className="font-medium">{member.full_name || 'Team member'}</p><p className="mt-1 text-[12px] text-[var(--muted)]">{member.email}</p></td><td data-label="Role"><Badge tone={member.role === 'owner' ? 'accent' : 'neutral'}>{member.role}</Badge></td><td data-label="Access"><Badge tone={member.is_active ? 'success' : 'warning'} dot>{member.is_active ? member.must_change_password ? 'Password change required' : 'Active' : 'Suspended'}</Badge></td><td><div className="flex flex-wrap items-center gap-2"><MemberReset tenantId={tenantId} member={member} /><AccessButton tenantId={tenantId} member={member} action={member.is_active ? 'suspend' : 'reactivate'} /></div></td></tr>)}
      </tbody></table></div>}
      <div className="table-footer"><span>{members.length} {members.length === 1 ? 'account' : 'accounts'}</span><span className="flex items-center gap-1.5"><ShieldCheck size={13} />Tenant isolated</span></div>
    </Card>
    <Dialog open={open} onClose={() => setOpen(false)} title="Provision a client login" description="This account can access only this business portal, never the agency console.">
      <form action={action} className="space-y-5">
        <input type="hidden" name="tenantId" value={tenantId} />
        <Field htmlFor="member-name" label="Full name" required><Input id="member-name" name="fullName" autoComplete="name" minLength={2} required /></Field>
        <Field htmlFor="member-email" label="Login email" required><Input id="member-email" name="email" type="email" autoComplete="off" required /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field htmlFor="member-role" label="Role"><Select id="member-role" name="role" defaultValue="staff"><option value="staff">Staff</option><option value="owner">Owner</option></Select></Field><Field htmlFor="member-password" label="Initial password" required><Input id="member-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field></div>
        {state.error || state.message ? <FormAlert tone={state.error ? 'error' : 'success'}>{state.error || state.message}</FormAlert> : null}
        <div className="flex justify-end gap-2"><button type="button" className={buttonClass('ghost')} onClick={() => setOpen(false)}>Close</button><SubmitButton pendingLabel="Provisioning…">Create login</SubmitButton></div>
      </form>
    </Dialog>
  </div>;
}
