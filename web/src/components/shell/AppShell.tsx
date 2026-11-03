'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Menu,
  X,
  LayoutDashboard,
  Users,
  Settings,
  Building2,
  Phone,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/components/ui/core';

/**
 * Icons travel as string keys, never as components.
 *
 * React cannot serialise a function across the Server -> Client boundary, so
 * passing `<LayoutDashboard/>` from a server layout into this client shell throws
 * "Functions cannot be passed directly to Client Components". The map lives here,
 * on the client side, where it is allowed.
 */
const ICONS = {
  dashboard: LayoutDashboard,
  users: Users,
  settings: Settings,
  building: Building2,
  phone: Phone,
  knowledge: BookOpen,
} satisfies Record<string, LucideIcon>;

export type IconKey = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: IconKey;
  /** Only match exactly (used for the index route of a section). */
  exact?: boolean;
}

export function AppShell({
  nav,
  brandEyebrow,
  brandName,
  brandHref,
  footer,
  toolbar,
  children,
}: {
  nav: NavItem[];
  brandEyebrow: string;
  brandName: string;
  brandHref: string;
  footer?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const navList = (
    <nav className="flex flex-col gap-0.5 p-3">
      {nav.map((item) => {
        const active = isActive(item);
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-2 text-xs transition-colors',
              active
                ? 'bg-[var(--bg-raised)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/60 hover:text-[var(--text-primary)]'
            )}
          >
            {active ? (
              <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-[var(--accent-primary)]" />
            ) : null}
            <Icon
              size={15}
              strokeWidth={active ? 2.2 : 1.8}
              className={active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}
            />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[var(--bg-ground)] text-[var(--text-primary)]">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <Link href={brandHref} className="flex items-baseline gap-2">
          <span className="text-eyebrow">{brandEyebrow}</span>
          <span className="text-xs font-semibold">{brandName}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="rounded-[var(--r-sm)] border border-[var(--border-subtle)] p-1.5 text-[var(--text-secondary)]"
        >
          {open ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 w-[236px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]',
            'transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
            open ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="flex h-full flex-col">
            <Link
              href={brandHref}
              className="flex flex-col justify-center border-b border-[var(--border-subtle)] px-4 py-3.5"
            >
              <span className="text-eyebrow">{brandEyebrow}</span>
              <span className="mt-0.5 text-sm font-semibold tracking-tight">{brandName}</span>
            </Link>

            <div className="flex-1 overflow-y-auto">{navList}</div>

            {footer ? (
              <div className="border-t border-[var(--border-subtle)] p-3">{footer}</div>
            ) : null}
          </div>
        </aside>

        {/* Backdrop for mobile drawer */}
        {open ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          />
        ) : null}

        {/* Content */}
        <div className="min-w-0 flex-1">
          {toolbar ? (
            <div className="sticky top-0 z-20 hidden items-center justify-end gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-ground)]/85 px-6 py-2 backdrop-blur lg:flex">
              {toolbar}
            </div>
          ) : null}
          <main className="mx-auto w-full max-w-[1180px] px-5 py-7 sm:px-6 lg:py-9">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
