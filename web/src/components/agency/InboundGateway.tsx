'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  Plug,
  Play,
  RotateCw,
  ShieldCheck,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { Field, Input, Select, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton, Spinner } from '@/components/ui/SubmitButton';
import { Tabs } from '@/components/ui/Tabs';
import { EMPTY_STATE } from '@/lib/actions/types';
import type { ActionState } from '@/lib/actions/types';
import type { ApiKeySummary } from '@/lib/webhooks/inbound-keys';
import {
  inboundKeyControlAction,
  mintInboundKeyAction,
  testVisionAction,
} from '@/app/(agency)/agency/control-actions';
import {
  AGENCY_ACTIONS,
  MUTATING_ACTIONS,
  type AgencyAction,
} from '@/lib/webhooks/inbound-contract';

/**
 * Tier 3 — the interactive request console.
 *
 * Three things a human actually needs here:
 *
 *   1. A key they can copy, and rotate, without a database console.
 *   2. A payload they can edit and fire, so "does this work?" is answerable in
 *      the browser rather than from a terminal.
 *   3. The raw response, unformatted, because a gateway that summarises its own
 *      output is a gateway you cannot debug.
 */

interface SampleSpec {
  payload: Record<string, unknown>;
  /** Fields that must be filled in before the sample can succeed. */
  needs: string[];
}

const TENANT = '00000000-0000-4000-8000-000000000000';

/** Prefilled samples. Placeholders are obvious so nobody ships them by accident. */
export const ACTION_SAMPLES: Record<AgencyAction, SampleSpec> = {
  fetch_leads: { payload: { action: 'fetch_leads', limit: 10 }, needs: [] },
  fetch_calls: { payload: { action: 'fetch_calls', limit: 10 }, needs: [] },
  fetch_clients: { payload: { action: 'fetch_clients' }, needs: [] },
  fetch_client_detail: { payload: { action: 'fetch_client_detail', tenantId: TENANT }, needs: ['tenantId'] },
  fetch_calendar_slots: {
    payload: { action: 'fetch_calendar_slots', tenantId: TENANT, date: new Date().toISOString().slice(0, 10) },
    needs: ['tenantId'],
  },
  fetch_metrics: { payload: { action: 'fetch_metrics' }, needs: [] },
  create_lead: {
    payload: { action: 'create_lead', tenantId: TENANT, name: 'Test Testesen', phone: '+4527441802', triggerSms: false },
    needs: ['tenantId'],
  },
  dispatch_call: {
    payload: { action: 'dispatch_call', tenantId: TENANT, phone: '+4527441802' },
    needs: ['tenantId'],
  },
  send_sms: {
    payload: { action: 'send_sms', tenantId: TENANT, to: '+4527441802', message: 'Testbesked fra Nordic Omni.' },
    needs: ['tenantId'],
  },
  book_appointment: {
    payload: {
      action: 'book_appointment',
      tenantId: TENANT,
      slotStart: new Date(Date.now() + 86_400_000).toISOString(),
      slotEnd: new Date(Date.now() + 86_400_000 + 1_800_000).toISOString(),
      customerName: 'Test Kunde',
      customerPhone: '+4527441802',
    },
    needs: ['tenantId'],
  },
  update_client: {
    payload: { action: 'update_client', tenantId: TENANT, broadcastMessage: 'Vi holder lukket i morgen.' },
    needs: ['tenantId'],
  },
  ask_copilot: {
    payload: { action: 'ask_copilot', tenantId: TENANT, query: 'Hvor mange kunder har vi?' },
    needs: ['tenantId'],
  },
};

const ACTION_LABELS: Record<AgencyAction, string> = {
  fetch_leads: 'fetch_leads — list leads',
  fetch_calls: 'fetch_calls — recent calls',
  fetch_clients: 'fetch_clients — workspaces',
  fetch_client_detail: 'fetch_client_detail — one workspace',
  fetch_calendar_slots: 'fetch_calendar_slots — availability',
  fetch_metrics: 'fetch_metrics — totals',
  create_lead: 'create_lead — new lead',
  dispatch_call: 'dispatch_call — stage a call',
  send_sms: 'send_sms — message',
  book_appointment: 'book_appointment — booking',
  update_client: 'update_client — hours / broadcast',
  ask_copilot: 'ask_copilot — grounded answer',
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass('ghost', 'sm')}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard access can be denied; the value is visible either way.
          setCopied(false);
        }
      }}
    >
      {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Minimal JSON colouring: keys, strings, numbers and literals. */
function JsonView({ value }: { value: string }) {
  const parts = useMemo(() => {
    const out: { text: string; tone: string }[] = [];
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
    let last = 0;
    for (const match of value.matchAll(re)) {
      const index = match.index ?? 0;
      if (index > last) out.push({ text: value.slice(last, index), tone: 'plain' });
      if (match[1]) out.push({ text: match[1], tone: match[2] ? 'key' : 'string' });
      else if (match[2]) out.push({ text: match[2], tone: 'plain' });
      else if (match[3]) out.push({ text: match[3], tone: 'literal' });
      else if (match[4]) out.push({ text: match[4], tone: 'number' });
      last = index + match[0].length;
    }
    if (last < value.length) out.push({ text: value.slice(last), tone: 'plain' });
    return out;
  }, [value]);

  const toneClass: Record<string, string> = {
    key: 'text-[var(--accent-primary)]',
    string: 'text-[var(--text)]',
    number: 'text-[var(--text-secondary)]',
    literal: 'text-[var(--text-muted)]',
    plain: 'text-[var(--text-secondary)]',
  };

  return (
    <pre className="max-h-80 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-3 font-mono text-[11.5px] leading-5">
      <code>
        {parts.map((part, index) => (
          <span key={index} className={toneClass[part.tone]}>{part.text}</span>
        ))}
      </code>
    </pre>
  );
}

function KeyRow({ item }: { item: ApiKeySummary }) {
  const [state, action] = useActionState(inboundKeyControlAction, EMPTY_STATE);
  const revoked = Boolean(item.revoked_at);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] py-3 last:border-0">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium">{item.name}</span>
          <Badge tone={revoked ? 'warning' : 'success'} dot>{revoked ? 'Revoked' : 'Active'}</Badge>
          <Badge tone="neutral">{item.tenant_id ? 'Workspace pinned' : 'All workspaces'}</Badge>
          {item.has_hmac ? <Badge tone="neutral">HMAC</Badge> : null}
        </div>
        <p className="mt-1 font-mono text-[11.5px] text-[var(--muted)]">{item.key_prefix}••••••••</p>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          {item.last_used_at ? `Last used ${new Date(item.last_used_at).toLocaleString('da-DK')}` : 'Never used'}
        </p>
      </div>
      {revoked ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <form action={action}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="action" value="rotate" />
            <SubmitButton variant="ghost" size="sm" pendingLabel="Rotating…"><RotateCw size={13} />Rotate</SubmitButton>
          </form>
          <form action={action} onSubmit={(event) => { if (!window.confirm('Revoke this key? Requests using it will fail immediately.')) event.preventDefault(); }}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="action" value="revoke" />
            <SubmitButton variant="ghost" size="sm" pendingLabel="Revoking…"><Trash2 size={13} />Revoke</SubmitButton>
          </form>
        </div>
      )}
      {state.error || state.message ? (
        <div className="basis-full">
          <FormAlert tone={state.error ? 'error' : 'success'}><span className="break-all">{state.error || state.message}</span></FormAlert>
        </div>
      ) : null}
    </div>
  );
}

export function InboundGateway({ keys, endpointUrl }: { keys: ApiKeySummary[]; endpointUrl: string }) {
  const [mintState, mintAction] = useActionState(mintInboundKeyAction, EMPTY_STATE);
  const [action, setAction] = useState<AgencyAction>('fetch_clients');
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(ACTION_SAMPLES.fetch_clients.payload, null, 2));
  const [keyInput, setKeyInput] = useState('');
  const [result, setResult] = useState<{ status: number; ok: boolean; body: string; ms: number } | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [running, startRun] = useTransition();
  const [vision, setVision] = useState<ActionState | null>(null);
  const [testingVision, startVisionTest] = useTransition();

  const sample = ACTION_SAMPLES[action];
  const mutating = MUTATING_ACTIONS.has(action);

  function chooseAction(next: AgencyAction) {
    setAction(next);
    setPayloadText(JSON.stringify(ACTION_SAMPLES[next].payload, null, 2));
    setJsonError(null);
    setResult(null);
  }

  const curl = useMemo(
    () =>
      [
        `curl -X POST '${endpointUrl}' \\`,
        `  -H 'Authorization: Bearer <api-key>' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '${JSON.stringify(sample.payload)}'`,
      ].join('\n'),
    [endpointUrl, sample.payload],
  );

  function execute() {
    setJsonError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      setJsonError('The payload is not valid JSON.');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      setJsonError('The payload must be a JSON object.');
      return;
    }
    if (!keyInput.trim()) {
      setJsonError('Paste an API key to execute a request.');
      return;
    }

    startRun(async () => {
      const started = performance.now();
      try {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keyInput.trim()}`,
          },
          body: payloadText,
        });
        const text = await response.text();
        let pretty = text;
        try {
          pretty = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          // Leave a non-JSON response exactly as it arrived.
        }
        setResult({ status: response.status, ok: response.ok, body: pretty, ms: Math.round(performance.now() - started) });
      } catch {
        setResult({ status: 0, ok: false, body: 'The request could not be sent.', ms: Math.round(performance.now() - started) });
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Endpoint + credential ------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Universal inbound gateway"
          hint="One signed endpoint for queries and actions. Vision AI and any other system authenticate with a key or an HMAC signature."
          action={<Badge tone="neutral" dot>POST</Badge>}
        />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 basis-64 break-all rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 font-mono text-[12px]">
              {endpointUrl}
            </code>
            <CopyButton value={endpointUrl} label="Copy endpoint URL" />
          </div>

          <div className="notice notice-info text-[12px]">
            <p>
              Send <code>Authorization: Bearer &lt;key&gt;</code>, or sign the body with
              {' '}<code>X-OMNI-Key-Id</code>, <code>X-OMNI-Timestamp</code> and
              {' '}<code>X-OMNI-Signature: sha256=&lt;HMAC of `timestamp.rawBody`&gt;</code>.
              Timestamps outside a five-minute window are rejected, and a delivery id may only be used once.
            </p>
          </div>

          <div>
            <h4 className="mb-2 flex items-center gap-2 text-[13px] font-medium"><KeyRound size={14} />API keys</h4>
            {keys.length === 0 ? (
              <p className="text-[12px] text-[var(--muted)]">No keys yet. Create one below — it is shown once.</p>
            ) : (
              <div>{keys.map((item) => <KeyRow key={item.id} item={item} />)}</div>
            )}
          </div>

          <form action={mintAction} className="flex flex-wrap items-end gap-3 border-t border-[var(--line)] pt-4">
            <div className="min-w-0 flex-1 basis-56">
              <Field htmlFor="key-name" label="Key name" required>
                <Input id="key-name" name="name" placeholder="Vision AI bridge" required maxLength={120} />
              </Field>
            </div>
            <div className="min-w-0 flex-1 basis-56">
              <Field htmlFor="key-tenant" label="Scope" hint="Leave blank for all workspaces">
                <Input id="key-tenant" name="tenantId" placeholder="Workspace UUID (optional)" />
              </Field>
            </div>
            <SubmitButton variant="primary" pendingLabel="Creating…">Create key</SubmitButton>
          </form>
          {mintState.error || mintState.message ? (
            <FormAlert tone={mintState.error ? 'error' : 'success'}><span className="break-all">{mintState.error || mintState.message}</span></FormAlert>
          ) : null}
        </div>
      </Card>

      {/* Request console ------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Request console"
          hint="Pick an action, edit the payload and execute it against the live endpoint."
          action={<Badge tone="neutral"><Terminal size={11} className="mr-1" />curl</Badge>}
        />
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <div className="space-y-4">
            <Field htmlFor="console-action" label="Action">
              <Select id="console-action" value={action} onChange={(event) => chooseAction(event.target.value as AgencyAction)}>
                {AGENCY_ACTIONS.map((name) => <option key={name} value={name}>{ACTION_LABELS[name]}</option>)}
              </Select>
            </Field>

            {mutating ? (
              <p className="notice notice-warning text-[12px]">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>This action writes to the database. The payload below runs for real against the selected workspace.</span>
              </p>
            ) : null}

            {sample.needs.length > 0 ? (
              <p className="text-[11.5px] text-[var(--muted)]">
                Replace the placeholder workspace id (<code className="font-mono">{TENANT.slice(0, 8)}…</code>) with a real one.
              </p>
            ) : null}

            <Field htmlFor="console-payload" label="JSON payload">
              <textarea
                id="console-payload"
                value={payloadText}
                onChange={(event) => { setPayloadText(event.target.value); setJsonError(null); }}
                rows={12}
                spellCheck={false}
                className="input w-full resize-y font-mono text-[12px] leading-5"
              />
            </Field>

            <Field htmlFor="console-key" label="API key" hint="Used once for this execution; never stored">
              <Input id="console-key" type="password" autoComplete="off" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} placeholder="omni_live_…" />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={execute} disabled={running} className={buttonClass('primary')}>
                {running ? <Spinner /> : <Play size={14} />}
                {running ? 'Executing…' : 'Execute action'}
              </button>
              <button type="button" onClick={() => chooseAction(action)} className={buttonClass('ghost', 'sm')}>
                Reset payload
              </button>
            </div>

            {jsonError ? <FormAlert tone="error">{jsonError}</FormAlert> : null}
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-[13px] font-medium">curl</h4>
                <CopyButton value={curl} label="Copy curl command" />
              </div>
              <pre className="overflow-auto rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-3 font-mono text-[11.5px] leading-5 text-[var(--text-secondary)]">
                <code>{curl}</code>
              </pre>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[13px] font-medium">Response</h4>
                {result ? (
                  <span className="flex items-center gap-2 text-[11.5px]">
                    <Badge tone={result.ok ? 'success' : 'danger'} dot>{result.status || 'network error'}</Badge>
                    <span className="tabular-nums text-[var(--muted)]">{result.ms} ms</span>
                  </span>
                ) : null}
              </div>
              {result ? (
                <JsonView value={result.body} />
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--line)] p-6 text-center text-[12px] text-[var(--muted)]">
                  Execute an action to inspect the raw response here.
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Vision bridge --------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Vision AI bridge"
          hint="Missed calls and urgent escalations are pushed to Vision as alarms; high-value leads become tasks."
          action={<Badge tone="neutral"><Plug size={11} className="mr-1" />bridge</Badge>}
        />
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { event: 'call.missed', target: '/api/alarms', tone: 'critical' },
              { event: 'escalation.created (urgency ≥ 4)', target: '/api/alarms', tone: 'critical' },
              { event: 'lead.created (≥ 50 000 DKK)', target: '/api/tasks', tone: 'high' },
            ].map((row) => (
              <div key={row.event} className="rounded-lg border border-[var(--line)] p-3">
                <p className="font-mono text-[11px] text-[var(--text-secondary)]">{row.event}</p>
                <p className="mt-1 text-[11.5px] text-[var(--muted)]">→ {row.target} · {row.tone}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={testingVision}
              onClick={() => startVisionTest(async () => { setVision(await testVisionAction()); })}
            >
              {testingVision ? <Spinner /> : <Zap size={13} />}
              {testingVision ? 'Testing…' : 'Test Vision connection'}
            </button>
            <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--muted)]">
              <ShieldCheck size={12} />
              Configured via VISION_AI_BASE_URL and VISION_AI_SECRET on the server.
            </span>
          </div>

          {vision ? (
            <FormAlert tone={vision.ok ? 'success' : 'error'}>{vision.message || vision.error}</FormAlert>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

/** Tab shell: outbound streams and the inbound gateway are peer surfaces. */
export function WebhookTabs({ outbound, inbound }: { outbound: React.ReactNode; inbound: React.ReactNode }) {
  const [tab, setTab] = useState<'outbound' | 'inbound'>('outbound');
  return (
    <div className="space-y-5">
      <Tabs
        id="webhook-hub"
        label="Webhook hub sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'outbound', label: 'Outbound Streams' },
          { id: 'inbound', label: 'Universal Inbound & Vision Gateway' },
        ]}
      />
      <div role="tabpanel" id={`webhook-hub-panel-${tab}`} aria-labelledby={`webhook-hub-tab-${tab}`}>
        {tab === 'outbound' ? outbound : inbound}
      </div>
    </div>
  );
}
