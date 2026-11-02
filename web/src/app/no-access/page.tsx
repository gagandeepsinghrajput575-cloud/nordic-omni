import Link from 'next/link';

export const metadata = { title: 'No access · NORDIC-OMNI' };

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-ground)] p-6 text-[var(--text-primary)]">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold tracking-tight">No workspace assigned</h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
          Your account is active but is not a member of any client workspace. Ask your agency
          administrator to invite you, then sign in again.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)]"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
