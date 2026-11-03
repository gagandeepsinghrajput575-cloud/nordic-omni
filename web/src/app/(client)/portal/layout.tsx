import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts } from '@/lib/db/queries';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { LogoutButton } from '@/components/shell/LogoutButton';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { Badge } from '@/components/ui/core';

const NAV: NavItem[] = [
  { href: '/portal', label: 'Overview', icon: 'dashboard', exact: true },
  { href: '/portal/leads', label: 'Callers', icon: 'users' },
  { href: '/portal/settings', label: 'Settings', icon: 'settings' },
];

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  if (session.isAgency) redirect('/agency');

  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  const tenant = await getTenantFacts(session.userId, tenantId);
  if (!tenant) redirect('/no-access');

  const isDanish = tenant.default_language === 'da-DK';

  return (
    <AppShell
      nav={NAV}
      brandEyebrow={isDanish ? 'Arbejdsrum' : 'Workspace'}
      brandName={tenant.name}
      brandHref="/portal"
      toolbar={
        <>
          <span className="hidden text-[11px] text-[var(--text-muted)] xl:inline">{session.email}</span>
          <ThemeSwitcher />
          <LogoutButton />
        </>
      }
      footer={
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="dot-live" aria-hidden />
            <span className="text-[10px] font-medium text-[var(--text-secondary)]">
              {tenant.flynumber_did ? tenant.flynumber_did : 'WebRTC only'}
            </span>
            <Badge tone="neutral" className="ml-auto">
              {isDanish ? 'Dansk' : 'English'}
            </Badge>
          </div>
          <p className="truncate text-[10px] text-[var(--text-muted)]">{session.email}</p>
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

