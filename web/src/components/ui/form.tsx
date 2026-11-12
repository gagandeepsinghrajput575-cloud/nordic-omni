import { cloneElement, isValidElement, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { cn } from './core';

export function Label({ htmlFor, children, hint, required }: {
  htmlFor: string; children: ReactNode; hint?: string; required?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-[var(--text)]">{children}{required ? <span className="ml-1 text-[var(--danger)]" aria-hidden>*</span> : null}</label>
      {hint ? <span id={`${htmlFor}-hint`} className="text-[11px] text-[var(--muted)]">{hint}</span> : null}
    </div>
  );
}

const CONTROL = 'input';
function describedBy(id: string | undefined, hint: boolean, error: boolean, existing?: string) {
  return [existing, hint && id ? `${id}-hint` : null, error && id ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
}

export function Input({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid || undefined} aria-describedby={invalid ? describedBy(props.id, false, true, props['aria-describedby']) : props['aria-describedby']} className={cn(CONTROL, className)} />;
}
export function Textarea({ className, invalid, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...props} aria-invalid={invalid || undefined} aria-describedby={invalid ? describedBy(props.id, false, true, props['aria-describedby']) : props['aria-describedby']} className={cn(CONTROL, 'resize-y leading-relaxed', className)} />;
}
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(CONTROL, 'cursor-pointer', className)}>{children}</select>;
}

export function Field({ htmlFor, label, hint, error, required, children, className }: {
  htmlFor: string; label: string; hint?: string; error?: string; required?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <Label htmlFor={htmlFor} hint={hint} required={required}>{label}</Label>
      {isValidElement<{ 'aria-describedby'?: string; invalid?: boolean }>(children)
        ? cloneElement(children, {
            'aria-describedby': describedBy(htmlFor, Boolean(hint), Boolean(error), children.props['aria-describedby']),
            ...(children.type === Input || children.type === Textarea ? { invalid: Boolean(error) || children.props.invalid } : {}),
          })
        : children}
      {error ? <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-[12px] leading-5 text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}

export function FormAlert({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} aria-live="polite" className={cn('notice', `notice-${tone === 'error' ? 'danger' : tone}`)}>{children}</div>;
}

const BUTTON_VARIANTS = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger' } as const;
const BUTTON_SIZES = { sm: 'btn-sm', md: 'btn-md' } as const;

export function buttonClass(variant: keyof typeof BUTTON_VARIANTS = 'secondary', size: keyof typeof BUTTON_SIZES = 'md', className?: string) {
  return cn('btn', BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}
