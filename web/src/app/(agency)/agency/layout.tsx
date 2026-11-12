import { ShieldCheck } from 'lucide-react';
import { requireAgency } from '@/lib/auth/guard';
import { AppShell, type NavItem } from '@/components/shell/AppShell';

const NAV: NavItem[] = [
  { href: '/agency', label: 'Portfolio', icon: 'dashboard', exact: true },
  { href: '/agency/clients', label: 'Clients', icon: 'building' },
];

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgency();
  return (
    <AppShell nav={NAV} brandEyebrow="Agency" brandName="Agency console" brandHref="/agency" accountEmail={session.email}
      toolbar={<span className="text-[12px] text-[var(--muted)]">{session.email}</span>}
      footer={<div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]"><ShieldCheck size={15} strokeWidth={1.7} aria-hidden /><span>Agency administrator</span></div>}>
      {children}
    </AppShell>
  );
}
