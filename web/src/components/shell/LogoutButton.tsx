'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { buttonClass } from '@/components/ui/form';
import { Spinner } from '@/components/ui/SubmitButton';

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Sign out failed');
      router.replace('/login');
      router.refresh();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={handleLogout} disabled={busy} aria-busy={busy} aria-label={busy ? 'Signing out' : 'Sign out'} title={error ? 'Could not sign out. Try again.' : 'Sign out'} className={buttonClass('ghost', 'sm', compact ? 'icon-button' : '')}>
        {busy ? <Spinner /> : <LogOut size={15} strokeWidth={1.7} aria-hidden />}
        {!compact ? <span>{busy ? 'Signing out…' : 'Sign out'}</span> : null}
      </button>
      {error ? <span role="alert" className="text-[11px] text-[var(--danger)]">Please try again.</span> : null}
    </span>
  );
}
