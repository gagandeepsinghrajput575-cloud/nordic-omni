import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ReactNode } from 'react';

/** Tailwind-aware class merge. Every primitive takes `className` last. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ Card --- */

export function Card({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn('surface', interactive && 'card-interactive cursor-pointer', className)}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  hint,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-3.5',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Stat --- */

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'default',
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: 'default' | 'accent' | 'danger' | 'warning' | 'success';
  icon?: ReactNode;
}) {
  const toneClass = {
    default: 'text-[var(--text-primary)]',
    accent: 'text-[var(--accent-primary)]',
    danger: 'text-[var(--danger)]',
    warning: 'text-[var(--warning)]',
    success: 'text-[var(--success)]',
  }[tone];

  const washVar =
    tone === 'default' ? null : `var(--${tone === 'accent' ? 'accent-primary' : tone})`;

  return (
    <Card className="group relative overflow-hidden p-5">
      {washVar ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            background: `radial-gradient(120% 100% at 100% 0%, ${washVar} 0%, transparent 60%)`,
          }}
        />
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="text-eyebrow">{label}</span>
        {icon ? <span className="text-[var(--text-muted)]">{icon}</span> : null}
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-mono text-[26px] font-bold tabular-nums leading-none tracking-tight',
            toneClass
          )}
        >
          {value}
        </span>
        {unit ? <span className="font-mono text-[11px] text-[var(--text-muted)]">{unit}</span> : null}
      </div>

      {hint ? <p className="mt-2 text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
    </Card>
  );
}

/* ----------------------------------------------------------------- Badge --- */

const BADGE_TONES = {
  neutral: 'border-[var(--border-strong)] text-[var(--text-secondary)] bg-[var(--bg-raised)]',
  accent: 'border-[var(--accent-line)] text-[var(--accent-primary)] bg-[var(--accent-soft)]',
  danger: 'border-[var(--danger)]/40 text-[var(--danger)] bg-[var(--danger-soft)]',
  warning: 'border-[var(--warning)]/40 text-[var(--warning)] bg-[var(--warning-soft)]',
  success: 'border-[var(--success)]/40 text-[var(--success)] bg-[var(--success-soft)]',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'font-mono text-[10px] uppercase tracking-wider whitespace-nowrap',
        BADGE_TONES[tone],
        className
      )}
    >
      {dot ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

/** One colour story for pipeline stages, used everywhere a stage appears.
 *  Keys MUST match the `pipeline_stage` enum in Postgres exactly. */
const STAGE_TONE: Record<string, BadgeTone> = {
  new_lead: 'neutral',
  contacted: 'accent',
  qualified: 'accent',
  booked: 'success',
  dire_escalated: 'danger',
  closed_won: 'success',
  closed_lost: 'warning',
};

/** Danish labels, because a Danish workspace should not speak English. */
const STAGE_DA: Record<string, string> = {
  new_lead: 'ny kunde',
  contacted: 'kontaktet',
  qualified: 'kvalificeret',
  booked: 'booket',
  dire_escalated: 'akut',
  closed_won: 'vundet',
  closed_lost: 'tabt',
};

export function StagePill({ stage, danish = false }: { stage: string; danish?: boolean }) {
  const fallback = stage.replace(/_/g, ' ');
  const label = danish ? (STAGE_DA[stage] ?? fallback) : fallback;
  return (
    <Badge tone={STAGE_TONE[stage] ?? 'neutral'} dot>
      {label}
    </Badge>
  );
}
