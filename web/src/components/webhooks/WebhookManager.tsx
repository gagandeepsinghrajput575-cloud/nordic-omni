'use client';

import { useState, useTransition } from 'react';
import {
  createWebhookAction,
  deleteWebhookAction,
  rotateWebhookSecretAction,
  testWebhookAction,
  updateWebhookAction,
} from '@/lib/actions/webhook-actions';
import { WEBHOOK_EVENTS, type WebhookDeliveryRow, type WebhookRow } from '@/lib/webhook-types';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { Field, FormAlert, Input, buttonClass } from '@/components/ui/form';

const EVENT_LABELS: Record<(typeof WEBHOOK_EVENTS)[number], { en: string; da: string }> = {
  'lead.created': { en: 'Lead created', da: 'Nyt emne oprettet' },
  'call.completed': { en: 'Call completed', da: 'Opkald afsluttet' },
  'estimate.recorded': { en: 'Estimate recorded', da: 'Overslag registreret' },
  'inspection.requested': { en: 'Inspection requested', da: 'Besigtigelse ønsket' },
  'owner.escalation': { en: 'Urgent escalation', da: 'Akut viderestilling' },
  'pipeline.stage_changed': { en: 'Stage changed', da: 'Fase ændret' },
};

export function WebhookManager({
  tenantId,
  webhooks,
  deliveries,
  isDanish = false,
  title,
  hint,
}: {
  tenantId: string | null;
  webhooks: WebhookRow[];
  deliveries: WebhookDeliveryRow[];
  isDanish?: boolean;
  title?: string;
  hint?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>(['lead.created', 'owner.escalation']);

  function runAction(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setFeedback(null);
    startTransition(async () => {
      const res = await fn();
      setFeedback({ ok: res.ok, text: res.ok ? res.message ?? 'Saved' : res.error ?? 'Error' });
    });
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    runAction(async () => {
      const res = await createWebhookAction(formData);
      if (res.ok) {
        setNewName('');
        setNewUrl('');
      }
      return res;
    });
  }

  return (
    <Card>
      <CardHeader
        title={title ?? (isDanish ? 'Webhooks & Dataeksport' : 'Outbound Webhooks')}
        hint={
          hint ??
          (isDanish
            ? 'Send hændelser i realtid med HMAC-SHA256 signatur (X-OMNI-Signature) til dit CRM eller n8n.'
            : 'Send real-time events signed with HMAC-SHA256 (X-OMNI-Signature) to your CRM, Zapier, or n8n.')
        }
        action={<Badge tone="neutral">{webhooks.length} configured</Badge>}
      />

      <div className="space-y-6 p-5">
        {feedback ? (
          <FormAlert tone={feedback.ok ? 'success' : 'error'}>{feedback.text}</FormAlert>
        ) : null}

        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-4"
        >
          <input type="hidden" name="tenantId" value={tenantId ?? ''} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field htmlFor="wh-new-name" label={isDanish ? 'Navn' : 'Webhook name'} required>
              <Input
                id="wh-new-name"
                name="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={isDanish ? 'n8n CRM Sync' : 'n8n / GoHighLevel Sync'}
                required
              />
            </Field>
            <Field htmlFor="wh-new-url" label={isDanish ? 'Endpoint URL (https)' : 'Endpoint URL'} required>
              <Input
                id="wh-new-url"
                name="url"
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://hooks.example.com/nordic-omni"
                className="font-mono"
                required
              />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-medium text-[var(--text-secondary)]">
              {isDanish ? 'Hændelser' : 'Subscribed events'}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WEBHOOK_EVENTS.map((evt) => {
                const checked = newEvents.includes(evt);
                return (
                  <label
                    key={evt}
                    className="flex cursor-pointer items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px]"
                  >
                    <input
                      type="checkbox"
                      name="events"
                      value={evt}
                      checked={checked}
                      onChange={(e) =>
                        setNewEvents((prev) =>
                          e.target.checked ? [...prev, evt] : prev.filter((item) => item !== evt)
                        )
                      }
                    />
                    <span>{isDanish ? EVENT_LABELS[evt].da : EVENT_LABELS[evt].en}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={isPending} className={buttonClass('primary', 'sm')}>
              {isPending
                ? isDanish
                  ? 'Gemmer…'
                  : 'Saving…'
                : isDanish
                  ? 'Tilføj webhook'
                  : 'Add webhook'}
            </button>
          </div>
        </form>

        {webhooks.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            {isDanish ? 'Ingen webhooks konfigureret endnu.' : 'No webhooks configured yet.'}
          </p>
        ) : (
          <div className="space-y-4">
            {webhooks.map((hook) => {
              const showSecret = Boolean(revealedSecrets[hook.id]);
              return (
                <div
                  key={hook.id}
                  className="space-y-3 rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.currentTarget);
                      runAction(() => updateWebhookAction(formData));
                    }}
                    className="space-y-3"
                  >
                    <input type="hidden" name="tenantId" value={tenantId ?? ''} />
                    <input type="hidden" name="webhookId" value={hook.id} />
                    <input type="hidden" name="isActive" value="off" />

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">
                          {hook.name}
                        </span>
                        <Badge tone={hook.is_active ? 'success' : 'neutral'}>
                          {hook.is_active ? 'Active' : 'Paused'}
                        </Badge>
                      </div>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          name="isActive"
                          value="on"
                          defaultChecked={hook.is_active}
                        />
                        <span>{isDanish ? 'Aktiv' : 'Enabled'}</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field htmlFor={`wh-name-${hook.id}`} label={isDanish ? 'Navn' : 'Name'}>
                        <Input
                          id={`wh-name-${hook.id}`}
                          name="name"
                          defaultValue={hook.name}
                          required
                        />
                      </Field>
                      <Field htmlFor={`wh-url-${hook.id}`} label="URL">
                        <Input
                          id={`wh-url-${hook.id}`}
                          name="url"
                          type="url"
                          defaultValue={hook.url}
                          className="font-mono"
                          required
                        />
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {WEBHOOK_EVENTS.map((evt) => (
                        <label
                          key={evt}
                          className="flex cursor-pointer items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-2.5 py-1.5 text-[11px]"
                        >
                          <input
                            type="checkbox"
                            name="events"
                            value={evt}
                            defaultChecked={hook.events.includes(evt)}
                          />
                          <span>{isDanish ? EVENT_LABELS[evt].da : EVENT_LABELS[evt].en}</span>
                        </label>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-[var(--text-muted)]">Secret:</span>
                        <code className="rounded bg-[var(--bg-ground)] px-2 py-0.5 font-mono text-[10px]">
                          {showSecret
                            ? hook.signing_secret
                            : `${hook.signing_secret.slice(0, 10)}••••••••`}
                        </code>
                        <button
                          type="button"
                          onClick={() =>
                            setRevealedSecrets((prev) => ({
                              ...prev,
                              [hook.id]: !prev[hook.id],
                            }))
                          }
                          className="text-[10px] font-medium text-[var(--accent-primary)] hover:underline"
                        >
                          {showSecret ? 'Hide' : 'Reveal'}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={isPending}
                          className={buttonClass('secondary', 'sm')}
                        >
                          {isDanish ? 'Gem' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </form>

                  <div className="flex flex-wrap items-center gap-2">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        runAction(() => testWebhookAction(fd));
                      }}
                    >
                      <input type="hidden" name="tenantId" value={tenantId ?? ''} />
                      <input type="hidden" name="webhookId" value={hook.id} />
                      <button
                        type="submit"
                        disabled={isPending}
                        className={buttonClass('ghost', 'sm')}
                      >
                        {isDanish ? 'Send test' : 'Send Test Webhook'}
                      </button>
                    </form>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        runAction(() => rotateWebhookSecretAction(fd));
                      }}
                    >
                      <input type="hidden" name="tenantId" value={tenantId ?? ''} />
                      <input type="hidden" name="webhookId" value={hook.id} />
                      <button
                        type="submit"
                        disabled={isPending}
                        className={buttonClass('ghost', 'sm')}
                      >
                        {isDanish ? 'Rotér nøgle' : 'Rotate Secret'}
                      </button>
                    </form>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        runAction(() => deleteWebhookAction(fd));
                      }}
                    >
                      <input type="hidden" name="tenantId" value={tenantId ?? ''} />
                      <input type="hidden" name="webhookId" value={hook.id} />
                      <button
                        type="submit"
                        disabled={isPending}
                        className={buttonClass('danger', 'sm')}
                      >
                        {isDanish ? 'Slet' : 'Delete'}
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {deliveries.length > 0 ? (
          <div className="space-y-2">
            <p className="text-eyebrow">
              {isDanish ? 'Seneste leveringer' : 'Recent webhook deliveries'}
            </p>
            <div className="overflow-x-auto rounded-[var(--r-md)] border border-[var(--border-subtle)]">
              <table className="w-full text-left text-[11px]">
                <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-ground)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2">Webhook</th>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="px-3 py-2 font-medium">{d.webhook_name ?? 'Webhook'}</td>
                      <td className="px-3 py-2 font-mono text-[10px]">{d.event_type}</td>
                      <td className="px-3 py-2">
                        <Badge tone={d.success ? 'success' : 'danger'}>
                          {d.success
                            ? `HTTP ${d.status_code ?? 200}`
                            : d.error ?? `HTTP ${d.status_code ?? 'ERR'}`}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[var(--text-muted)]">
                        {new Date(d.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
