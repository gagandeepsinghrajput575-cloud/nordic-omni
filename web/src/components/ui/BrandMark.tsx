import { cn } from '@/components/ui/core';

/** Two conversational strokes form an N: the product's own mark, not a stock activity icon. */
export function BrandMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('brand-mark', className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M6 24V8.5C6 7.67 7 7.25 7.59 7.84L24.41 24.66C25 25.25 26 24.83 26 24V8" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 16h5M21 16h5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".45" />
      </svg>
    </span>
  );
}

export function BrandLockup({ eyebrow, name, compact = false }: { eyebrow: string; name?: string; compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <BrandMark size={compact ? 27 : 30} />
      <span className="min-w-0">
        <span className="brand-wordmark block">Nordic Omni</span>
        <span className={cn('block truncate text-[11px] text-[var(--muted)]', compact && 'sr-only')}>{name || eyebrow}</span>
      </span>
    </span>
  );
}
