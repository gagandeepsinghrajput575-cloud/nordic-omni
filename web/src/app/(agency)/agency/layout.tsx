import { requireAgency } from '@/lib/auth/guard';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { LogoutButton } from '@/components/shell/LogoutButton';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { Badge } from '@/components/ui/core';

const NAV: NavItem[] = [
  { href: '/agency', label: 'Portfolio', icon: 'dashboard', exact: true },
  { href: '/agency/clients', label: 'Clients', icon: 'building' },
];

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgency();

  return (
    <AppShell
      nav={NAV}
      brandEyebrow="Agency"
      brandName="Nordic-Omni"
      brandHref="/agency"
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
            <Badge tone="accent" dot>
              God mode
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

