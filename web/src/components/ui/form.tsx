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
      <label htmlFor={htmlFor} className="text-[11px] font-medium text-[var(--text-secondary)]">
        {children}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
      </label>
      {hint ? <span className="text-[10px] text-[var(--text-muted)]">{hint}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------- Controls --- */

const CONTROL =
  'w-full rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] ' +
  'px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] ' +
  'transition-colors duration-150 ' +
  'hover:border-[var(--border-strong)] ' +
  'focus:border-[var(--accent-primary)] focus:outline-none ' +
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
    error: 'border-[var(--danger)]/40 bg-[var(--danger-soft)] text-[var(--danger)]',
    success: 'border-[var(--success)]/40 bg-[var(--success-soft)] text-[var(--success)]',
    info: 'border-[var(--border-strong)] bg-[var(--bg-raised)] text-[var(--text-secondary)]',
  }[tone];

  return (
    <div
      role="status"
      className={cn('rounded-[var(--r-sm)] border px-3 py-2 text-[11px] leading-relaxed', styles)}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- Button --- */

const BUTTON_VARIANTS = {
  primary:
    'bg-[var(--accent-primary)] text-[var(--accent-contrast)] border-transparent hover:brightness-105 active:brightness-95',
  secondary:
    'bg-[var(--bg-raised)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]',
  ghost:
    'bg-transparent text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]',
  danger:
    'bg-[var(--danger)] text-white border-transparent hover:brightness-110',
} as const;

const BUTTON_SIZES = {
  sm: 'px-2.5 py-1 text-[11px] gap-1.5',
  md: 'px-3.5 py-2 text-xs gap-2',
} as const;

export function buttonClass(
  variant: keyof typeof BUTTON_VARIANTS = 'secondary',
  size: keyof typeof BUTTON_SIZES = 'md',
  className?: string
) {
  return cn(
    'inline-flex items-center justify-center rounded-[var(--r-sm)] border font-medium',
    'transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50',
    'select-none whitespace-nowrap',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className
  );
}
