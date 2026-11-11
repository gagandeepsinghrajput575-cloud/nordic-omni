import { PhoneOff } from 'lucide-react';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts } from '@/lib/db/queries';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { LogoutButton } from '@/components/shell/LogoutButton';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { Badge } from '@/components/ui/core';

type NavSpec = Omit<NavItem, 'label'> & { labelDa: string; labelEn: string };

const NAV: NavSpec[] = [
  { href: '/portal', labelDa: 'Overblik', labelEn: 'Overview', icon: 'dashboard', exact: true },
  { href: '/portal/leads', labelDa: 'Kunder', labelEn: 'Callers', icon: 'users' },
  { href: '/portal/settings', labelDa: 'Indstillinger', labelEn: 'Settings', icon: 'settings' },
];

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  if (session.isAgency) redirect('/agency');

  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  const tenant = await getTenantFacts(session.userId, tenantId);
  if (!tenant) redirect('/no-access');

  const isDanish = tenant.default_language === 'da-DK';

  const nav: NavItem[] = NAV.map(({ labelDa, labelEn, ...rest }) => ({
    ...rest,
    label: isDanish ? labelDa : labelEn,
  }));

  return (
    <AppShell
      nav={nav}
      brandEyebrow={isDanish ? 'Arbejdsrum' : 'Workspace'}
      brandName={tenant.name}
      brandHref="/portal"
      toolbar={
        <>
          <span className="hidden text-[12px] text-[var(--text-muted)] xl:inline">{session.email}</span>
          <ThemeSwitcher />
          <LogoutButton />
        </>
      }
      footer={
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            {tenant.flynumber_did ? (
              <span className="dot-live" aria-hidden />
            ) : (
              <PhoneOff size={12} className="text-[var(--text-muted)]" aria-hidden />
            )}
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              {tenant.flynumber_did ? tenant.flynumber_did : isDanish ? 'Kun browseropkald' : 'Browser calls only'}
            </span>
            <Badge tone="neutral" className="ml-auto">
              {isDanish ? 'Dansk' : 'English'}
            </Badge>
          </div>
          <p className="truncate text-[11px] text-[var(--text-muted)]">{session.email}</p>
          <div className="lg:hidden">
            <LogoutButton />
          </div>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}

