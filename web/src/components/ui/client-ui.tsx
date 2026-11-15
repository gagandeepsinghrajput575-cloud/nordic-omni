import type { ReactNode } from "react";

export function InlineNotice({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "danger" | "warn" | "accent";
  className?: string;
}) {
  const toneClasses =
    tone === "danger"
      ? "border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger)]"
      : tone === "warn"
      ? "border-[var(--warning-line)] bg-[var(--warning-soft)] text-[var(--warning)]"
      : tone === "accent"
      ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-primary)]"
      : "border-[var(--border-subtle)] bg-[var(--glass-soft)] text-[var(--text-secondary)]";

  return (
    <div className={`rounded-xl border px-3.5 py-2.5 text-[12px] leading-relaxed ${toneClasses} ${className ?? ""}`}>
      {children}
    </div>
  );
}
