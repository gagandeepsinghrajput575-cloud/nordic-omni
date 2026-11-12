import type { ReactNode } from 'react';
import { cn } from './core';

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: string; title: string; description?: string; actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0 flex-1 basis-64">
        {eyebrow ? <p className="mb-1.5 text-[12px] font-medium text-[var(--muted)]">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, description, action, compact = false }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 text-center', compact ? 'py-9' : 'py-14')}>
      {icon ? <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--bg-raised)] text-[var(--muted)]" aria-hidden>{icon}</div> : null}
      <h3 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text)]">{title}</h3>
      {description ? <p className="mt-2 max-w-sm text-[13px] leading-6 text-[var(--muted)]">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

const AVATAR_TONES = [
  ['var(--accent-soft)', 'var(--accent-primary)'],
  ['var(--info-soft)', 'var(--info)'],
  ['var(--warning-soft)', 'var(--warning)'],
  ['var(--neutral-soft)', 'var(--text-secondary)'],
];

export function Avatar({ name, size = 34, seed }: { name: string | null; size?: number; seed?: string }) {
  const source = seed || name || 'caller';
  let hash = 0;
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [background, color] = AVATAR_TONES[hash % AVATAR_TONES.length];
  const initials = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('') || '?';
  return <span className="avatar select-none" style={{ width: size, height: size, fontSize: Math.round(size * 0.34), background, color }} aria-hidden>{initials}</span>;
}

export function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const safeMax = Math.max(1, max);
  const value = Math.max(0, Math.min(safeMax, score));
  const pct = (value / safeMax) * 100;
  return (
    <div className="flex items-center gap-2.5" role="meter" aria-label="Lead score" aria-valuenow={value} aria-valuemin={0} aria-valuemax={safeMax}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--active)]" aria-hidden>
        <span className="block h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[12px] tabular-nums text-[var(--text-secondary)]" aria-hidden>{score}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton', className)} />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="space-y-3 p-5" aria-hidden>{Array.from({ length: rows }).map((_, index) => <div key={index} className="flex items-center gap-3"><Skeleton className="h-9 w-9 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-2.5 w-1/4" /></div><Skeleton className="h-6 w-16" /></div>)}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="section-title">{children}</h2>{action ? <div className="flex items-center gap-2">{action}</div> : null}</div>;
}
