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
      ? "border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.08)] text-[var(--danger,#ff6b6b)]"
      : tone === "warn"
      ? "border-[rgba(255,184,77,0.3)] bg-[rgba(255,184,77,0.08)] text-[var(--warning,#ffb84d)]"
      : tone === "accent"
      ? "border-[rgba(216,200,166,0.3)] bg-[rgba(216,200,166,0.08)] text-[var(--accent-primary,#d8c8a6)]"
      : "border-[var(--border-subtle)] bg-[var(--glass-soft)] text-[var(--text-secondary)]";

  return (
    <div className={`rounded-xl border px-3.5 py-2.5 text-[12px] leading-relaxed ${toneClasses} ${className ?? ""}`}>
      {children}
    </div>
  );
}
