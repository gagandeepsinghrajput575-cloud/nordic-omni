'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Field, Input, FormAlert, buttonClass } from '@/components/ui/form';
import { Spinner } from '@/components/ui/SubmitButton';

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
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? 'Sign in failed. Please try again.');
        setIsBusy(false);
        return;
      }
      router.replace(data.mustChangePassword ? '/account/password' : redirectTo);
      router.refresh();
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.');
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-7">
      <form onSubmit={handleSubmit} className="space-y-5" aria-busy={isBusy}>
        <Field htmlFor="email" label="Email address">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            disabled={isBusy}
          />
        </Field>
        <Field htmlFor="password" label="Password">
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              className="pr-12"
              disabled={isBusy}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute right-1 top-1 flex h-8 w-9 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
            >
              <span aria-hidden>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</span>
            </button>
          </div>
        </Field>
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <button
          ref={submitRef}
          type="submit"
          disabled={isBusy}
          aria-busy={isBusy}
          className={buttonClass('primary', 'md', 'min-h-11 w-full justify-between px-4')}
        >
          <span>{isBusy ? 'Opening your workspace…' : 'Sign in to workspace'}</span>
          {isBusy ? <Spinner /> : <ArrowRight size={16} aria-hidden />}
        </button>
      </form>
    </div>
  );
}
