import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in · NORDIC-OMNI' };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.isAgency ? '/agency' : '/portal');

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[var(--bg-ground)] text-[var(--text-primary)]">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--accent-primary)]">
            Nordic-Omni
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Agency staff and client workspaces use the same login.
          </p>
        </div>

        <LoginForm />

        <div className="mt-8 border-t border-[var(--border-subtle)] pt-4">
          <p className="text-[11px] text-[var(--text-muted)] font-mono leading-relaxed">
            Demo accounts (password <span className="text-[var(--text-secondary)]">demo1234</span>)
            <br />
            agency@nordic-omni.local
            <br />
            jens@kbhvvs.dk
            <br />
            mette@nordicdental.dk
          </p>
        </div>
      </div>
    </main>
  );
}
