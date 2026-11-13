import type { ReactNode } from "react";

export type IconName =
  | "grid"
  | "wave"
  | "brain"
  | "clock"
  | "plug"
  | "link"
  | "phone"
  | "users"
  | "arrow"
  | "spark"
  | "book"
  | "mic"
  | "check"
  | "plus"
  | "trash"
  | "external"
  | "shield"
  | "globe"
  | "send"
  | "refresh";

const ICON_PATHS: Record<IconName, ReactNode> = {
  send: (
    <>
      <path d="M16 2 8 10" />
      <path d="m16 2-5 14-3-6-6-3 14-5Z" />
    </>
  ),
  grid: (
    <>
      <rect x="2.5" y="2.5" width="5" height="5" rx="1.2" />
      <rect x="10.5" y="2.5" width="5" height="5" rx="1.2" />
      <rect x="2.5" y="10.5" width="5" height="5" rx="1.2" />
      <rect x="10.5" y="10.5" width="5" height="5" rx="1.2" />
    </>
  ),
  wave: (
    <>
      <path d="M2 9h2l1.5-4 2 9 2-12 2 9 1.5-3H16" />
    </>
  ),
  brain: (
    <>
      <path d="M8 3.2a2.4 2.4 0 0 0-3.6 2 2.6 2.6 0 0 0-1.2 4.4A2.7 2.7 0 0 0 4.6 14c.5 1.4 2.2 1.8 3.4 1V3.2Z" />
      <path d="M10 3.2a2.4 2.4 0 0 1 3.6 2 2.6 2.6 0 0 1 1.2 4.4A2.7 2.7 0 0 1 13.4 14c-.5 1.4-2.2 1.8-3.4 1V3.2Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="9" cy="9" r="7" />
      <path d="M9 4.8V9l3 1.8" />
    </>
  ),
  plug: (
    <>
      <path d="M6 2v4M12 2v4M4 6h10v3a5 5 0 0 1-10 0V6Z" />
      <path d="M9 14v2.5" />
    </>
  ),
  link: (
    <>
      <path d="M7.2 10.8 10.8 7.2" />
      <path d="M6.4 12.8 4.8 14.4a2.7 2.7 0 0 1-3.8-3.8l2.4-2.4" />
      <path d="M11.6 5.2l1.6-1.6a2.7 2.7 0 0 1 3.8 3.8l-2.4 2.4" />
    </>
  ),
  phone: (
    <>
      <path d="M6.2 2.8 7.8 6 6.2 7.6a10 10 0 0 0 4.2 4.2l1.6-1.6 3.2 1.6-.6 2.6a1.4 1.4 0 0 1-1.5 1.1C7.8 14.8 3.2 10.2 2.5 4.9A1.4 1.4 0 0 1 3.6 3.4l2.6-.6Z" />
    </>
  ),
  users: (
    <>
      <circle cx="7" cy="6.5" r="2.8" />
      <path d="M2.2 15.2c.4-2.6 2.4-4.2 4.8-4.2s4.4 1.6 4.8 4.2" />
      <path d="M12 4.4a2.6 2.6 0 0 1 0 5M13.4 11.4c1.9.3 3 1.7 3.3 3.8" />
    </>
  ),
  arrow: (
    <>
      <path d="M3 9h11M9.6 4.5 14.4 9l-4.8 4.5" />
    </>
  ),
  spark: (
    <>
      <path d="M9 2.2l1.7 4.6 4.6 1.7-4.6 1.7L9 14.8 7.3 10.2 2.7 8.5l4.6-1.7L9 2.2Z" />
    </>
  ),
  book: (
    <>
      <path d="M3 3.5h5a2 2 0 0 1 2 2V16a2 2 0 0 0-2-2H3V3.5Z" />
      <path d="M15 3.5H10a2 2 0 0 0-2 2V16a2 2 0 0 1 2-2h5V3.5Z" />
    </>
  ),
  mic: (
    <>
      <rect x="6.4" y="2.2" width="5.2" height="9" rx="2.6" />
      <path d="M3.8 8.8a5.2 5.2 0 0 0 10.4 0M9 14v2.4" />
    </>
  ),
  check: (
    <>
      <path d="M3.5 9.4 7 12.9l7.4-8" />
    </>
  ),
  plus: (
    <>
      <path d="M9 3.5v11M3.5 9h11" />
    </>
  ),
  trash: (
    <>
      <path d="M3.5 5.5h11M7 5.5V3.6h4v1.9M5 5.5l.7 9.4h6.6l.7-9.4" />
    </>
  ),
  external: (
    <>
      <path d="M7 3.5h7.5V11M14.5 3.5 7.6 10.4M12 14.5H3.5V6" />
    </>
  ),
  shield: (
    <>
      <path d="M9 2.2 15 4.6v4.7c0 3.4-2.3 5.7-6 6.6-3.7-.9-6-3.2-6-6.6V4.6L9 2.2Z" />
      <path d="M6.6 9.1 8.4 11l3-3.4" />
    </>
  ),
  globe: (
    <>
      <circle cx="9" cy="9" r="7" />
      <path d="M2.4 9h13.2M9 2c2 2 3 4.4 3 7s-1 5-3 7c-2-2-3-4.4-3-7s1-5 3-7Z" />
    </>
  ),
  refresh: (
    <>
      <path d="M15.2 8.2A6.4 6.4 0 1 0 14 13.6" />
      <path d="M15.4 3.6v4.8h-4.8" />
    </>
  ),
};

export function Icon({
  name,
  className = "h-4 w-4",
  strokeWidth = 1.4,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[radial-gradient(circle_at_30%_25%,rgba(201,242,108,0.45),rgba(141,180,255,0.16)_60%,rgba(8,9,12,0.9))]">
        <svg viewBox="0 0 18 18" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <path
            d="M3 10.4c1.2-2.2 1.5-4.8 3-4.8s1.4 6.8 2.7 6.8 1.6-8.4 3-8.4 1.2 5.4 2.3 6.4"
            stroke="#08090c"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!compact ? (
        <span className="text-[13.5px] font-medium tracking-[-0.01em] text-[var(--text-primary)]">
          nordic<span className="text-[var(--text-muted)]">/</span>omni
        </span>
      ) : null}
    </span>
  );
}

export function Pill({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "live" | "danger" | "warn";
  className?: string;
}) {
  const toneClass =
    tone === "accent" ? "pill-accent" : tone === "live" ? "pill-live" : tone === "danger" ? "pill-danger" : tone === "warn" ? "pill-warn" : "";
  return <span className={`pill ${toneClass} ${className ?? ""}`}>{children}</span>;
}

export function SectionHeader({
  label,
  title,
  description,
  actions,
  className,
}: {
  label?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-4 ${className ?? ""}`}>
      <div className="max-w-2xl">
        {label ? <p className="label mb-2">{label}</p> : null}
        <h2 className="display text-[22px] text-[var(--text-primary)] sm:text-[26px]">{title}</h2>
        {description ? (
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "accent" | "live" | "warn";
}) {
  const valueTone =
    tone === "accent"
      ? "text-[var(--accent-primary)]"
      : tone === "live"
        ? "text-[var(--success)]"
        : tone === "warn"
          ? "text-[var(--warning)]"
          : "text-[var(--text-primary)]";
  return (
    <div className="hairline-card p-4">
      <p className="label">{label}</p>
      <p className={`num mt-3 text-[26px] leading-none font-medium tracking-[-0.03em] ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="hairline-card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-sm text-[var(--text-primary)]">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-[var(--border-subtle)] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
      {children}
    </span>
  );
}

export function Meter({ value, max = 100 }: { value: number; max?: number }) {
  const percent = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
  return (
    <div className="meter">
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}