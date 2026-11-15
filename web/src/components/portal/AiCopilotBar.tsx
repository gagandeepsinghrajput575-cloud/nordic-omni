'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Sparkles, Send, CheckCircle2, AlertCircle, ArrowRight, X, CornerDownLeft } from 'lucide-react';
import { executeClientAiCommand, type AiCommandResult } from '@/app/(client)/portal/ai-actions';
import { Spinner } from '@/components/ui/SubmitButton';
import { EqualizerBadge } from '@/components/ui/glass';
import { springFor, SPRING, SPRING_SOFT } from '@/lib/motion/springs';

/**
 * Tier 1 — AI interface.
 *
 * The in-thread co-pilot is an AI surface, so it takes the glass instrument
 * treatment rather than the standard card: obsidian panel, iridescent focus
 * ring, a live "thinking" equalizer while a command is in flight.
 *
 * Behaviour is unchanged and deliberately conservative: a command is only ever
 * *executed* through `executeClientAiCommand`, and any command that touches
 * pricing, commitments or facts the agency database does not hold comes back
 * as a staged proposal requiring explicit confirmation. This component never
 * writes to the database itself.
 */
export function AiCopilotBar({ isDanish = true }: { isDanish?: boolean }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  // Bumped by ⌘K; the command line springs once each time it is invoked.
  const [kbdPulse, setKbdPulse] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prompt, setPrompt] = useState('');
  const [focused, setFocused] = useState(false);
  const [result, setResult] = useState<AiCommandResult | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isPending, startTransition] = useTransition();
  const t = (da: string, en: string) => isDanish ? da : en;
  const busy = isPending || isNavigating;

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // ⌘K / Ctrl-K focuses the command line from anywhere in the portal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        // Pulse the surface so the jump is legible even if focus lands off-screen.
        setKbdPulse((n) => n + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const suggestions = [
    { label: t('Gå til kunder', 'Go to callers'), command: t('Gå til kunder', 'Go to callers') },
    { label: t('Åbn indstillinger', 'Open settings'), command: t('Åbn indstillinger', 'Open settings') },
    { label: t('Find en kunde', 'Find a caller'), command: t('Find ', 'Find ') },
    { label: t('Ny kunde', 'New caller'), command: t('Opret kunde', 'Create lead') },
  ];

  function handleSubmit(event?: FormEvent) {
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
    <section
      aria-label={t('Driftsassistent', 'Operations assistant')}
      className="studio-panel relative overflow-hidden p-5"
      style={{ borderRadius: 'var(--r-lg)' }}
    >
      <div className="mb-4 flex items-start gap-3">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: 'linear-gradient(160deg, var(--wash-3), var(--surface-raised))',
            border: '1px solid var(--wash-4)',
            boxShadow: 'inset 0 1px 0 var(--wash-4)',
            color: 'var(--accent-primary)',
          }}
          aria-hidden
        >
          <Sparkles size={16} strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-[var(--text)]">{t('Driftsassistent', 'Operations assistant')}</h2>
            {/* State is spoken, not implied by a pulse alone. */}
            <EqualizerBadge
              active={busy}
              label={busy ? t('Arbejder', 'Working') : t('Klar', 'Ready')}
            />
          </div>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
            {t('Find en kunde, gå til en side, eller opdatér din virksomhed med en kort kommando.', 'Find a caller, jump to a page or update your business with a short command.')}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <motion.div
          className="flex items-center gap-2 rounded-xl px-2.5"
          // The ring ignites outward on focus and the row leans in slightly.
          // Both are suppressed under reduced motion, where only the border
          // colour changes — a non-animated but still visible focus state.
          key={`command-${kbdPulse}`}
          // Re-keying replays the entrance; the pulse is a one-shot spring.
          initial={kbdPulse === 0 || reduceMotion ? false : { scale: 0.985 }}
          animate={{
            scale: focused && !reduceMotion ? 1.004 : 1,
            boxShadow: focused
              ? '0 0 0 3px var(--focus-ring), var(--glow-soft, transparent)'
              : 'inset 0 1px 0 rgba(0, 0, 0, 0.06)',
          }}
          transition={springFor(reduceMotion, SPRING)}
          style={{
            border: `1px solid ${focused ? 'var(--accent-primary)' : 'var(--line)'}`,
            background: 'var(--surface-raised)',
          }}
        >
          <label htmlFor="operations-command" className="sr-only">{t('Skriv en kommando', 'Write a command')}</label>
          <input
            ref={inputRef}
            id="operations-command"
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={busy}
            placeholder={t('Hvad vil du gerne gøre?', 'What would you like to do?')}
            className="min-w-0 flex-1 border-0 bg-transparent py-3 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-60"
            maxLength={500}
            autoComplete="off"
          />
          <kbd
            className="hidden shrink-0 items-center gap-1 rounded-md border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] sm:inline-flex"
            aria-hidden
          >
            <CornerDownLeft size={10} />{t('Kør', 'Run')}
          </kbd>
          <motion.button
            type="submit"
            disabled={busy || !prompt.trim()}
            aria-busy={busy}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            transition={springFor(reduceMotion)}
            className="btn btn-accent shrink-0"
          >
            {busy ? <Spinner /> : <Send size={14} aria-hidden />}
            <span className="hidden sm:inline">{busy ? t('Arbejder…', 'Working…') : t('Udfør', 'Run')}</span>
          </motion.button>
        </motion.div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="mr-0.5 text-[11px] text-[var(--text-muted)]">{t('Prøv', 'Try')}</span>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            disabled={busy}
            onClick={() => { setPrompt(suggestion.command); inputRef.current?.focus(); }}
            className="quick-action"
          >
            {suggestion.label}
            <ArrowRight size={11} aria-hidden />
          </button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {result ? (
          <motion.div
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, height: 0 }}
            transition={springFor(reduceMotion, SPRING_SOFT)}
            className={`notice mt-4 overflow-hidden ${result.ok ? 'notice-success' : 'notice-danger'}`}
            role="status"
          >
            <span className="mt-0.5 shrink-0">{result.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}</span>
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-line text-[12px]">{((result.reply ?? result.error) ?? '').replace(/^[^\p{L}\p{N}]+/u, '')}</p>
              {result.navigateTo ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] opacity-80">
                  <ArrowRight size={11} />{t('Åbner', 'Opening')} {result.navigateTo}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              aria-label={t('Luk besked', 'Dismiss message')}
              className="shrink-0 rounded p-1 hover:bg-[var(--wash-2)]"
            >
              <X size={14} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
