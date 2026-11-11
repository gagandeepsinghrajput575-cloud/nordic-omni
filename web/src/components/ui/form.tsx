import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from './core';

/* ----------------------------------------------------------------- Label --- */

export function Label({
  htmlFor,
  children,
  hint,
  required,
}: {
  htmlFor: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[12px] font-semibold text-[var(--text)]">
        {children}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
      </label>
      {hint ? <span className="text-[11px] text-[var(--muted)]">{hint}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------- Controls --- */

const CONTROL =
  'w-full rounded-[10px] border border-[var(--line)] bg-[var(--bg-ground)] ' +
  'px-3.5 py-2.5 text-[13px] text-[var(--text)] placeholder:text-[var(--muted)] ' +
  'transition-colors duration-150 ' +
  'hover:border-[var(--border-strong)] ' +
  'focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function Input({
  className,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, invalid && 'border-[var(--danger)]', className)}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, 'min-h-[84px] resize-y leading-relaxed', invalid && 'border-[var(--danger)]', className)}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(CONTROL, 'cursor-pointer', className)}>
      {children}
    </select>
  );
}

/* ---------------------------------------------------------------- Field --- */

export function Field({
  htmlFor,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} hint={hint} required={required}>
        {label}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ FormAlert --- */

export function FormAlert({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-[var(--bad)]/40 bg-[var(--bad)]/10 text-[var(--bad)]',
    success: 'border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]',
    info: 'border-[var(--line)] bg-[var(--panel-2)] text-[var(--text)]',
  }[tone];

  return (
    <div
      role="status"
      className={cn('rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed', styles)}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- Button --- */

const BUTTON_VARIANTS = {
  primary:
    'bg-[var(--text)] text-[var(--bg)] border-[var(--text)] hover:opacity-90 active:scale-[0.99]',
  secondary:
    'bg-[var(--bg-raised)] text-[var(--text)] border-[var(--line)] hover:border-[var(--border-strong)] hover:bg-[var(--panel-2)] active:scale-[0.99]',
  ghost:
    'bg-transparent text-[var(--muted)] border-transparent hover:bg-[var(--bg-raised)] hover:text-[var(--text)]',
  danger:
    'bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]/40 hover:brightness-110 active:scale-[0.99]',
} as const;

const BUTTON_SIZES = {
  sm: 'px-3 py-1.5 text-[12px] gap-1.5 rounded-lg',
  md: 'px-4 py-2.5 text-[13px] font-semibold gap-2 rounded-[10px]',
} as const;

export function buttonClass(
  variant: keyof typeof BUTTON_VARIANTS = 'secondary',
  size: keyof typeof BUTTON_SIZES = 'md',
  className?: string
) {
  return cn(
    'inline-flex items-center justify-center border font-semibold',
    'transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50',
    'select-none whitespace-nowrap cursor-pointer',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className
  );
}
