'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

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

      router.replace('/');
      router.refresh();
    } catch {
      setError('Network error. Is the server running?');
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]"
          >
            Email Address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="w-full rounded-xl border border-[var(--line)] bg-[rgba(0,0,0,0.35)] px-4 py-2.5 text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none transition focus:border-[rgba(139,92,246,0.65)] focus:ring-2 focus:ring-[rgba(139,92,246,0.2)]"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-xl border border-[var(--line)] bg-[rgba(0,0,0,0.35)] px-4 py-2.5 text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none transition focus:border-[rgba(139,92,246,0.65)] focus:ring-2 focus:ring-[rgba(139,92,246,0.2)]"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-[var(--bad)]/40 bg-[var(--bad)]/10 p-3 text-xs text-[#fca5a5]"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isBusy}
          className="btn primary glow w-full py-3 text-sm font-bold flex items-center justify-center gap-2"
        >
          {isBusy ? 'Signing in…' : 'Sign in to Workspace'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
