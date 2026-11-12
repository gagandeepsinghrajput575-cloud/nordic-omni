'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, ChevronRight } from 'lucide-react';
import { Field, Input, FormAlert, buttonClass } from '@/components/ui/form';
import { Spinner } from '@/components/ui/SubmitButton';

const DEMO_ACCOUNTS = [
  { email: 'agency@nordic-omni.local', label: 'Agency console', detail: 'Manage every workspace' },
  { email: 'morten@danskbyg.dk', label: 'Dansk Byg', detail: 'Danish business portal' },
  { email: 'mette@nordicdental.dk', label: 'Nordic Dental', detail: 'English business portal' },
];

export function LoginForm({ redirectTo = '/' }: { redirectTo?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isBusy) return;
    setError(null);
    setIsBusy(true);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? 'Sign in failed. Please try again.'); setIsBusy(false); return; }
      router.replace(data.mustChangePassword ? '/account/password' : redirectTo);
      router.refresh();
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.');
      setIsBusy(false);
    }
  }

  function fillDemo(demoEmail: string) {
    if (isBusy) return;
    setEmail(demoEmail);
    setPassword('demo1234');
    setError(null);
    submitRef.current?.focus();
  }

  return (
    <div className="space-y-7">
      <form onSubmit={handleSubmit} className="space-y-5" aria-busy={isBusy}>
        <Field htmlFor="email" label="Email address">
          <Input id="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" disabled={isBusy} />
        </Field>
        <Field htmlFor="password" label="Password">
          <div className="relative">
            <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="pr-12" disabled={isBusy} />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} className="absolute right-1 top-1 flex h-8 w-9 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"><span aria-hidden>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</span></button>
          </div>
        </Field>
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <button ref={submitRef} type="submit" disabled={isBusy} aria-busy={isBusy} className={buttonClass('primary', 'md', 'min-h-11 w-full justify-between px-4')}>
          <span>{isBusy ? 'Opening your workspace…' : 'Sign in to workspace'}</span>{isBusy ? <Spinner /> : <ArrowRight size={16} aria-hidden />}
        </button>
      </form>
      <details className="border-t border-[var(--line)] pt-5" open>
        <summary className="text-[12px] font-medium text-[var(--text-secondary)]">Explore a demo workspace</summary>
        <p className="mb-3 mt-2 text-[11px] leading-5 text-[var(--muted)]">Choose an account to fill the form. Demo password: <code className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5">demo1234</code></p>
        <div className="space-y-2">
          {DEMO_ACCOUNTS.map((account) => <button key={account.email} type="button" disabled={isBusy} onClick={() => fillDemo(account.email)} className="auth-demo group" aria-label={`Use demo account ${account.email}`}><span className="min-w-0"><span className="flex items-center gap-2 text-[12px] font-medium">{account.label}<span className="text-[11px] font-normal text-[var(--muted)]">{account.detail}</span></span><span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">{account.email}</span></span><ChevronRight size={15} className="shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5" aria-hidden /></button>)}
        </div>
      </details>
    </div>
  );
}
