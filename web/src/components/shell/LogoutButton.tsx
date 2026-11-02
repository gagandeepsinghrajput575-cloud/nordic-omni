'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      disabled={busy}
      className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
    >
      {busy ? '…' : 'Sign out'}
    </button>
  );
}
