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
      className={cn('glass', interactive && 'card-interactive cursor-pointer', className)}
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
        'flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold tracking-tight text-[var(--text)]">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p> : null}
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
  const colorMap = {
    default: '#8b5cf6',
    accent: '#22d3ee',
    danger: '#f87171',
    warning: '#fbbf24',
    success: '#34d399',
  };

  const c = colorMap[tone] || '#8b5cf6';

  return (
    <div
      className="glass stat"
      style={{ '--c': c } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
          {label}
        </span>
        {icon ? <div className="stat-ico">{icon}</div> : null}
      </div>

      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="stat-val">
          {value}
        </span>
        {unit ? (
          <span className="font-mono text-[11px] font-medium text-[var(--muted)]">
            {unit}
          </span>
        ) : null}
      </div>

      {hint ? (
        <p className="stat-sub mt-2">{hint}</p>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Badge --- */

const BADGE_COLORS: Record<string, string> = {
  neutral: '#94a3b8',
  accent: '#8b5cf6',
  danger: '#f87171',
  warning: '#fbbf24',
  success: '#34d399',
};

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success';

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
  const color = BADGE_COLORS[tone] || '#94a3b8';
  return (
    <span
      className={cn('badge', className)}
      style={{ '--c': color } as React.CSSProperties}
    >
      {dot ? <i aria-hidden /> : null}
      {children}
    </span>
  );
}

/** One colour story for pipeline stages, used everywhere a stage appears.
 *  Keys MUST match the `pipeline_stage` enum in Postgres exactly. */
const STAGE_COLORS: Record<string, string> = {
  new_lead: '#94a3b8',
  contacted: '#38bdf8',
  qualified: '#8b5cf6',
  booked: '#34d399',
  dire_escalated: '#f87171',
  closed_won: '#34d399',
  closed_lost: '#fbbf24',
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
  const color = STAGE_COLORS[stage] || '#94a3b8';

  return (
    <span
      className="stage-pill on"
      style={{ '--c': color } as React.CSSProperties}
    >
      <i aria-hidden />
      <span>{label}</span>
    </span>
  );
}
