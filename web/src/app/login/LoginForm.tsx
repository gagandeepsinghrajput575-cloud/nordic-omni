'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock, Mail, Sparkles } from 'lucide-react';

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

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword('demo1234');
    setError(null);
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

      {/* 1-click Demo Accounts in Pulse Card style */}
      <div className="border-t border-[var(--line)] pt-4">
        <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
          <Sparkles size={13} className="text-[#a78bfa]" />
          <span>Demo credentials (password: demo1234)</span>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fillDemo('agency@nordic-omni.local')}
            className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2 text-left text-xs transition hover:bg-white/[0.12] hover:-translate-y-0.5"
          >
            <span className="font-mono text-xs text-[var(--text)]">agency@nordic-omni.local</span>
            <span className="rounded-full bg-[rgba(139,92,246,0.2)] px-2 py-0.5 font-mono text-[10px] font-bold text-[#c4b5fd]">
              Agency Admin
            </span>
          </button>
          <button
            type="button"
            onClick={() => fillDemo('jens@kbhvvs.dk')}
            className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2 text-left text-xs transition hover:bg-white/[0.12] hover:-translate-y-0.5"
          >
            <span className="font-mono text-xs text-[var(--text)]">jens@kbhvvs.dk</span>
            <span className="rounded-full bg-[rgba(34,211,238,0.18)] px-2 py-0.5 font-mono text-[10px] font-bold text-[#a5f3fc]">
              Client: VVS
            </span>
          </button>
          <button
            type="button"
            onClick={() => fillDemo('mette@nordicdental.dk')}
            className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2 text-left text-xs transition hover:bg-white/[0.12] hover:-translate-y-0.5"
          >
            <span className="font-mono text-xs text-[var(--text)]">mette@nordicdental.dk</span>
            <span className="rounded-full bg-[rgba(52,211,153,0.18)] px-2 py-0.5 font-mono text-[10px] font-bold text-[#a7f3d0]">
              Client: Dental
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
