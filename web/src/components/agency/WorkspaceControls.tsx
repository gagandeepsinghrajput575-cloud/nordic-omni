'use client';

import { useActionState, useState } from 'react';
import { Radio, PhoneForwarded, Bot } from 'lucide-react';
import { workspaceControlsAction } from '@/app/(agency)/agency/control-actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card, CardHeader, Badge } from '@/components/ui/core';
import { Field, Input, Select, FormAlert } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function WorkspaceControls({ tenantId, status, receptionMode, did }: { tenantId: string; status: string; receptionMode: string; did: string | null }) {
  const [state, action, pending] = useActionState(workspaceControlsAction, EMPTY_STATE);
  const [draft, setDraft] = useState({ status: status === 'archived' ? 'paused' : status, receptionMode, did: did ?? '' });
  const [saved, setSaved] = useState({ status, receptionMode, did: did ?? '' });
  // Reconcile only when the server facts change, preserving edits during a save.
  if (saved.status !== status || saved.receptionMode !== receptionMode || saved.did !== (did ?? '')) {
    setSaved({ status, receptionMode, did: did ?? '' });
    setDraft({ status: status === 'archived' ? 'paused' : status, receptionMode, did: did ?? '' });
  }
  return <Card>
    <CardHeader title="Workspace controls" hint="Agency-only lifecycle and reception policy." action={<Badge tone="accent">Agency only</Badge>} />
    <form action={action}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-3">
        <Field htmlFor="workspace-status" label="Workspace status"><Select id="workspace-status" name="status" value={draft.status} disabled={pending} onChange={(e) => setDraft((old) => ({ ...old, status: e.target.value }))}><option value="active">Active — accepting calls</option><option value="paused">Paused — temporarily offline</option><option value="suspended">Suspended — access blocked</option></Select></Field>
        <Field htmlFor="workspace-did" label="Assigned phone DID" hint="International format"><Input id="workspace-did" name="did" type="tel" value={draft.did} disabled={pending} onChange={(e) => setDraft((old) => ({ ...old, did: e.target.value }))} placeholder="+4532123456" /></Field>
        <Field htmlFor="reception-mode" label="Reception mode"><Select id="reception-mode" name="receptionMode" value={draft.receptionMode} disabled={pending} onChange={(e) => setDraft((old) => ({ ...old, receptionMode: e.target.value }))}><option value="voice_ai">Voice AI receptionist</option><option value="human_forward">Human forward</option><option value="hybrid">Hybrid — AI first, human escalation</option></Select></Field>
      </div>
      <div className="grid gap-3 border-t border-[var(--line)] bg-[var(--bg-raised)] p-5 text-[12px] leading-5 text-[var(--muted)] sm:grid-cols-3">
        <p><Bot size={15} className="mb-2 text-[var(--accent-primary)]" /><strong className="text-[var(--text)]">Voice AI</strong><br />Answers calls and chat using your approved knowledge.</p>
        <p><PhoneForwarded size={15} className="mb-2 text-[var(--accent-primary)]" /><strong className="text-[var(--text)]">Human forward</strong><br />PSTN calls transfer to the owner phone. Requires a configured LiveKit SIP provider; browser calls and AI chat are unavailable.</p>
        <p><Radio size={15} className="mb-2 text-[var(--accent-primary)]" /><strong className="text-[var(--text)]">Hybrid</strong><br />AI answers first; urgent or human-requested cases notify the owner.</p>
      </div>
      <div className="px-5 pb-4">{state.error || state.message ? <FormAlert tone={state.error ? 'error' : 'success'}>{state.error || state.message}</FormAlert> : null}<p className="mt-3 text-[11px] text-[var(--muted)]">Saving a DID updates routing records, not your telephone carrier. Configure the carrier and LiveKit trunk separately. Pausing or suspending revokes client sessions.</p></div>
      <div className="form-footer"><SubmitButton pendingLabel="Applying…">Apply controls</SubmitButton></div>
    </form>
  </Card>;
}
