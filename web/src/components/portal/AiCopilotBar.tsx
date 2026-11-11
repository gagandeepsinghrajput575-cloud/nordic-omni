'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { executeClientAiCommand, type AiCommandResult } from '@/app/(client)/portal/ai-actions';
import {
  Command,
  Send,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';

interface AiCopilotBarProps {
  isDanish?: boolean;
}

export function AiCopilotBar({ isDanish = true }: AiCopilotBarProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<AiCommandResult | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isPending, startTransition] = useTransition();

  const suggestions = [
    { label: isDanish ? 'Gå til kunder' : 'Go to callers' },
    { label: isDanish ? 'Åbn indstillinger' : 'Open settings' },
    { label: isDanish ? 'Find Morten Bondo' : 'Find Morten Bondo' },
    { label: isDanish ? 'Sæt timetakst til 950 kr' : 'Set rate 950 DKK' },
    { label: isDanish ? 'Sæt besked: Døgnvagt aktiv' : 'Set notice: 24/7 active' },
  ];

  function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!prompt.trim() || isPending || isNavigating) return;

    startTransition(async () => {
      const res = await executeClientAiCommand(prompt);
      setResult(res);

      if (res.ok) {
        setPrompt('');

        if (res.navigateTo) {
          setIsNavigating(true);
          setTimeout(() => {
            router.push(res.navigateTo!);
            setIsNavigating(false);
          }, 450);
        }
      }
    });
  }

  function handleQuickPrompt(text: string) {
    const clean = text.replace(/^[^\w\s]+/u, '').trim();
    setPrompt(clean);
  }

  return (
    <div className="glass p-5">
      {/* Header */}
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] text-[var(--accent-primary)]">
            <Command size={15} strokeWidth={2.1} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--text)]">
                {isDanish ? 'Driftsassistent' : 'Operations assistant'}
              </span>
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
                {isDanish ? 'Hurtige kommandoer' : 'Quick commands'}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">
              {isDanish
                ? 'Opdatér priser, åbningstider eller find en kunde med en kort besked.'
                : 'Update prices, hours or find a caller with a short command.'}
            </p>
          </div>
        </div>
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            isDanish
              ? 'F.eks: "Gå til kunder", "Find Morten Bondo", eller "Sæt timetakst til 950 kr"...'
              : 'E.g: "Go to callers", "Find Morten Bondo", or "Set hourly rate to 950 DKK"...'
          }
          className="w-full rounded-[10px] border border-[var(--line)] bg-[var(--bg-ground)] py-2.5 pl-4 pr-24 text-[12px] font-medium text-[var(--text)] placeholder-[var(--muted)] outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
        />

        <div className="absolute right-1.5 flex items-center gap-1">
          <button
            type="submit"
            disabled={isPending || isNavigating || !prompt.trim()}
            className="btn primary sm glow"
          >
            {isPending || isNavigating ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Send className="h-3 w-3" />
                <span>{isDanish ? 'Udfør' : 'Run'}</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Suggestion pills in Pulse Chip format */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          {isDanish ? 'Kvikhandlinger:' : 'Quick actions:'}
        </span>
        {suggestions.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => handleQuickPrompt(s.label)}
            className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Result banner */}
      {result && (
        <div
          className={`mt-3.5 flex items-start gap-3 rounded-xl border p-3.5 text-xs leading-relaxed transition ${
            result.ok
              ? 'border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--text)]'
              : 'border-[var(--bad)]/40 bg-[var(--bad)]/10 text-[#fca5a5]'
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ok)]" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--bad)]" />
          )}
          <div className="flex-1 whitespace-pre-line text-xs font-medium">
            {result.reply}
            {result.navigateTo && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-black/40 px-2 py-0.5 font-mono text-[10px] text-[#22d3ee]">
                <ArrowRight className="h-2.5 w-2.5" />
                {result.navigateTo}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="text-xs text-[var(--muted)] hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
