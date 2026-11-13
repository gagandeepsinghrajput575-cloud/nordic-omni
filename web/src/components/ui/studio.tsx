import type { ReactNode, ComponentType } from "react";

export function Equalizer({
  active = false,
  bars = 5,
  className,
}: {
  active?: boolean;
  bars?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-end gap-[2px] h-3.5 ${className ?? ""}`} aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={`w-[2px] rounded-full bg-[var(--accent-primary)] transition-all ${
            active ? "animate-pulse" : "opacity-30"
          }`}
          style={{
            height: active ? `${30 + ((i * 19) % 70)}%` : "30%",
            animationDelay: `${i * 120}ms`,
            animationDuration: "800ms",
          }}
        />
      ))}
    </div>
  );
}

export function LiveStatus({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "live" | "warn" | "danger" | "accent";
}) {
  const dotColor =
    tone === "live"
      ? "bg-[var(--success,#4ade80)]"
      : tone === "warn"
      ? "bg-[var(--warning,#fbbf24)]"
      : tone === "danger"
      ? "bg-[var(--danger,#f87171)]"
      : tone === "accent"
      ? "bg-[var(--accent-primary)]"
      : "bg-[var(--text-muted)]";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  hint,
  icon: IconComponent,
  tone = "default",
  spark,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: string;
  spark?: { label: string; value: number }[];
}) {
  const iconToneColor =
    tone === "green"
      ? "text-[var(--success,#4ade80)]"
      : tone === "blue"
      ? "text-[var(--accent-primary,#8db4ff)]"
      : tone === "sand"
      ? "text-[var(--accent-primary,#d8c8a6)]"
      : tone === "danger"
      ? "text-[var(--danger,#f87171)]"
      : "text-[var(--text-muted)]";

  return (
    <div className="card p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--glass-soft)]">
      <div className="flex items-center justify-between gap-2">
        <span className="label text-[10px] text-[var(--text-muted)]">{label}</span>
        {IconComponent ? <IconComponent className={`h-3.5 w-3.5 ${iconToneColor}`} /> : null}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="num font-mono text-[22px] font-semibold text-[var(--text-primary)]">{value}</span>
        {unit ? <span className="text-[12px] text-[var(--text-muted)]">{unit}</span> : null}
      </div>
      {hint ? <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{hint}</p> : null}
      {spark && spark.length > 0 ? (
        <div className="mt-2.5 flex items-end gap-1 h-6">
          {spark.map((bar, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-[var(--accent-primary)] opacity-40 hover:opacity-100 transition-opacity"
              style={{ height: `${Math.max(15, Math.min(100, bar.value * 20))}%` }}
              title={`${bar.label}: ${bar.value}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PanelHeader({
  title,
  subtitle,
  icon: IconComponent,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3.5 py-3">
      <div className="flex items-center gap-2">
        {IconComponent ? <IconComponent className="h-4 w-4 text-[var(--text-muted)]" /> : null}
        <div>
          <h3 className="text-[13px] font-medium text-[var(--text-primary)]">{title}</h3>
          {subtitle ? <p className="text-[11px] text-[var(--text-muted)]">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Sparkline({
  data,
  points,
  width,
  height,
  tone = "sand",
  className,
}: {
  data?: number[];
  points?: { label: string; value: number }[];
  width?: number;
  height?: number;
  tone?: string;
  className?: string;
}) {
  const values = data ?? points?.map((p) => p.value) ?? [];
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  return (
    <div
      className={`flex items-end gap-1 ${className ?? ""}`}
      style={{ width: width ? `${width}px` : undefined, height: height ? `${height}px` : "24px" }}
    >
      {values.map((val, i) => (
        <span
          key={i}
          className="flex-1 rounded-sm bg-[var(--accent-primary)] opacity-60 hover:opacity-100 transition-opacity"
          style={{ height: `${Math.max(10, (val / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function WaveDock({
  state,
}: {
  state: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-2.5 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--success,#4ade80)] animate-ping" />
      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">{state}</span>
    </div>
  );
}
