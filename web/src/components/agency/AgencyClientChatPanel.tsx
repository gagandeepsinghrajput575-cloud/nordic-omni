'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  Bot,
  Check,
  CircleSlash,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { StudioPanel, StudioStatusBar, Pill, Tag } from '@/components/ui/primitives';
import type {
  AgencyClientMessage,
  ChatState,
  CopilotDelegation,
  SenderRole,
} from '@/contracts/schemas';

interface AgencyClientChatPanelProps {
  tenantId: string;
  tenantName: string;
  contactId?: string | null;
  contactName?: string | null;
  initialMessages: AgencyClientMessage[];
  initialDelegations: CopilotDelegation[];
  initialState: ChatState;
}

/**
 * Per-actor visual language.
 *
 * The three participants must be distinguishable at a glance, and not by colour
 * alone: each carries a label and an icon too, because an operator scanning a
 * busy thread cannot rely on hue (and colour-blind users cannot either).
 */
const ACTOR: Record<
  SenderRole,
  { label: string; icon: typeof Bot; chip: string; bubble: string; ring: string }
> = {
  agency_operator: {
    label: 'Agentur',
    icon: ShieldCheck,
    chip: 'text-[var(--accent-primary)]',
    bubble:
      'bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] border-[color-mix(in_srgb,var(--accent-primary)_38%,transparent)]',
    ring: 'ring-[color-mix(in_srgb,var(--accent-primary)_45%,transparent)]',
  },
  ai_copilot: {
    label: 'Co-pilot',
    icon: Sparkles,
    chip: 'text-[var(--accent-secondary)]',
    bubble:
      'bg-[color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] border-[color-mix(in_srgb,var(--accent-secondary)_34%,transparent)]',
    ring: 'ring-[color-mix(in_srgb,var(--accent-secondary)_42%,transparent)]',
  },
  client: {
    label: 'Kunde',
    icon: UserRound,
    chip: 'text-[var(--studio-mint)]',
    bubble: 'bg-[var(--glass-soft)] border-[var(--border-subtle)]',
    ring: 'ring-[color-mix(in_srgb,var(--studio-mint)_38%,transparent)]',
  },
};

const clockOf = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
};

export function AgencyClientChatPanel({
  tenantId,
  tenantName,
  contactId = null,
  contactName = null,
  initialMessages,
  initialDelegations,
  initialState,
}: AgencyClientChatPanelProps) {
  const reduceMotion = useReducedMotion();
  const [messages, setMessages] = useState<AgencyClientMessage[]>(initialMessages);
  const [delegations, setDelegations] = useState<CopilotDelegation[]>(initialDelegations);
  const [state, setState] = useState<ChatState>(initialState);

  const [draft, setDraft] = useState('');
  const [delegateDraft, setDelegateDraft] = useState('');
  const [mode, setMode] = useState<'message' | 'delegate'>('message');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view without hijacking scroll on first paint.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [messages.length, reduceMotion]);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (contactId) params.set('contactId', contactId);
    const response = await fetch(`/api/agency/clients/${tenantId}/chat?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Kunne ikke hente chatten');
    const data = (await response.json()) as {
      messages: AgencyClientMessage[];
      delegations: CopilotDelegation[];
      state: ChatState;
    };
    setMessages(data.messages);
    setDelegations(data.delegations);
    setState(data.state);
  }, [tenantId, contactId]);

  // Poll while the thread is open: the client may answer at any moment and the
  // operator should not have to hit refresh to see it.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const postMessage = async () => {
    const body = draft.trim();
    if (!body || pending) return;
    setPending(true);
    setError(null);

    // Optimistic append: the operator sees their own words immediately.
    const optimistic: AgencyClientMessage = {
      id: `optimistic-${Date.now()}`,
      tenantId,
      senderRole: 'agency_operator',
      senderRef: null,
      channel: 'portal',
      kind: 'message',
      body,
      delegationId: null,
      metadata: { optimistic: true },
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setDraft('');

    try {
      const response = await fetch(`/api/agency/clients/${tenantId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message', body, contactId }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Beskeden kunne ikke sendes');
      }
      // Re-sync rather than trusting the optimistic row: the server stamps role
      // and id, and that is the copy of record.
      await refresh();
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(body);
      setError(cause instanceof Error ? cause.message : 'Beskeden kunne ikke sendes');
    } finally {
      setPending(false);
    }
  };

  const sendDelegation = async () => {
    const instruction = delegateDraft.trim();
    if (instruction.length < 4 || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/agency/clients/${tenantId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delegation',
          instruction,
          contactId,
          contactName,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Opgaven kunne ikke sendes');
      }
      setDelegateDraft('');
      setMode('message');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Opgaven kunne ikke sendes');
    } finally {
      setPending(false);
    }
  };

  const toggleAi = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/agency/clients/${tenantId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_ai', enabled: !state.aiEnabled }),
      });
      if (!response.ok) throw new Error('Kunne ikke skifte co-pilot');
      const data = (await response.json()) as { state: ChatState };
      setState(data.state);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kunne ikke skifte co-pilot');
    } finally {
      setPending(false);
    }
  };

  // Delegations still waiting for the client, surfaced above the thread.
  const openDelegations = useMemo(
    () => delegations.filter((delegation) => delegation.status === 'sent'),
    [delegations],
  );

  return (
    <div className="space-y-4">
      <StudioPanel flush>
        <StudioStatusBar>
          <div className="flex items-center gap-2">
            <Users size={14} className="text-[var(--accent-primary)]" aria-hidden />
            <span className="text-[12px] font-medium">Fælles tråd · {tenantName}</span>
            {contactName ? <Tag>{contactName}</Tag> : <Tag>Alle kunder</Tag>}
          </div>

          <div className="flex items-center gap-2">
            <Pill tone={state.aiEnabled ? 'live' : 'warn'} dot>
              {state.aiEnabled ? 'Co-pilot aktiv' : 'Co-pilot sat på pause'}
            </Pill>
            <button
              type="button"
              onClick={() => void toggleAi()}
              disabled={pending}
              className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--glass-soft)] disabled:opacity-50"
              aria-label={state.aiEnabled ? 'Sæt co-pilot på pause' : 'Genaktivér co-pilot'}
            >
              {state.aiEnabled ? 'Pause' : 'Genaktivér'}
            </button>
          </div>
        </StudioStatusBar>

        {!state.aiEnabled && state.pausedReason ? (
          <p className="border-b border-[var(--border-subtle)] bg-[var(--glass-soft)] px-4 py-2 text-[11.5px] text-[var(--text-muted)]">
            {state.pausedReason} Co-piloten svarer ikke kunden, før den genaktiveres.
          </p>
        ) : null}

        {/* The thread */}
        <div className="max-h-[440px] min-h-[240px] space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-[12px] text-[var(--text-muted)]">
              Ingen beskeder endnu. Skriv en besked, eller giv co-piloten en opgave.
            </p>
          ) : (
            messages.map((message) => {
              const actor = ACTOR[message.senderRole];
              const ActorIcon = actor.icon;
              const isOptimistic =
                typeof message.metadata.optimistic === 'boolean' && message.metadata.optimistic;
              return (
                <motion.div
                  key={message.id}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18 }}
                  className={`flex ${message.senderRole === 'agency_operator' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl border px-3 py-2 ${actor.bubble} ${
                      isOptimistic ? 'opacity-70' : ''
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <ActorIcon size={12} className={actor.chip} aria-hidden />
                      <span className={`text-[10.5px] font-semibold uppercase tracking-[0.06em] ${actor.chip}`}>
                        {actor.label}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">{clockOf(message.createdAt)}</span>
                      {message.kind === 'delegation' ? <Tag>Opgave</Tag> : null}
                    </div>
                    <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed">{message.body}</p>
                  </div>
                </motion.div>
              );
            })
          )}

          {pending && mode === 'delegate' ? (
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]" role="status">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Co-piloten formulerer spørgsmålet…
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 border-t border-[var(--border-subtle)] px-4 py-2 text-[11.5px] text-[var(--danger)]"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        {/* Composer */}
        <div className="border-t border-[var(--border-subtle)] p-3">
          <div className="mb-2 flex gap-1.5" role="tablist" aria-label="Beskedtype">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'message'}
              onClick={() => setMode('message')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                mode === 'message'
                  ? 'bg-[var(--glass-soft)] text-[var(--text-primary)] ring-1 ' + ACTOR.agency_operator.ring
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <ShieldCheck size={12} aria-hidden />
              Skriv som agentur
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'delegate'}
              onClick={() => setMode('delegate')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                mode === 'delegate'
                  ? 'bg-[var(--glass-soft)] text-[var(--text-primary)] ring-1 ' + ACTOR.ai_copilot.ring
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Bot size={12} aria-hidden />
              Delegér til co-pilot
            </button>
          </div>

          {mode === 'message' ? (
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void postMessage();
                  }
                }}
                rows={2}
                placeholder="Skriv til kunden… (Enter sender, Shift+Enter giver ny linje)"
                className="min-h-[42px] flex-1 resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--input)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-[border-color,box-shadow] focus:border-[var(--accent-primary)] focus:shadow-[0_0_0_3px_rgba(201,184,255,.18)]"
                aria-label="Besked til kunden"
              />
              <button
                type="button"
                onClick={() => void postMessage()}
                disabled={pending || draft.trim().length === 0}
                className="btn btn-accent inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold disabled:opacity-50"
              >
                {pending ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Send size={13} aria-hidden />}
                Send
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={delegateDraft}
                onChange={(event) => setDelegateDraft(event.target.value)}
                rows={2}
                placeholder="Fx: Spørg Hans om de tager opgaver i Roskilde"
                className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-2 text-[12.5px] outline-none focus:border-[var(--accent-secondary)]"
                aria-label="Instruks til co-piloten"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10.5px] leading-snug text-[var(--text-muted)]">
                  Co-piloten spørger i jeres navn og opsummerer svaret her i tråden.
                </p>
                <button
                  type="button"
                  onClick={() => void sendDelegation()}
                  disabled={pending || delegateDraft.trim().length < 4}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--accent-secondary)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent-secondary)_16%,transparent)] px-3 py-2 text-[12px] font-medium disabled:opacity-50"
                >
                  {pending ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />}
                  Send opgave
                </button>
              </div>
            </div>
          )}
        </div>
      </StudioPanel>

      {/* Delegation ledger */}
      <StudioPanel>
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
          <h3 className="text-[12px] font-medium">Co-pilot opgaver</h3>
          <Tag>{openDelegations.length} åbne</Tag>
        </div>
        {delegations.length === 0 ? (
          <p className="px-4 py-6 text-center text-[11.5px] text-[var(--text-muted)]">
            Ingen opgaver sendt endnu.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {delegations.slice(0, 6).map((delegation) => (
              <li key={delegation.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill
                    tone={delegation.status === 'answered' ? 'live' : delegation.status === 'closed' ? 'default' : 'warn'}
                  >
                    {delegation.status === 'sent'
                      ? 'Afventer svar'
                      : delegation.status === 'answered'
                        ? 'Besvaret'
                        : delegation.status === 'pending'
                          ? 'Kladde'
                          : 'Lukket'}
                  </Pill>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {clockOf(delegation.createdAt)}
                  </span>
                  {delegation.needsAgencyInput ? (
                    <Tag className="mint">
                      <AlertTriangle size={9} aria-hidden /> Kræver din vurdering
                    </Tag>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)]">Spørgsmål: </span>
                  {delegation.question ?? delegation.instruction}
                </p>
                {delegation.summary ? (
                  <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed">
                    <Check size={12} className="mt-0.5 shrink-0 text-[var(--studio-mint)]" aria-hidden />
                    {delegation.summary}
                  </p>
                ) : (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <CircleSlash size={11} aria-hidden />
                    Venter på kundens svar.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </StudioPanel>
    </div>
  );
}
