'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isBusy) return;

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Sign in failed');
        setIsBusy(false);
        return;
      }

      // Root route decides agency vs portal based on the new session.
      router.replace('/');
      router.refresh();
    } catch {
      setError('Network error. Is the server running?');
      setIsBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="email" className="block text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isBusy}
        className="w-full rounded-lg bg-[var(--accent-primary)] px-3 py-2.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90 disabled:opacity-50"
      >
        {isBusy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
