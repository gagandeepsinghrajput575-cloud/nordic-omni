'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Command, Send, CheckCircle2, AlertCircle, ArrowRight, X } from 'lucide-react';
import { executeClientAiCommand, type AiCommandResult } from '@/app/(client)/portal/ai-actions';
import { buttonClass } from '@/components/ui/form';
import { Spinner } from '@/components/ui/SubmitButton';

export function AiCopilotBar({ isDanish = true }: { isDanish?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<AiCommandResult | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isPending, startTransition] = useTransition();
  const t = (da: string, en: string) => isDanish ? da : en;
  const busy = isPending || isNavigating;
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const suggestions = [
    { label: t('Gå til kunder', 'Go to callers'), command: t('Gå til kunder', 'Go to callers') },
    { label: t('Åbn indstillinger', 'Open settings'), command: t('Åbn indstillinger', 'Open settings') },
    { label: t('Find en kunde', 'Find a caller'), command: t('Find ', 'Find ') },
    { label: t('Ny kunde', 'New caller'), command: t('Opret kunde', 'Create lead') },
  ];

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!prompt.trim() || busy) return;
    startTransition(async () => {
      try {
        const response = await executeClientAiCommand(prompt);
        setResult(response);
        if (response.ok) {
          setPrompt('');
          if (response.navigateTo) {
            setIsNavigating(true);
            timerRef.current = setTimeout(() => { router.push(response.navigateTo!); setIsNavigating(false); }, 450);
          }
        }
      } catch {
        setResult({ ok: false, error: t('Kommandoen kunne ikke udføres. Prøv igen.', 'The command could not be completed. Please try again.') });
      }
    });
  }

  return (
    <section className="glass p-5" aria-label={t('Driftsassistent', 'Operations assistant')}>
      <div className="mb-4 flex items-start gap-3">
        <Command size={18} strokeWidth={1.7} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" aria-hidden />
        <div><h2 className="text-[14px] font-semibold tracking-[-0.02em]">{t('Driftsassistent', 'Operations assistant')}</h2><p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">{t('Find en kunde, gå til en side, eller opdatér din virksomhed med en kort kommando.', 'Find a caller, jump to a page or update your business with a short command.')}</p></div>
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <label htmlFor="operations-command" className="sr-only">{t('Skriv en kommando', 'Write a command')}</label>
        <input ref={inputRef} id="operations-command" type="text" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={busy} placeholder={t('Hvad vil du gerne gøre?', 'What would you like to do?')} className="input min-w-0 flex-1" maxLength={500} />
        <button type="submit" disabled={busy || !prompt.trim()} aria-busy={busy} className={buttonClass('primary', 'md', 'shrink-0')}>{busy ? <Spinner /> : <Send size={14} aria-hidden />}<span className="hidden sm:inline">{busy ? t('Arbejder…', 'Working…') : t('Udfør', 'Run')}</span></button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2"><span className="mr-0.5 text-[11px] text-[var(--muted)]">{t('Prøv', 'Try')}</span>{suggestions.map((suggestion) => <button key={suggestion.label} type="button" disabled={busy} onClick={() => { setPrompt(suggestion.command); inputRef.current?.focus(); }} className="quick-action">{suggestion.label}<ArrowRight size={11} aria-hidden /></button>)}</div>
      <AnimatePresence initial={false}>{result ? <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`notice mt-4 ${result.ok ? 'notice-success' : 'notice-danger'}`} role="status"><span className="mt-0.5 shrink-0">{result.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}</span><div className="min-w-0 flex-1"><p className="whitespace-pre-line text-[12px]">{(result.reply ?? result.error ?? '').replace(/^[^\p{L}\p{N}]+/u, '')}</p>{result.navigateTo ? <p className="mt-1 flex items-center gap-1 text-[11px] opacity-80"><ArrowRight size={11} />{t('Åbner', 'Opening')} {result.navigateTo}</p> : null}</div><button type="button" onClick={() => setResult(null)} aria-label={t('Luk besked', 'Dismiss message')} className="shrink-0 rounded p-1 hover:bg-[var(--bg-raised)]"><X size={14} /></button></motion.div> : null}</AnimatePresence>
    </section>
  );
}
