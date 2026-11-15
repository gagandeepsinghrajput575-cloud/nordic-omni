'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Loader2, Send, Sparkles, Store, UserRound } from 'lucide-react';
import type { AgencyClientMessage, ChatState } from '@/contracts/schemas';

interface ClientDirectChatPanelProps {
  tenantId: string;
  tenantName: string;
  contactId?: string | null;
  initialMessages: AgencyClientMessage[];
  initialState: ChatState;
}

const clockOf = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
};

/**
 * The client's own conversation with their agency.
 *
 * Mobile-first: full-width bubbles, 44px minimum tap targets, and the composer
 * pinned to the bottom of the card so it stays reachable with a thumb.
 *
 * The client never sees a send control that posts as anyone but themselves —
 * the server stamps the role, and this UI has no concept of another actor.
 */
export function ClientDirectChatPanel({
  tenantId,
  tenantName,
  contactId = null,
  initialMessages,
  initialState,
}: ClientDirectChatPanelProps) {
  const reduceMotion = useReducedMotion();
  const [messages, setMessages] = useState<AgencyClientMessage[]>(initialMessages);
  const [state, setState] = useState<ChatState>(initialState);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [messages.length, thinking, reduceMotion]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || pending) return;

    setPending(true);
    setThinking(true);
    setError(null);

    const optimistic: AgencyClientMessage = {
      id: `optimistic-${Date.now()}`,
      tenantId,
      senderRole: 'client',
      senderRef: null,
      channel: 'web_chat',
      kind: 'message',
      body,
      delegationId: null,
      metadata: { optimistic: true },
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setDraft('');

    try {
      const response = await fetch('/api/portal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, contactId, body }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Beskeden kunne ikke sendes');
      }
      const data = (await response.json()) as {
        message: AgencyClientMessage;
        reply?: AgencyClientMessage;
        state: ChatState;
      };
      setState(data.state);
      // Replace the optimistic row with the server's copy of record, then append
      // the co-pilot's reply if one was generated.
      setMessages((current) => {
        const withoutOptimistic = current.filter((message) => message.id !== optimistic.id);
        return data.reply ? [...withoutOptimistic, data.message, data.reply] : [...withoutOptimistic, data.message];
      });
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(body);
      setError(cause instanceof Error ? cause.message : 'Beskeden kunne ikke sendes');
    } finally {
      setPending(false);
      setThinking(false);
    }
  }, [draft, pending, tenantId, contactId]);

  return (
    <section
      className="flex min-h-[60vh] flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-raised)]"
      aria-label={`Samtale med ${tenantName}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Store size={16} className="shrink-0 text-[var(--accent-primary)]" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{tenantName}</p>
            <p className="text-[10.5px] text-[var(--text-muted)]">
              {state.aiEnabled ? 'Assistenten svarer med det samme' : 'En medarbejder svarer dig'}
            </p>
          </div>
        </div>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            state.aiEnabled ? 'bg-[var(--studio-mint)]' : 'bg-[var(--studio-amber)]'
          }`}
          aria-hidden
        />
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <p className="px-3 py-10 text-center text-[12.5px] text-[var(--text-muted)]">
            Skriv din første besked — vi vender tilbage hurtigst muligt.
          </p>
        ) : (
          messages.map((message) => {
            const mine = message.senderRole === 'client';
            const isCopilot = message.senderRole === 'ai_copilot';
            return (
              <motion.div
                key={message.id}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.18 }}
                className={`flex gap-2 ${mine ? 'justify-end' : 'justify-start'}`}
              >
                {!mine ? (
                  <span
                    className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      isCopilot
                        ? 'bg-[color-mix(in_srgb,var(--accent-secondary)_20%,transparent)]'
                        : 'bg-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)]'
                    }`}
                    aria-hidden
                  >
                    {isCopilot ? <Sparkles size={12} /> : <UserRound size={12} />}
                  </span>
                ) : null}
                <div
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${
                    mine
                      ? 'rounded-br-md border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--text)]'
                      : 'rounded-bl-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text)]'
                  }`}
                >
                  {!mine ? (
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                      {isCopilot ? 'Assistent' : 'Agentur'}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{message.body}</p>
                  <p
                    className="mt-1 text-right text-[10px] text-[var(--text-muted)]"
                  >
                    {clockOf(message.createdAt)}
                  </p>
                </div>
              </motion.div>
            );
          })
        )}

        {thinking ? (
          <div className="flex items-center gap-2 px-1 text-[11.5px] text-[var(--text-muted)]" role="status">
            <span className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((index) => (
                <motion.span
                  key={index}
                  className="h-1.5 w-1.5 rounded-full bg-[var(--accent-secondary)]"
                  animate={reduceMotion ? undefined : { opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.15 }}
                />
              ))}
            </span>
            Assistenten skriver…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <p role="alert" className="flex items-start gap-2 px-4 pb-1 text-[11.5px] text-[var(--danger)]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="border-t border-[var(--border-subtle)] p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={1}
            placeholder="Skriv en besked…"
            aria-label="Din besked"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-[var(--border-subtle)] bg-[var(--input)] px-3 py-2.5 text-[13px] text-[var(--text)] outline-none transition-[border-color,box-shadow] focus:border-[var(--accent-primary)] focus:shadow-[0_0_0_3px_var(--focus-ring)]"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={pending || draft.trim().length === 0}
            className="btn btn-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-xl p-0 disabled:opacity-50"
            aria-label="Send besked"
          >
            {pending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
          </button>
        </div>
      </div>
    </section>
  );
}
