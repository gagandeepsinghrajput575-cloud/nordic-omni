import { Phone, PhoneOff } from 'lucide-react';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts } from '@/lib/db/queries';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
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
  const nav: NavItem[] = NAV.map(({ labelDa, labelEn, ...rest }) => ({ ...rest, label: isDanish ? labelDa : labelEn }));

  return (
    <AppShell nav={nav} brandEyebrow={isDanish ? 'Arbejdsrum' : 'Workspace'} brandName={tenant.name} brandHref="/portal" accountEmail={session.email}
      toolbar={<Badge tone="neutral">{isDanish ? 'Dansk' : 'English'}</Badge>}
      footer={<div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">{tenant.flynumber_did ? <Phone size={14} strokeWidth={1.7} aria-hidden /> : <PhoneOff size={14} strokeWidth={1.7} aria-hidden />}<span className="truncate">{tenant.flynumber_did || (isDanish ? 'Kun browseropkald' : 'Browser calls only')}</span></div>}>
      {children}
    </AppShell>
  );
}
