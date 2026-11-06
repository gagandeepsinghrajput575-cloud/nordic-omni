import type { ReactNode } from 'react';
import { cn } from './core';

/* ------------------------------------------------------------ PageHeader --- */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--text)] sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
      </div>
      <div className="rule-accent mt-5" />
    </div>
  );
}

/* ------------------------------------------------------------ EmptyState --- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon ? (
        <div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(139,92,246,0.35)] text-[#c4b5fd]"
          style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(34,211,238,0.15))',
          }}
        >
          {icon}
        </div>
      ) : null}
      <p className="text-base font-bold text-[var(--text)]">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Avatar --- */

const AVATAR_GRADS = [
  ['#8b5cf6', '#22d3ee'],
  ['#f472b6', '#8b5cf6'],
  ['#22d3ee', '#34d399'],
  ['#fbbf24', '#f472b6'],
  ['#60a5fa', '#a78bfa'],
  ['#34d399', '#38bdf8'],
  ['#fb7185', '#fbbf24'],
];

function gradFor(seed: string) {
  let h = 0;
  for (const c of String(seed || 'x')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_GRADS[h % AVATAR_GRADS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function Avatar({
  name,
  size = 32,
  seed,
}: {
  name: string | null;
  size?: number;
  seed?: string;
}) {
  const initials =
    (name ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?';

  return (
    <div
      className="avatar shrink-0 font-bold text-white select-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: gradFor(seed || name || 'prospect'),
      }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

/* ------------------------------------------------------------- ScoreBar --- */

export function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const tone = pct >= 70 ? 'var(--ok)' : pct >= 40 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: tone }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-[var(--muted)]">
        {score}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------- Skeleton --- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ SectionTitle --- */

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
        {children}
      </h2>
      {action}
    </div>
  );
}
