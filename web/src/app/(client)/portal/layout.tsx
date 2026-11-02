import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts } from '@/lib/db/queries';
import { LogoutButton } from '@/components/shell/LogoutButton';

const NAV = [
  { href: '/portal', label: 'Overview' },
  { href: '/portal/leads', label: 'Leads' },
];

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  if (session.isAgency) redirect('/agency');

  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  const tenant = await getTenantFacts(session.userId, tenantId);
  if (!tenant) redirect('/no-access');

  return (
    <div className="min-h-screen bg-[var(--bg-ground)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6 min-w-0">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight">{tenant.name}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                {tenant.default_language === 'da-DK' ? 'Dansk' : 'English'}
                {tenant.flynumber_did ? ` · ${tenant.flynumber_did}` : ' · WebRTC'}
              </div>
            </div>

            <nav className="hidden items-center gap-1 sm:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-[11px] text-[var(--text-muted)] md:inline">{session.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
