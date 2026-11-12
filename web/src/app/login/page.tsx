import { redirect } from 'next/navigation';
import { AudioLines, MessagesSquare, ShieldCheck } from 'lucide-react';
import { getSession } from '@/lib/auth/session';
import { LoginForm } from './LoginForm';
import { BrandLockup, BrandMark } from '@/components/ui/BrandMark';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  if (session) redirect(session.isAgency ? '/agency' : '/portal');
  const { next } = await searchParams;
  const redirectTo = next && /^\/(portal|agency)(\/|$)/.test(next) ? next : '/';

  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label="About Nordic Omni">
        <BrandLockup eyebrow="Voice-led business" />
        <div className="max-w-[470px] py-12">
          <div className="auth-monogram" aria-hidden><BrandMark /></div>
          <h2 className="text-[clamp(32px,3.4vw,46px)] font-semibold leading-[1.12] tracking-[-0.05em]">Good conversations.<br />Great business.</h2>
          <p className="mt-5 max-w-[380px] text-[15px] leading-7 text-[var(--text-secondary)]">Your AI receptionist, customer conversations and everyday operations. Together in one calm workspace.</p>
          <ul className="mt-10 space-y-5">
            {[
              { icon: AudioLines, title: 'A receptionist that knows your business', body: 'Your hours, your prices, your way of answering.' },
              { icon: MessagesSquare, title: 'The whole conversation, in context', body: 'Voice and chat history beside the next step.' },
              { icon: ShieldCheck, title: 'You decide where AI steps in', body: 'Review its knowledge. Take over when it matters.' },
            ].map(({ icon: Icon, title, body }) => <li key={title} className="flex items-start gap-3.5"><Icon size={18} strokeWidth={1.6} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" aria-hidden /><div><p className="text-[13px] font-medium">{title}</p><p className="mt-1 text-[12px] text-[var(--muted)]">{body}</p></div></li>)}
          </ul>
        </div>
        <p className="text-[12px] text-[var(--muted)]">Danish roots. Built for everyday business.</p>
      </section>
      <section className="auth-form-side" aria-label="Sign in">
        <div className="flex items-center justify-between gap-4"><div className="lg:hidden"><BrandLockup eyebrow="Voice-led business" /></div><span className="hidden text-[12px] text-[var(--muted)] lg:inline">Your workspace, ready when you are.</span><ThemeSwitcher /></div>
        <div className="auth-form-wrap">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.045em]">Welcome back</h1>
          <p className="mb-8 mt-2 text-[14px] leading-6 text-[var(--muted)]">Sign in to your agency or business workspace.</p>
          <LoginForm redirectTo={redirectTo} />
        </div>
        <p className="text-center text-[11px] text-[var(--muted)]">Nordic Omni · Voice, chat and customer operations</p>
      </section>
    </main>
  );
}
