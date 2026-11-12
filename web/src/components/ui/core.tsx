import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { CSSProperties, ReactNode } from 'react';

/** Tailwind-aware class merge. Every primitive takes className last. */
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function Card({ children, className, interactive = false }: {
  children: ReactNode; className?: string; interactive?: boolean;
}) {
  return <div className={cn('glass min-w-0', interactive && 'card-interactive', className)}>{children}</div>;
}

export function CardHeader({ title, hint, action, className }: {
  title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4', className)}>
      <div className="min-w-0 flex-1 basis-48">
        <h2 className="section-title text-[var(--text)]">{title}</h2>
        {hint ? <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">{hint}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** One divided surface, rather than a collection of competing metric tiles. */
export function StatGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('stats-grid', className)}>{children}</div>;
}

export function Stat({ label, value, unit, hint, tone = 'default', icon }: {
  label: string; value: ReactNode; unit?: string; hint?: ReactNode;
  tone?: 'default' | 'accent' | 'danger' | 'warning' | 'success'; icon?: ReactNode;
}) {
  const colorMap = { default: 'var(--text)', accent: 'var(--accent-primary)', danger: 'var(--danger)', warning: 'var(--warning)', success: 'var(--success)' };
  return (
    <div className="stat" style={{ '--c': colorMap[tone] } as CSSProperties}>
      <div className="stat-label flex items-center justify-between gap-2">
        <span>{label}</span>
        {icon ? <span className="stat-ico" aria-hidden>{icon}</span> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span className="stat-val">{value}</span>
        {unit ? <span className="text-[11px] font-normal text-[var(--muted)]">{unit}</span> : null}
      </div>
      {hint ? <p className="stat-sub mt-2">{hint}</p> : null}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success' | 'info';
export function Badge({ children, tone = 'neutral', dot = false, className }: {
  children: ReactNode; tone?: BadgeTone; dot?: boolean; className?: string;
}) {
  return <span className={cn('badge', `badge-${tone}`, className)}>{dot ? <i aria-hidden /> : null}{children}</span>;
}

/** Keys match the Postgres pipeline_stage enum exactly; colour expresses meaning, not decoration. */
const STAGE_TONES: Record<string, BadgeTone> = {
  new_lead: 'neutral', contacted: 'info', qualified: 'accent', booked: 'success',
  dire_escalated: 'danger', closed_won: 'success', closed_lost: 'neutral',
};
const STAGE_DA: Record<string, string> = {
  new_lead: 'Ny kunde', contacted: 'Kontaktet', qualified: 'Kvalificeret', booked: 'Booket',
  dire_escalated: 'Akut', closed_won: 'Vundet', closed_lost: 'Tabt',
};
const STAGE_EN: Record<string, string> = {
  new_lead: 'New lead', contacted: 'Contacted', qualified: 'Qualified', booked: 'Booked',
  dire_escalated: 'Emergency', closed_won: 'Won', closed_lost: 'Lost',
};
export function StagePill({ stage, danish = false }: { stage: string; danish?: boolean }) {
  const labels = danish ? STAGE_DA : STAGE_EN;
  return <Badge tone={STAGE_TONES[stage] ?? 'neutral'} dot className="stage-pill">{labels[stage] ?? stage.replace(/_/g, ' ')}</Badge>;
}
