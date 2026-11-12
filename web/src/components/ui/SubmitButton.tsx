'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { buttonClass } from './form';
import { cn } from './core';

/** Locks the submit action while pending, with stable geometry and an announced busy state. */
export function SubmitButton({ children, pendingLabel, variant = 'primary', size = 'md', className, disabled }: {
  children: ReactNode; pendingLabel?: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; className?: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending} className={cn(buttonClass(variant, size, className), pending && 'cursor-wait')}>
      {pending ? <><Spinner />{pendingLabel ?? children}</> : children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn('h-4 w-4 animate-spin', className)} strokeWidth={1.8} />;
}
