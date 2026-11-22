import { redirect } from 'next/navigation';
import { AudioLines, MessagesSquare, ShieldCheck } from 'lucide-react';
import { getSession } from '@/lib/auth/session';
import { LoginForm } from './LoginForm';
import { BrandLockup, BrandMark } from '@/components/ui/BrandMark';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher';
import { getServerLocale } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/locale';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  if (session) redirect(session.isAgency ? '/agency' : '/portal');
  const { next } = await searchParams;
  const redirectTo = next && /^\/(portal|agency)(\/|$)/.test(next) ? next : '/';
  const locale = await getServerLocale('en');
  const dict = getDictionary(locale);
  const t = dict.login;

  const features =
    locale === 'da'
      ? [
          { icon: AudioLines, title: 'En receptionist der kender din virksomhed', body: 'Dine åbningstider, dine priser og din måde at svare på.' },
          { icon: MessagesSquare, title: 'Hele samtalen samlet i kontekst', body: 'Opkald, optagelser og beskeder lige ved næste skridt.' },
          { icon: ShieldCheck, title: 'Du bestemmer hvor AI hjælper til', body: 'Gennemgå viden og overtag samtalen når det gælder.' },
        ]
      : [
          { icon: AudioLines, title: 'A receptionist that knows your business', body: 'Your hours, your prices, your way of answering.' },
          { icon: MessagesSquare, title: 'The whole conversation, in context', body: 'Voice and chat history beside the next step.' },
          { icon: ShieldCheck, title: 'You decide where AI steps in', body: 'Review its knowledge. Take over when it matters.' },
        ];

  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label="About Nordic Omni">
        <BrandLockup eyebrow={dict.shell.brandTagline} />
        <div className="max-w-[470px] py-12">
          <div className="auth-monogram" aria-hidden><BrandMark /></div>
          <p className="mb-4 inline-flex items-center rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-medium tracking-[0.02em] text-[var(--accent-primary)]">
            {t.eyebrow}
          </p>
          <h2 className="text-[clamp(32px,3.4vw,46px)] font-semibold leading-[1.08] tracking-[-0.05em]">
            {t.heroTitleLine1}<br />{t.heroTitleLine2}
          </h2>
          <p className="mt-5 max-w-[380px] text-[15px] leading-7 text-[var(--text-secondary)]">{t.heroBody}</p>
          <ul className="mt-10 space-y-5">
            {features.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-3.5">
                <Icon size={18} strokeWidth={1.6} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" aria-hidden />
                <div>
                  <p className="text-[13px] font-medium">{title}</p>
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-[var(--text-muted)]">
          {locale === 'da' ? 'Danske rødder. Bygget til hverdagens forretning.' : 'Danish roots. Built for everyday business.'}
        </p>
      </section>
      <section className="auth-form-side" aria-label={t.welcomeBack}>
        <div className="flex items-center justify-between gap-4">
          <div className="lg:hidden"><BrandLockup eyebrow={dict.shell.brandTagline} /></div>
          <span className="hidden text-[12px] text-[var(--text-muted)] lg:inline">{t.readyNote}</span>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeSwitcher />
          </div>
        </div>
        <div className="auth-form-wrap">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.045em]">{t.welcomeBack}</h1>
          <p className="mb-8 mt-2 text-[14px] leading-6 text-[var(--text-muted)]">{t.subtitle}</p>
          <LoginForm redirectTo={redirectTo} />
          <p className="mt-5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{t.roleNote}</p>
        </div>
        <p className="text-center text-[11px] text-[var(--text-muted)]">{t.footerNote}</p>
      </section>
    </main>
  );
}
