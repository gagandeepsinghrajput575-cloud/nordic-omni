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
  Activity,
  Headphones,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/components/ui/core';

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
    <nav className="flex flex-col gap-1 p-3">
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
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all duration-150',
              active
                ? 'text-white'
                : 'text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--text)]'
            )}
          >
            {active ? (
              <span
                className="absolute inset-0 rounded-xl"
                style={{
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.32), rgba(34,211,238,0.16))',
                  border: '1px solid rgba(139,92,246,0.4)',
                }}
              />
            ) : null}
            <Icon
              size={17}
              strokeWidth={active ? 2.3 : 1.9}
              className={cn(
                'relative z-10 transition-colors',
                active ? 'text-[#22d3ee]' : 'text-[var(--muted)] group-hover:text-[var(--text)]'
              )}
            />
            <span className="relative z-10 truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="relative min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Pulse Ambient Aurora Lighting */}
      <div className="aurora" aria-hidden>
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-[var(--line)] bg-[rgba(10,12,22,0.85)] px-4 py-3 backdrop-blur-xl lg:hidden">
        <Link href={brandHref} className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-xl text-white"
            style={{
              background: 'var(--grad)',
              boxShadow: '0 4px 16px rgba(139,92,246,0.4)',
            }}
          >
            <Activity size={17} strokeWidth={2.6} />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">{brandEyebrow}</span>
            <span className="text-xs font-extrabold tracking-tight text-[var(--text)]">{brandName}</span>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="rounded-xl border border-[var(--line)] bg-white/[0.04] p-2 text-[var(--muted)] hover:text-white"
        >
          {open ? <X size={17} /> : <Menu size={17} />}
        </button>
      </div>

      <div className="flex">
        {/* Pulse Frosted Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 w-[240px] shrink-0 border-r border-[var(--line)]',
            'bg-[rgba(10,12,22,0.78)] backdrop-blur-2xl transition-transform duration-200',
            'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
            open ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="flex h-full flex-col">
            {/* Brand Header */}
            <Link
              href={brandHref}
              className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-4 transition hover:opacity-90"
            >
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-lg"
                style={{
                  background: 'var(--grad)',
                  boxShadow: '0 6px 20px rgba(139,92,246,0.45)',
                }}
              >
                <Activity size={19} strokeWidth={2.6} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">{brandEyebrow}</span>
                <span className="truncate text-sm font-extrabold tracking-tight text-[var(--text)]">
                  {brandName}
                </span>
              </div>
            </Link>

            {/* Navigation links */}
            <div className="flex-1 overflow-y-auto py-2">{navList}</div>

            {/* Live Indicator Chip */}
            <div className="px-3 pb-2">
              <div className="mode-chip live" title="LiveKit & Neural Voice Active">
                <span className="dot" />
                <Headphones size={13} className="shrink-0" />
                <span className="truncate">Live: WebRTC Direct</span>
              </div>
            </div>

            {/* Footer */}
            {footer ? (
              <div className="border-t border-[var(--line)] p-3 text-xs">{footer}</div>
            ) : null}
          </div>
        </aside>

        {/* Backdrop for mobile drawer */}
        {open ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
          />
        ) : null}

        {/* Main Content Area */}
        <div className="relative z-10 min-w-0 flex-1">
          {toolbar ? (
            <div className="sticky top-0 z-20 hidden items-center justify-end gap-2.5 border-b border-[var(--line)] bg-[rgba(8,10,18,0.7)] px-6 py-2.5 backdrop-blur-xl lg:flex">
              {toolbar}
            </div>
          ) : null}
          <main className="mx-auto w-full max-w-[1400px] px-5 py-7 sm:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
