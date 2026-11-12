'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, MessageSquare, Phone, Send, ShieldCheck } from 'lucide-react';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { BrandMark } from '@/components/ui/BrandMark';
import { Badge } from '@/components/ui/core';
import { buttonClass } from '@/components/ui/form';
import { Spinner } from '@/components/ui/SubmitButton';

interface InitialMessage { id: string; role: 'customer' | 'ai'; content: string; channel: string; createdAt: string }
interface EstimateView { minimum: number; maximum: number; midpoint: number; service: string; squareMeters: number | null; disclaimer: string }
interface UiMessage extends InitialMessage { estimate?: EstimateView; notice?: boolean }

export function ChatClient({ contactId, contactName, tenantName, isDanish, initialMessages, autoReply }: {
  contactId: string; contactName: string | null; tenantName: string; isDanish: boolean; initialMessages: InitialMessage[]; autoReply: boolean;
}) {
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [handedOver, setHandedOver] = useState(!autoReply);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const t = (da: string, en: string) => isDanish ? da : en;
  const hasHistory = initialMessages.length > 0;
  const canSend = autoReply && !handedOver;
  const suggestions = isDanish
    ? ['Hvad er jeres åbningstider?', 'Kan I give et vejledende overslag?', 'Jeg vil gerne booke en tid.', 'Jeg vil gerne tale med en person.']
    : ['What are your opening hours?', 'Can you give a guide estimate?', 'I would like to book a time.', 'I would like to speak to a person.'];

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ top: container.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [text]);

  async function send(value: string) {
    const clean = value.trim();
    if (!clean || sending || !canSend) return;
    setError('');
    setSending(true);
    setText('');
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: 'customer', content: clean, channel: 'web_chat', createdAt: new Date().toISOString() }]);
    try {
      const response = await fetch(`/api/chat/${contactId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: clean }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t('Beskeden blev ikke sendt.', 'Message not sent.'));
      if (payload.handedOver) {
        setHandedOver(true);
        setMessages((current) => [...current, { id: `notice-${Date.now()}`, role: 'ai', content: payload.notice, channel: 'web_chat', createdAt: new Date().toISOString(), notice: true }]);
        return;
      }
      setMessages((current) => [...current, { id: payload.message?.id || `ai-${Date.now()}`, role: 'ai', content: payload.reply, channel: 'web_chat', createdAt: payload.message?.created_at || new Date().toISOString(), estimate: payload.estimate || undefined }]);
      if (payload.inspection?.recorded) {
        setMessages((current) => [...current, { id: `inspection-${Date.now()}`, role: 'ai', content: t('Besigtigelsen er registreret som en anmodning. Tiden er ikke bekræftet, før kontoret vender tilbage.', 'The inspection is recorded as a request. The time is not confirmed until the office replies.'), channel: 'system', createdAt: new Date().toISOString(), notice: true }]);
      }
      if (payload.escalation) {
        setMessages((current) => [...current, { id: `escalation-${Date.now()}`, role: 'ai', content: payload.escalation.delivered ? t('Din besked er sendt videre til kontoret.', 'Your message has been forwarded to the office.') : t('Henvendelsen er registreret til kontoret. Der er ikke oprettet en live forbindelse.', 'The request is recorded for the office. No live connection has been opened.'), channel: 'system', createdAt: new Date().toISOString(), notice: true }]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Beskeden fejlede.', 'Message failed.'));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <header className="public-header enter">
        <Link href={`/call/${contactId}`} className="flex min-w-0 items-center gap-2.5"><BrandMark size={28} /><span className="truncate text-[14px] font-semibold tracking-[-0.02em]">{tenantName}</span></Link>
        <div className="flex items-center gap-2"><Link href={`/call/${contactId}`} className={buttonClass('ghost', 'sm')} aria-label={t('Ring i stedet', 'Call instead')}><Phone size={14} /><span className="hidden sm:inline">{t('Ring i stedet', 'Call instead')}</span></Link><ThemeSwitcher /></div>
      </header>
      <h1 className="sr-only lg:hidden">{t(`Chat med ${tenantName}`, `Chat with ${tenantName}`)}</h1>
      <div className="grid items-stretch gap-8 lg:grid-cols-[minmax(260px,0.62fr)_minmax(0,1.38fr)] lg:gap-12">
        <aside className="enter enter-delay hidden flex-col justify-between py-6 lg:flex">
          <div>
            <Badge tone="accent">{t('AI-assistent', 'AI assistant')}</Badge>
            <h1 className="mt-5 text-[clamp(30px,3.6vw,44px)] font-semibold leading-[1.08] tracking-[-0.05em]">{t('Hvad kan vi hjælpe med?', 'What can we help with?')}</h1>
            <p className="mt-4 max-w-[380px] text-[15px] leading-7 text-[var(--text-secondary)]">{t('Skriv kort, hvad du har brug for. Assistenten kan svare på spørgsmål, hjælpe med at afklare sagen og finde næste skridt.', 'Write briefly about what you need. The assistant can answer questions, help clarify the case and find the next step.')}</p>
            <dl className="mt-9 space-y-5">{[
              [t('Konkret svar', 'A direct answer'), t('Kun fra virksomhedens godkendte viden.', 'Only from the business’s approved knowledge.')],
              [t('Kort samtale', 'A short conversation'), t('Et spørgsmål ad gangen, ikke en tekstvæg.', 'One question at a time, not a wall of text.')],
              [t('Næste skridt', 'A next step'), t('Overslag er vejledende. En aftale giver sikkerhed.', 'Estimates are guides. An agreement gives certainty.')],
            ].map(([title, body]) => <div key={title}><dt className="text-[13px] font-semibold">{title}</dt><dd className="mt-1 text-[13px] leading-6 text-[var(--muted)]">{body}</dd></div>)}</dl>
          </div>
          <p className="mt-8 text-[12px] leading-6 text-[var(--muted)]">{t('Assistenten kan tage fejl. Prissvar er altid vejledende og ikke bindende.', 'The assistant can make mistakes. Price answers are always guides, never binding.')}</p>
        </aside>
        <section className="enter enter-delay-2 glass flex h-[calc(100dvh-190px)] min-h-[520px] flex-col overflow-hidden lg:h-[calc(100dvh-150px)] lg:min-h-[600px]" aria-label={t('Chat med virksomheden', 'Chat with the business')}>
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
            <div className="flex items-center gap-2.5"><MessageSquare size={16} className="text-[var(--accent-primary)]" aria-hidden /><h2 className="text-[14px] font-semibold tracking-[-0.02em]">{t('Skriv til os', 'Message us')}</h2></div>
            <span className="text-[12px] text-[var(--muted)]">{handedOver ? t('Kontoret har overtaget', 'The office has taken over') : hasHistory ? t('Fortsætter din samtale', 'Continuing your conversation') : t('AI-assistent', 'AI assistant')}</span>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5" role="log" aria-live="polite" aria-relevant="additions">
            {!hasHistory ? <Bubble role="ai" channel="web_chat" isDanish={isDanish}>{t(`Hej${contactName ? ` ${contactName.split(' ')[0]}` : ''}. Skriv kort, hvad du har brug for, så hjælper jeg dig videre.`, `Hi${contactName ? ` ${contactName.split(' ')[0]}` : ''}. Tell me briefly what you need and I’ll help you forward.`)}</Bubble> : null}
            {messages.map((message) => <div key={message.id} className="space-y-2"><Bubble role={message.role} channel={message.channel} notice={message.notice} isDanish={isDanish}>{message.content}</Bubble>{message.estimate ? <EstimateCard estimate={message.estimate} /> : null}</div>)}
            {sending ? <div className="flex items-center gap-2 px-1 text-[12px] text-[var(--muted)]"><Spinner className="h-3.5 w-3.5" />{t('Tænker…', 'Thinking…')}</div> : null}
            {error ? <p className="notice notice-danger" role="alert">{error}</p> : null}
          </div>
          <div className="border-t border-[var(--line)] p-3 sm:p-4">
            {canSend ? <div className="mb-3 flex flex-wrap gap-1.5">{suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={sending} onClick={() => void send(suggestion)} className="quick-action">{suggestion}</button>)}</div> : null}
            <div className="flex items-end gap-2">
              <label htmlFor="chat-message" className="sr-only">{t('Skriv en besked', 'Write a message')}</label>
              <textarea ref={inputRef} id="chat-message" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(text); } }} rows={1} maxLength={700} disabled={!canSend} placeholder={canSend ? t('Skriv en kort besked…', 'Write a short message…') : t('Kontoret har overtaget samtalen', 'The office has taken over')} className="input max-h-32 min-h-11 flex-1 resize-none py-3" />
              <button type="button" onClick={() => void send(text)} disabled={!text.trim() || sending || !canSend} aria-label={t('Send besked', 'Send message')} className={buttonClass('primary', 'md', 'icon-button h-11 w-11 shrink-0')}><Send size={17} /></button>
            </div>
            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11px] leading-5 text-[var(--muted)]"><ShieldCheck size={12} className="shrink-0" aria-hidden />{t('AI-svar kan tage fejl. En skriftlig aftale gælder.', 'AI answers can be wrong. A written agreement governs.')}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Bubble({ role, channel, notice, isDanish, children }: { role: 'customer' | 'ai'; channel: string; notice?: boolean; isDanish: boolean; children: React.ReactNode }) {
  const isCustomer = role === 'customer';
  const fromCall = channel === 'voice_inbound' || channel === 'voice_instant_webrtc';
  return <div className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}><div className={`chat-bubble ${isCustomer ? 'chat-bubble-customer' : notice ? 'chat-bubble-notice' : 'chat-bubble-ai'}`}>{fromCall ? <span className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]"><Phone size={10} aria-hidden />{isDanish ? 'Telefon' : 'Phone'}</span> : null}<p className="whitespace-pre-wrap">{children}</p></div></div>;
}

function EstimateCard({ estimate }: { estimate: EstimateView }) {
  const format = (value: number) => `${Math.round(value).toLocaleString('da-DK')} DKK`;
  return <div className="ml-1 max-w-[86%] rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-4"><div className="flex items-center gap-2 text-[12px] font-medium text-[var(--accent-primary)]"><CalendarCheck size={14} aria-hidden />{estimate.service}</div><p className="mt-2 text-[18px] font-semibold tabular-nums tracking-[-0.03em]">{format(estimate.minimum)} – {format(estimate.maximum)}</p><p className="mt-1.5 text-[12px] leading-5 text-[var(--text-secondary)]">{estimate.disclaimer}</p></div>;
}
