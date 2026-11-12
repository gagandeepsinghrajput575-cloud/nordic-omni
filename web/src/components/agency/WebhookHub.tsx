'use client';

import { useActionState, useState, useTransition } from 'react';
import { CheckCircle2, Pencil, Plus, RotateCcw, Send, Trash2, Webhook } from 'lucide-react';
import type { WebhookEndpoint } from '@/lib/db/agency';
import { saveWebhookAction, webhookControlAction } from '@/app/(agency)/agency/control-actions';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { EmptyState } from '@/components/ui/feedback';
import { Field, Input, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton, Spinner } from '@/components/ui/SubmitButton';
import { Dialog } from '@/components/ui/Dialog';

function EndpointEditor({ tenantId, endpoint, open, onClose }: { tenantId?: string; endpoint?: WebhookEndpoint; open: boolean; onClose: () => void }) {
  const [state, action] = useActionState(saveWebhookAction, EMPTY_STATE);
  return <Dialog open={open} onClose={onClose} title={endpoint ? 'Edit webhook endpoint' : 'Connect an endpoint'} description="Signed JSON events for your CRM, n8n or Zapier. The receiver must return a 2xx status." wide>
    <form key={endpoint?.id ?? 'new'} action={action} className="space-y-5">
      <input type="hidden" name="tenantId" value={tenantId ?? ''} />{endpoint ? <input type="hidden" name="id" value={endpoint.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2"><Field htmlFor={`hook-name-${endpoint?.id ?? 'new'}`} label="Connection name" required><Input id={`hook-name-${endpoint?.id ?? 'new'}`} name="name" defaultValue={endpoint?.name} placeholder="Agency CRM" required maxLength={120} /></Field><Field htmlFor={`hook-url-${endpoint?.id ?? 'new'}`} label="HTTPS endpoint" required><Input id={`hook-url-${endpoint?.id ?? 'new'}`} name="url" type="url" defaultValue={endpoint?.url} placeholder="https://hooks.example.com/omni" required /></Field></div>
      <fieldset><legend className="mb-3 text-[13px] font-medium">Stream these events</legend><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{WEBHOOK_EVENTS.map((event) => <label key={event} className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-2.5 text-[12px]"><input type="checkbox" name="events" value={event} defaultChecked={!endpoint || endpoint.events.includes(event)} /><span className="font-mono">{event}</span></label>)}</div></fieldset>
      <Field htmlFor={`hook-secret-${endpoint?.id ?? 'new'}`} label={endpoint ? 'Replace signing secret' : 'Signing secret'} hint={endpoint ? `Current secret ends ${endpoint.secret_hint}` : 'Optional · generated if empty'}><Input id={`hook-secret-${endpoint?.id ?? 'new'}`} name="secret" type="password" autoComplete="new-password" minLength={32} placeholder={endpoint ? 'Leave blank to keep the current secret' : 'Leave blank to generate a secure secret'} /></Field>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="enabled" defaultChecked={endpoint?.is_enabled ?? true} />Endpoint enabled</label>
      <div className="notice notice-info text-[12px]"><p>Verify <code>X-OMNI-Signature</code> as HMAC-SHA256 of <code>timestamp.rawBody</code>, using <code>X-OMNI-Timestamp</code>. Reject timestamps older than five minutes. Deduplicate by <code>X-OMNI-Delivery</code>. A generated secret is shown once after creation or rotation.</p></div>
      {state.error || state.message ? <FormAlert tone={state.error ? 'error' : 'success'}><span className="break-all">{state.error || state.message}</span></FormAlert> : null}
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass('ghost')} onClick={onClose}>Close</button><SubmitButton pendingLabel="Saving…">Save endpoint</SubmitButton></div>
    </form>
  </Dialog>;
}

function EndpointActions({ endpoint, tenantId }: { endpoint: WebhookEndpoint; tenantId?: string }) {
  const [state, action] = useActionState(webhookControlAction, EMPTY_STATE);
  const [testing, startTest] = useTransition();
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  function sendTest() {
    setTest(null);
    startTest(async () => {
      try {
        const response = await fetch('/api/agency/webhooks/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: endpoint.id }) });
        const result = await response.json();
        setTest({ ok: response.ok, message: result.ok ? `Test delivered · HTTP ${result.status}` : result.error || 'Test failed.' });
      } catch { setTest({ ok: false, message: 'Could not reach the test service.' }); }
    });
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={sendTest} disabled={testing} className={buttonClass('secondary', 'sm')}>{testing ? <Spinner /> : <Send size={13} />}{testing ? 'Sending…' : 'Send test'}</button>
      <form action={action}><input type="hidden" name="id" value={endpoint.id} /><input type="hidden" name="tenantId" value={tenantId ?? ''} /><input type="hidden" name="action" value="toggle" /><SubmitButton variant="ghost" size="sm" pendingLabel="Updating…">{endpoint.is_enabled ? 'Pause' : 'Enable'}</SubmitButton></form>
      {endpoint.failed_count > 0 ? <form action={action}><input type="hidden" name="id" value={endpoint.id} /><input type="hidden" name="tenantId" value={tenantId ?? ''} /><input type="hidden" name="action" value="retry" /><SubmitButton variant="ghost" size="sm" pendingLabel="Queueing…"><RotateCcw size={13} />Retry failed</SubmitButton></form> : null}
      <form action={action} onSubmit={(event) => { if (!window.confirm('Rotate the signing secret? Update the receiver with the new secret.')) event.preventDefault(); }}><input type="hidden" name="id" value={endpoint.id} /><input type="hidden" name="tenantId" value={tenantId ?? ''} /><input type="hidden" name="action" value="secret" /><SubmitButton variant="ghost" size="sm" pendingLabel="Rotating…">Rotate secret</SubmitButton></form>
      <form action={action} onSubmit={(event) => { if (!window.confirm('Delete this endpoint and its delivery history?')) event.preventDefault(); }}><input type="hidden" name="id" value={endpoint.id} /><input type="hidden" name="tenantId" value={tenantId ?? ''} /><input type="hidden" name="action" value="delete" /><SubmitButton variant="ghost" size="sm" pendingLabel="Deleting…"><Trash2 size={13} />Delete</SubmitButton></form>
    </div>
    <div aria-live="polite">{test ? <p className={`text-[12px] ${test.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{test.message}</p> : null}{state.error || state.message ? <FormAlert tone={state.error ? 'error' : 'success'}><span className="break-all">{state.error || state.message}</span></FormAlert> : null}</div>
  </div>;
}

export function WebhookHub({ endpoints, tenantId }: { endpoints: WebhookEndpoint[]; tenantId?: string }) {
  const [editor, setEditor] = useState<WebhookEndpoint | 'new' | null>(null);
  return <div className="space-y-5">
    <Card><CardHeader title={tenantId ? 'Client event streams' : 'Agency-global event streams'} hint={tenantId ? 'Only events from this workspace are sent to these endpoints.' : 'Every client call, lead and escalation, routed to your agency systems.'} action={<button type="button" onClick={() => setEditor('new')} className={buttonClass('primary', 'sm')}><Plus size={14} />Add endpoint</button>} />
      <div className="flex flex-wrap gap-x-6 gap-y-2 p-5 text-[12px] text-[var(--muted)]"><span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[var(--accent-primary)]" />HMAC-SHA256 signed</span><span>Durable queue · 6 delivery attempts</span><span>8-second network timeout</span><span>HTTPS only</span></div>
    </Card>
    {!endpoints.length ? <Card><EmptyState icon={<Webhook size={23} />} title="Connect your first system" description="Send real-time events to your CRM, n8n or an automation platform. No events are invented or backfilled." action={<button type="button" onClick={() => setEditor('new')} className={buttonClass('primary')}><Plus size={14} />Add endpoint</button>} /></Card> : endpoints.map((endpoint) => <Card key={endpoint.id} className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1 basis-64"><div className="flex flex-wrap items-center gap-2"><h3 className="section-title">{endpoint.name}</h3><Badge tone={endpoint.is_enabled ? 'success' : 'warning'} dot>{endpoint.is_enabled ? 'Enabled' : 'Paused'}</Badge><Badge tone="neutral">{endpoint.tenant_id ? 'Client scoped' : 'All workspaces'}</Badge></div><p className="mt-2 break-all font-mono text-[12px] text-[var(--muted)]">{endpoint.url}</p></div><button type="button" onClick={() => setEditor(endpoint)} className={buttonClass('secondary', 'sm')} aria-label={`Edit ${endpoint.name}`}><Pencil size={13} />Edit</button></div>
      <div className="my-4 flex flex-wrap gap-1.5">{endpoint.events.map((event) => <span key={event} className="rounded-md bg-[var(--bg-raised)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)]">{event}</span>)}</div>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 border-y border-[var(--line)] py-3 text-[12px]"><span><strong className="font-semibold tabular-nums">{endpoint.delivered_count}</strong> <span className="text-[var(--muted)]">delivered</span></span><span><strong className="font-semibold tabular-nums">{endpoint.pending_count}</strong> <span className="text-[var(--muted)]">queued</span></span><span className={endpoint.failed_count ? 'text-[var(--danger)]' : ''}><strong className="font-semibold tabular-nums">{endpoint.failed_count}</strong> failed</span><span className="text-[var(--muted)]">Secret ••••{endpoint.secret_hint}</span></div>
      {endpoint.last_error ? <p className="mb-3 text-[12px] text-[var(--danger)]">Last attempt: {endpoint.last_error}</p> : endpoint.last_status ? <p className="mb-3 flex items-center gap-1.5 text-[12px] text-[var(--success)]"><CheckCircle2 size={13} />Last delivery · HTTP {endpoint.last_status}</p> : <p className="mb-3 text-[12px] text-[var(--muted)]">No deliveries attempted yet.</p>}
      <EndpointActions endpoint={endpoint} tenantId={tenantId} />
    </Card>)}
    <p className="text-[12px] leading-5 text-[var(--muted)]">The durable delivery worker must be running to drain queued events. Test sends are synchronous and do not create customer records. Delivery is at-least-once; receivers should deduplicate by delivery ID.</p>
    {editor ? <EndpointEditor key={editor === 'new' ? 'new' : editor.id} tenantId={tenantId} endpoint={editor === 'new' ? undefined : editor} open onClose={() => setEditor(null)} /> : null}
  </div>;
}
