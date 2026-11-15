import type { CSSProperties, ReactNode } from "react";

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
      <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.45),rgba(255,255,255,0.16)_60%,rgba(8,9,12,0.9))]">
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

export type PillTone = "default" | "accent" | "live" | "danger" | "warn";

const PILL_TONE: Record<PillTone, string> = {
  default: "",
  accent: "pill-accent",
  live: "pill-live",
  danger: "pill-danger",
  warn: "pill-warn",
};

/**
 * A telemetry pill. The dot is paired with the label so state is never carried
 * by colour alone (WCAG 1.4.1), and every tone maps to an AA-checked ink pair
 * declared in globals.css.
 */
export function Pill({
  children,
  tone = "default",
  className,
  dot = false,
}: {
  children: ReactNode;
  tone?: PillTone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span className={`pill ${PILL_TONE[tone]} ${className ?? ""}`.trim()}>
      {dot ? <span className={tone === "live" ? "dot-live" : tone === "warn" ? "dot-thinking" : tone === "danger" ? "dot-danger" : "dot-idle"} /> : null}
      {children}
    </span>
  );
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
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "accent" | "live" | "warn" | "danger";
  className?: string;
}) {
  const valueTone =
    tone === "accent"
      ? "text-[var(--accent-primary)]"
      : tone === "live"
        ? "text-[var(--success)]"
        : tone === "warn"
          ? "text-[var(--warning)]"
          : tone === "danger"
            ? "text-[var(--danger)]"
            : "text-[var(--text-primary)]";
  return (
    <div className={`hairline-card stat-card p-4 ${className ?? ""}`.trim()}>
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

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--glass-soft)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] ${className ?? ""}`.trim()}
    >
      {children}
    </span>
  );
}

/**
 * A budget meter. `budget` lets a metric be judged against a contract (the
 * 300ms barge-in ceiling) rather than an arbitrary maximum, and the tone
 * escalates as the value approaches it.
 */
export function Meter({
  value,
  max = 100,
  budget,
  label,
  className,
}: {
  value: number;
  max?: number;
  budget?: number;
  label?: string;
  className?: string;
}) {
  const ceiling = budget ?? max;
  const ratio = Math.max(0, value) / Math.max(1, ceiling);
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const tone = ratio > 1 ? "danger" : ratio > 0.8 ? "warn" : "ok";
  return (
    <div className={`meter-wrap ${className ?? ""}`.trim()}>
      {label ? (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="label">{label}</span>
          <span className={`num font-mono text-[10.5px] text-[var(--${tone === "danger" ? "danger" : tone === "warn" ? "warning" : "success"})]`}>
            {Math.round(value)} / {ceiling}
          </span>
        </div>
      ) : null}
      <div
        className="meter"
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={ceiling}
        aria-label={label}
      >
        <span data-tone={tone} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Studio primitives: the obsidian audio console. These are server-safe (no
   hooks) so both server pages and client panels can compose them.
   ------------------------------------------------------------------------- */

/**
 * A deep black glass instrument panel. Children inherit the studio ink tokens
 * declared on `.studio-panel`, so no nested component needs a second theme.
 */
export function StudioPanel({
  children,
  className,
  flush = false,
  grain = true,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
  grain?: boolean;
  as?: "section" | "div" | "aside" | "article";
}) {
  return (
    <Tag
      className={[
        "studio-panel",
        flush ? "studio-panel--flush" : "",
        grain ? "studio-grain" : "",
        "overflow-hidden",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="relative z-[1]">{children}</div>
    </Tag>
  );
}

/** The three-pill telemetry strip that sits atop every studio surface. */
export function StudioStatusBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3 ${className ?? ""}`.trim()}
    >
      {children}
    </div>
  );
}

/**
 * A horizontal iridescent spectrum. Decorative by default (`aria-hidden`);
 * pass `label` when the spectrum is the content rather than chrome.
 */
export function Spectrum({
  level = 0.4,
  bars = 40,
  className,
  label,
}: {
  level?: number;
  bars?: number;
  className?: string;
  label?: string;
}) {
  const count = Math.max(4, Math.min(96, Math.round(bars)));
  const energy = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  return (
    <div
      className={`wave-shell ${className ?? ""}`.trim()}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <div className="wave-bars">
        {Array.from({ length: count }).map((_, index) => {
          const progress = index / Math.max(1, count - 1);
          const envelope = 0.4 + 0.6 * Math.sin(Math.PI * progress);
          const wave = Math.abs(Math.sin(index * 1.7 + 0.6)) * 0.6 + Math.abs(Math.cos(index * 0.53)) * 0.4;
          const height = Math.round(Math.max(8, Math.min(100, envelope * (0.35 + energy * 0.65) * wave * 100)));
          const style: CSSProperties = { height: `${height}%` };
          return (
            <span
              key={index}
              className={energy > 0 ? "wave-bar is-live" : "wave-bar is-static"}
              data-tone="accent"
              style={{
                ...style,
                animationDelay: `${(index % 11) * 90}ms`,
                animationDuration: `${1100 + (index % 7) * 140}ms`,
              }}
            />
          );
        })}
      </div>
      <span className="wave-spark" />
    </div>
  );
}

/**
 * The latency budget meter for the sub-300ms contract. Colour, the numeric
 * read-out, and the aria-label all carry the verdict, so the meaning survives
 * greyscale and screen readers.
 */
export function LatencyMeter({
  latencyMs,
  budgetMs = 300,
  label = "Round-trip latency",
  className,
}: {
  latencyMs: number;
  budgetMs?: number;
  label?: string;
  className?: string;
}) {
  const measured = Math.max(0, Math.round(latencyMs));
  const ratio = measured / Math.max(1, budgetMs);
  const within = measured <= budgetMs;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="label">{label}</span>
        <span
          className={`num font-mono text-[11px] ${within ? "text-[var(--success)]" : "text-[var(--danger)]"}`}
        >
          {measured}ms
        </span>
      </div>
      <div
        className="meter"
        role="meter"
        aria-valuenow={measured}
        aria-valuemin={0}
        aria-valuemax={budgetMs}
        aria-label={`${label}: ${measured} milliseconds, ${within ? "within" : "over"} the ${budgetMs} millisecond budget`}
      >
        <span
          data-tone={within ? (ratio > 0.8 ? "warn" : "ok") : "danger"}
          style={{ width: `${Math.max(3, Math.min(100, Math.round(ratio * 100)))}%` }}
        />
      </div>
      <p className="mt-1.5 text-[10.5px] text-[var(--text-muted)]">
        Budget {budgetMs}ms · {within ? "inside barge-in contract" : "over budget"}
      </p>
    </div>
  );
}