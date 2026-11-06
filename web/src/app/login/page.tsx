import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { LoginForm } from './LoginForm';
import { Activity } from 'lucide-react';

export const metadata = { title: 'Sign in · NORDIC-OMNI' };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.isAgency ? '/agency' : '/portal');

  return (
    <main className="relative min-h-screen flex items-center justify-center p-6 bg-[var(--bg)] text-[var(--text)] overflow-hidden">
      {/* Pulse Ambient Aurora Lighting */}
      <div className="aurora" aria-hidden>
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>

      <div className="glass relative z-10 w-full max-w-md p-8 sm:p-10 shadow-2xl">
        <div className="mb-6 flex items-center gap-3.5">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-lg"
            style={{
              background: 'var(--grad)',
              boxShadow: '0 8px 24px rgba(139,92,246,0.45)',
            }}
          >
            <Activity size={24} strokeWidth={2.6} />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Nordic-Omni + Pulse
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[var(--text)]">
              Sign In
            </h1>
          </div>
        </div>

        <p className="mb-6 text-xs text-[var(--muted)]">
          Realtime omnichannel voice and meta messaging platform for enterprise operations.
        </p>

        <LoginForm />
      </div>
    </main>
  );
}
