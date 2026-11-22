import { ShieldCheck } from 'lucide-react';
import { requireAgency } from '@/lib/auth/guard';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { getServerLocale } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/locale';

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgency();
  const locale = await getServerLocale('en');
  const dict = getDictionary(locale);

  const nav: NavItem[] = [
    { href: '/agency', label: dict.agencyNav.portfolio, icon: 'dashboard', exact: true },
    { href: '/agency/workforce', label: dict.agencyNav.workforce, icon: 'bot' },
    { href: '/agency/clients', label: dict.agencyNav.clients, icon: 'building' },
    { href: '/agency/webhooks', label: dict.agencyNav.webhooks, icon: 'webhook' },
  ];

  return (
    <AppShell
      nav={nav}
      brandEyebrow={dict.shell.agencyEyebrow}
      brandName={dict.shell.agencyConsole}
      brandHref="/agency"
      accountEmail={session.email}
      toolbar={<span className="text-[12px] text-[var(--muted)]">{session.email}</span>}
      footer={
        <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <ShieldCheck size={15} strokeWidth={1.7} aria-hidden />
          <span>{dict.shell.agencyAdmin}</span>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
