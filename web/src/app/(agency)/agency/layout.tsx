import Link from 'next/link';
import { requireAgency } from '@/lib/auth/guard';
import { LogoutButton } from '@/components/shell/LogoutButton';

const NAV = [
  { href: '/agency', label: 'Portfolio' },
  { href: '/agency/clients', label: 'Clients' },
];

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgency();

  return (
    <div className="min-h-screen bg-[var(--bg-ground)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--accent-primary)]">
                Agency
              </div>
              <div className="text-sm font-semibold tracking-tight">Nordic-Omni</div>
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
