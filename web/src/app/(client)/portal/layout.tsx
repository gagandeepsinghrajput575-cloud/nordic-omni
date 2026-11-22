import { Phone, PhoneOff } from 'lucide-react';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts } from '@/lib/db/queries';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { Badge } from '@/components/ui/core';
import { getServerLocale } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/locale';

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  if (session.isAgency) redirect('/agency');
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');
  const tenant = await getTenantFacts(session.userId, tenantId);
  if (!tenant) redirect('/no-access');

  const tenantDefault = tenant.default_language === 'da-DK' ? 'da' : 'en';
  const locale = await getServerLocale(tenantDefault);
  const dict = getDictionary(locale);

  const nav: NavItem[] = [
    { href: '/portal', label: dict.portalNav.overview, icon: 'dashboard', exact: true },
    { href: '/portal/leads', label: dict.portalNav.callers, icon: 'users' },
    { href: '/portal/chat', label: dict.portalNav.messages, icon: 'messages' },
    { href: '/portal/settings', label: dict.portalNav.settings, icon: 'settings' },
  ];

  return (
    <AppShell
      nav={nav}
      brandEyebrow={dict.shell.clientEyebrow}
      brandName={tenant.name}
      brandHref="/portal"
      accountEmail={session.email}
      toolbar={<Badge tone="neutral">{locale === 'da' ? 'Dansk' : 'English'}</Badge>}
      footer={
        <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          {tenant.flynumber_did ? (
            <Phone size={14} strokeWidth={1.7} aria-hidden />
          ) : (
            <PhoneOff size={14} strokeWidth={1.7} aria-hidden />
          )}
          <span className="truncate">
            {tenant.flynumber_did || dict.shell.browserCallsOnly}
          </span>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
