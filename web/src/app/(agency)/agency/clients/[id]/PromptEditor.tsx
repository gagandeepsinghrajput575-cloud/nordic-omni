'use client';

import { useState, useTransition } from 'react';
import { updateAgentConfig, type ActionResult } from './actions';

interface PromptEditorProps {
  tenantId: string;
  initial: {
    customer_system_prompt: string;
    copilot_system_prompt: string;
    greeting_script: string | null;
  };
}

export function PromptEditor({ tenantId, initial }: PromptEditorProps) {
  const [customerPrompt, setCustomerPrompt] = useState(initial.customer_system_prompt);
  const [copilotPrompt, setCopilotPrompt] = useState(initial.copilot_system_prompt);
  const [greeting, setGreeting] = useState(initial.greeting_script ?? '');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDirty =
    customerPrompt !== initial.customer_system_prompt ||
    copilotPrompt !== initial.copilot_system_prompt ||
    greeting !== (initial.greeting_script ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const fd = new FormData();
    fd.set('tenantId', tenantId);
    fd.set('customer_system_prompt', customerPrompt);
    fd.set('copilot_system_prompt', copilotPrompt);
    fd.set('greeting_script', greeting);

    startTransition(async () => {
      const res = await updateAgentConfig(fd);
      setResult(res);
    });
  }

  const field =
    'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-xl border border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/5 px-3 py-2">
        <p className="text-[11px] text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--accent-primary)]">Agency only.</span>{' '}
          Clients can read this but cannot change it — enforced by a database
          policy, not by hiding the field.
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="customer_prompt" className="text-xs font-medium">
            Customer voice / chat prompt
          </label>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {customerPrompt.length} chars
          </span>
        </div>
        <textarea
          id="customer_prompt"
          rows={8}
          value={customerPrompt}
          onChange={(e) => setCustomerPrompt(e.target.value)}
          className={field}
          spellCheck={false}
        />
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          Instructions the receptionist agent follows on calls and chat.
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="copilot_prompt" className="text-xs font-medium">
            Owner co-pilot prompt
          </label>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {copilotPrompt.length} chars
          </span>
        </div>
        <textarea
          id="copilot_prompt"
          rows={5}
          value={copilotPrompt}
          onChange={(e) => setCopilotPrompt(e.target.value)}
          className={field}
          spellCheck={false}
        />
      </div>

      <div>
        <label htmlFor="greeting" className="mb-1.5 block text-xs font-medium">
          Greeting script <span className="text-[var(--text-muted)]">(spoken first)</span>
        </label>
        <input
          id="greeting"
          type="text"
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
        />
      </div>

      {result && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-xs ${
            result.ok
              ? 'border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]'
              : 'border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]'
          }`}
        >
          {result.ok ? result.message : result.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !isDirty}
          className="rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] transition hover:opacity-90 disabled:opacity-40"
        >
          {isPending ? 'Saving…' : 'Save behaviour'}
        </button>
        {isDirty && !isPending && (
          <span className="text-[11px] text-[var(--warning)]">Unsaved changes</span>
        )}
      </div>
    </form>
  );
}
