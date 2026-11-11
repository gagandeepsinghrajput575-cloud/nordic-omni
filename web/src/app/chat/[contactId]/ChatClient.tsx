'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CalendarCheck,
  LoaderCircle,
  MessageSquare,
  Phone,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';

interface InitialMessage {
  id: string;
  role: 'customer' | 'ai';
  content: string;
  channel: string;
  createdAt: string;
}

interface EstimateView {
  minimum: number;
  maximum: number;
  midpoint: number;
  service: string;
  squareMeters: number | null;
  disclaimer: string;
}

interface UiMessage extends InitialMessage {
  estimate?: EstimateView;
  notice?: boolean;
}

const QUICK_DA = ['Badeværelse', 'Køkken', 'Nyt tag', 'Tilbygning'];
const QUICK_EN = ['Bathroom', 'Kitchen', 'New roof', 'Extension'];

export function ChatClient({
  contactId,
  contactName,
  tenantName,
  isDanish,
  initialMessages,
  autoReply,
}: {
  contactId: string;
  contactName: string | null;
  tenantName: string;
  isDanish: boolean;
  initialMessages: InitialMessage[];
  autoReply: boolean;
}) {
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const quick = isDanish ? QUICK_DA : QUICK_EN;
  const hasHistory = initialMessages.length > 0;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function send(value: string) {
    const clean = value.trim();
    if (!clean || sending || !autoReply) return;
    setError('');
    setSending(true);
    setText('');

    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: 'customer',
        content: clean,
        channel: 'web_chat',
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const response = await fetch(`/api/chat/${contactId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: clean }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.error || (isDanish ? 'Beskeden blev ikke sendt.' : 'Message not sent.'),
        );
      }

      if (payload.handedOver) {
        setMessages((current) => [
          ...current,
          {
            id: `notice-${Date.now()}`,
            role: 'ai',
            content: payload.notice,
            channel: 'web_chat',
            createdAt: new Date().toISOString(),
            notice: true,
          },
        ]);
        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: payload.message?.id || `ai-${Date.now()}`,
          role: 'ai',
          content: payload.reply,
          channel: 'web_chat',
          createdAt: payload.message?.created_at || new Date().toISOString(),
          estimate: payload.estimate || undefined,
        },
      ]);

      if (payload.inspection?.recorded) {
        setMessages((current) => [
          ...current,
          {
            id: `inspection-${Date.now()}`,
            role: 'ai',
            content: isDanish
              ? 'Besigtigelsen er registreret som en anmodning. Tiden er ikke bekræftet, før kontoret vender tilbage.'
              : 'The inspection is recorded as a request. The time is not confirmed until the office replies.',
            channel: 'system',
            createdAt: new Date().toISOString(),
            notice: true,
          },
        ]);
      }

      if (payload.escalation) {
        setMessages((current) => [
          ...current,
          {
            id: `escalation-${Date.now()}`,
            role: 'ai',
            content: payload.escalation.delivered
              ? isDanish
                ? 'Din besked er sendt videre til kontoret.'
                : 'Your message has been forwarded to the office.'
              : isDanish
                ? 'Henvendelsen er registreret til kontoret. Der er ikke oprettet en live forbindelse.'
                : 'The request is recorded for the office. No live connection has been opened.',
            channel: 'system',
            createdAt: new Date().toISOString(),
            notice: true,
          },
        ]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Message failed.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1160px]">
      <header className="enter mb-7 flex items-center justify-between gap-4">
        <Link href={`/call/${contactId}`} className="flex items-center gap-3 text-[var(--text)]">
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--bg-raised)] text-[16px] font-black text-[var(--accent-primary)]">
            {tenantName.charAt(0)}
          </span>
          <span className="text-[13px] font-medium text-[var(--text-secondary)]">{tenantName}</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href={`/call/${contactId}`}
            className="hidden items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] sm:flex"
          >
            <Phone size={13} />
            {isDanish ? 'Ring i stedet' : 'Call instead'}
          </Link>
          <ThemeSwitcher />
        </div>
      </header>

      <div className="mb-4 lg:hidden">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.045em] text-[var(--text)]">
          {isDanish ? 'Hvad kan vi hjælpe med?' : 'What can we help with?'}
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--text-secondary)]">
          {isDanish
            ? 'Skriv kort om opgaven. Vi hjælper med spørgsmål, overslag og besigtigelse.'
            : 'Describe the task briefly. We help with questions, estimates and inspections.'}
        </p>
      </div>

      <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(280px,0.68fr)_minmax(0,1.32fr)]">
        <aside className="enter enter-delay hidden flex-col justify-between px-2 py-5 lg:flex">
          <div>
            <p className="text-[13px] text-[var(--text-secondary)]">
              {isDanish ? 'AI-assistent · skriftlig' : 'AI assistant · written'}
            </p>
            <h1 className="mt-3 text-[clamp(2rem,3.8vw,3.3rem)] font-semibold leading-[1.02] tracking-[-0.05em] text-[var(--text)]">
              {isDanish ? 'Hvad kan vi hjælpe med?' : 'What can we help with?'}
            </h1>
            <p className="mt-4 max-w-[390px] text-[15px] leading-7 text-[var(--text-secondary)]">
              {isDanish
                ? 'Skriv kort om opgaven. Assistenten kan svare på spørgsmål, hjælpe med at afklare projektet og finde næste skridt.'
                : 'Describe the task in a few words. The assistant can answer questions, scope the project and suggest the next step.'}
            </p>

            <dl className="mt-8 space-y-4">
              {[
                {
                  title: isDanish ? 'Konkret svar' : 'A direct answer',
                  body: isDanish
                    ? 'Kun fra virksomhedens godkendte viden.'
                    : 'Only from the business’s approved knowledge.',
                },
                {
                  title: isDanish ? 'Kort samtale' : 'A short conversation',
                  body: isDanish
                    ? 'Et spørgsmål ad gangen, ikke en tekstvæg.'
                    : 'One question at a time, not a wall of text.',
                },
                {
                  title: isDanish ? 'Næste skridt' : 'A next step',
                  body: isDanish
                    ? 'Overslag er vejledende. Besigtigelse giver sikkerhed.'
                    : 'Estimates are guides. An inspection gives certainty.',
                },
              ].map((item) => (
                <div key={item.title}>
                  <dt className="text-[13px] font-semibold text-[var(--text)]">{item.title}</dt>
                  <dd className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
                    {item.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="text-[12px] leading-5 text-[var(--text-muted)]">
            {isDanish
              ? 'Assistenten kan tage fejl. Prissvar er altid vejledende og ikke bindende.'
              : 'The assistant can make mistakes. All price answers are guides, never binding.'}
          </p>
        </aside>

        <section className="enter enter-delay-2 flex h-[calc(100dvh-235px)] min-h-[520px] flex-col overflow-hidden rounded-[14px] bg-[var(--bg-surface)] lg:h-[calc(100dvh-150px)] lg:min-h-[620px]">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-center gap-2.5">
              <MessageSquare size={15} className="text-[var(--accent-primary)]" />
              <span className="text-[13px] font-medium text-[var(--text)]">
                {isDanish ? 'Skriv til os' : 'Message us'}
              </span>
            </div>
            <span className="text-[12px] text-[var(--text-muted)]">
              {hasHistory
                ? isDanish
                  ? 'Fortsætter din samtale'
                  : 'Continuing your conversation'
                : isDanish
                  ? 'AI-assistent'
                  : 'AI assistant'}
            </span>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 pb-4 sm:px-5">
            {!hasHistory ? (
              <Bubble role="ai" channel="web_chat">
                {isDanish
                  ? `Hej${contactName ? ` ${contactName.split(' ')[0]}` : ''}. Skriv kort, hvad du har brug for. Jeg kan hjælpe med spørgsmål, overslag og besigtigelse.`
                  : `Hi${contactName ? ` ${contactName.split(' ')[0]}` : ''}. Tell me briefly what you need. I can help with questions, estimates and inspections.`}
              </Bubble>
            ) : null}

            {messages.map((message) => (
              <div key={message.id} className="space-y-2">
                <Bubble role={message.role} channel={message.channel} notice={message.notice}>
                  {message.content}
                </Bubble>
                {message.estimate ? <EstimateCard estimate={message.estimate} /> : null}
              </div>
            ))}

            {sending ? (
              <div className="flex items-center gap-2 px-2 text-[12px] text-[var(--text-muted)]">
                <LoaderCircle size={14} className="animate-spin" />
                {isDanish ? 'Tænker…' : 'Thinking…'}
              </div>
            ) : null}
            {error ? <p className="px-2 text-[12px] text-[var(--danger)]">{error}</p> : null}
          </div>

          <div className="border-t border-[var(--line)] p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {quick.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={sending || !autoReply}
                  onClick={() =>
                    void send(
                      isDanish
                        ? `Jeg er interesseret i ${suggestion.toLowerCase()}.`
                        : `I am interested in ${suggestion.toLowerCase()}.`,
                    )
                  }
                  className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send(text);
                  }
                }}
                rows={1}
                maxLength={700}
                disabled={!autoReply}
                placeholder={
                  autoReply
                    ? isDanish
                      ? 'Skriv en kort besked…'
                      : 'Write a short message…'
                    : isDanish
                      ? 'Kontoret har overtaget samtalen'
                      : 'The office has taken over'
                }
                className="max-h-28 min-h-11 flex-1 resize-none rounded-[10px] border border-[var(--line)] bg-[var(--bg-ground)] px-3.5 py-3 text-[14px] leading-5 text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void send(text)}
                disabled={!text.trim() || sending || !autoReply}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent-primary)] text-[var(--accent-contrast)] transition-opacity disabled:opacity-35"
                aria-label={isDanish ? 'Send besked' : 'Send message'}
              >
                <Send size={17} />
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] leading-4 text-[var(--text-muted)]">
              <ShieldCheck size={11} className="mr-1 inline" />
              {isDanish
                ? 'AI-svar kan tage fejl. Besigtigelse og skriftlig aftale gælder.'
                : 'AI answers can be wrong. An inspection and written agreement govern.'}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Bubble({
  role,
  channel,
  notice,
  children,
}: {
  role: 'customer' | 'ai';
  channel: string;
  notice?: boolean;
  children: React.ReactNode;
}) {
  const isCustomer = role === 'customer';
  const fromCall = channel === 'voice_inbound' || channel === 'voice_instant_webrtc';
  return (
    <div className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[560px] rounded-[12px] px-3.5 py-2.5 ${
          isCustomer
            ? 'rounded-br-[4px] bg-[var(--accent-primary)] text-[var(--accent-contrast)]'
            : notice
              ? 'border border-[var(--line)] bg-[var(--bg-ground)] text-[var(--text-secondary)]'
              : 'rounded-bl-[4px] bg-[var(--bg-raised)] text-[var(--text)]'
        }`}
      >
        {fromCall ? (
          <span className="mb-1 block text-[9px] uppercase tracking-[0.08em] opacity-60">
            <Phone size={9} className="mr-1 inline" /> Telefon
          </span>
        ) : null}
        <p className="whitespace-pre-wrap text-[14px] leading-6">{children}</p>
      </div>
    </div>
  );
}

function EstimateCard({ estimate }: { estimate: EstimateView }) {
  const format = (value: number) => `${Math.round(value).toLocaleString('da-DK')} DKK`;
  return (
    <div className="ml-1 max-w-[86%] rounded-[12px] border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/5 p-3.5">
      <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--accent-primary)]">
        <CalendarCheck size={13} />
        {estimate.service}
      </div>
      <p className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--text)]">
        {format(estimate.minimum)} – {format(estimate.maximum)}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
        {estimate.disclaimer}
      </p>
    </div>
  );
}

