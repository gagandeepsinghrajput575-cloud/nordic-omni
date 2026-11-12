'use client';

import { useState, useTransition } from 'react';
import { updateTenantAgencySettingsAction } from './subaccount-actions';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { Field, FormAlert, Input, Select, buttonClass } from '@/components/ui/form';

export function AgencyTenantSettingsForm({
  tenantId,
  name,
  status,
  flynumberDid,
  telephonyMode,
  defaultLanguage,
}: {
  tenantId: string;
  name: string;
  status: 'active' | 'paused' | 'archived';
  flynumberDid: string | null;
  telephonyMode: 'zero_cost_webrtc' | 'paid_sip_trunk';
  defaultLanguage: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateTenantAgencySettingsAction(fd);
      setFeedback({
        ok: res.ok,
        text: res.ok ? res.message ?? 'Saved' : res.error ?? 'Failed to save',
      });
    });
  }

  return (
    <Card>
      <CardHeader
        title="Agency-controlled workspace routing & status"
        hint="Locked from client edits by PostgreSQL trigger 0015 (guard_tenant_agency_columns)."
        action={
          <Badge tone={status === 'active' ? 'success' : status === 'paused' ? 'warning' : 'neutral'}>
            {status}
          </Badge>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <input type="hidden" name="tenantId" value={tenantId} />
        {feedback ? (
          <FormAlert tone={feedback.ok ? 'success' : 'error'}>{feedback.text}</FormAlert>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field htmlFor="agency-name" label="Business name" required>
            <Input id="agency-name" name="name" defaultValue={name} required />
          </Field>

          <Field htmlFor="agency-status" label="Account status">
            <Select id="agency-status" name="status" defaultValue={status}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>

          <Field htmlFor="agency-lang" label="Default language">
            <Select id="agency-lang" name="defaultLanguage" defaultValue={defaultLanguage}>
              <option value="da-DK">Dansk (da-DK)</option>
              <option value="en-US">English (en-US)</option>
            </Select>
          </Field>

          <Field htmlFor="agency-did" label="FlyNumber DID (E.164)">
            <Input
              id="agency-did"
              name="flynumberDid"
              defaultValue={flynumberDid ?? ''}
              placeholder="+4570201122"
              className="font-mono"
            />
          </Field>

          <Field htmlFor="agency-telephony" label="Telephony mode">
            <Select id="agency-telephony" name="telephonyMode" defaultValue={telephonyMode}>
              <option value="zero_cost_webrtc">Zero-cost WebRTC</option>
              <option value="paid_sip_trunk">Paid SIP Trunk</option>
            </Select>
          </Field>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={isPending} className={buttonClass('primary', 'sm')}>
            {isPending ? 'Saving…' : 'Save agency settings'}
          </button>
        </div>
      </form>
    </Card>
  );
}
