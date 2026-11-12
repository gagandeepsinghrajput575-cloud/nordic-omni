'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X, LayoutDashboard, Users, Settings, Building2, Phone, BookOpen, Webhook, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/components/ui/core';
import { BrandLockup, BrandMark } from '@/components/ui/BrandMark';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { buttonClass } from '@/components/ui/form';
import { useFocusTrap } from '@/components/ui/overlay';
import { LogoutButton } from './LogoutButton';

const ICONS = { dashboard: LayoutDashboard, users: Users, settings: Settings, building: Building2, phone: Phone, knowledge: BookOpen, webhook: Webhook } satisfies Record<string, LucideIcon>;
export type IconKey = keyof typeof ICONS;
export interface NavItem { href: string; label: string; icon: IconKey; exact?: boolean }

export function AppShell({ nav, brandEyebrow, brandName, brandHref, footer, toolbar, accountEmail, children }: {
  nav: NavItem[]; brandEyebrow: string; brandName: string; brandHref: string;
  footer?: ReactNode; toolbar?: ReactNode; accountEmail?: string; children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useFocusTrap(drawerRef, open, close);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const changed = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', changed);
    return () => desktop.removeEventListener('change', changed);
  }, []);

  const isActive = (item: NavItem) => item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const current = [...nav].reverse().find(isActive);

  const navigation = (scope: string) => (
    <nav aria-label={`${brandEyebrow} navigation`} className="flex flex-col gap-1 px-4">
      {nav.map((item) => {
        const active = isActive(item);
        const Icon = ICONS[item.icon];
        return (
          <Link key={item.href} href={item.href} onClick={close} aria-current={active ? 'page' : undefined} className="nav-link">
            {active ? <motion.span layoutId={`nav-${scope}`} className="nav-indicator" transition={{ type: 'spring', stiffness: 420, damping: 36 }} aria-hidden /> : null}
            <Icon size={17} strokeWidth={1.7} className="relative z-10 shrink-0" aria-hidden />
            <span className="relative z-10 truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const sidebarContent = (scope: string) => (
    <>
      <Link href={brandHref} onClick={close} className="flex min-h-[76px] items-center px-6" aria-label="Nordic Omni home"><BrandLockup eyebrow="Voice-led business" /></Link>
      <div className="workspace-switcher">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><BrandMark size={12} />{brandEyebrow}</div>
        <p className="truncate text-[13px] font-semibold tracking-[-0.015em]" title={brandName}>{brandName}</p>
      </div>
      <p className="mb-2 px-7 text-[11px] font-medium text-[var(--muted)]">{brandEyebrow === 'Agency' ? 'Management' : 'Workspace'}</p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">{navigation(scope)}</div>
      <div className="border-t border-[var(--line)] px-5 py-4">
        {footer ? <div className="mb-4">{footer}</div> : null}
        {accountEmail ? <p className="mb-2 truncate text-[11px] text-[var(--muted)]" title={accountEmail}>{accountEmail}</p> : null}
        <LogoutButton />
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="flex min-h-dvh">
        <aside className="app-sidebar sticky top-0 hidden h-dvh shrink-0 lg:flex lg:flex-col">{sidebarContent('desktop')}</aside>
        <div className="min-w-0 flex-1">
          <header className="app-toolbar sticky top-0 z-30 flex items-center justify-between gap-3 px-4 lg:hidden">
            <Link href={brandHref} aria-label={`${brandName} overview`}><BrandLockup eyebrow={brandEyebrow} name={brandName} compact /></Link>
            <div className="flex items-center gap-2">
              <ThemeSwitcher />
              <button ref={menuRef} type="button" onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open} className={buttonClass('secondary', 'sm', 'icon-button')}><Menu size={18} /></button>
            </div>
          </header>
          <div className="app-toolbar sticky top-0 z-20 hidden items-center justify-between gap-4 px-8 lg:flex">
            <div className="flex min-w-0 items-center gap-2 text-[12px]"><span className="truncate text-[var(--muted)]">{brandName}</span><ChevronRight size={13} className="shrink-0 text-[var(--muted)]" aria-hidden /><span className="shrink-0 font-medium">{current?.label ?? brandEyebrow}</span></div>
            <div className="flex shrink-0 items-center gap-4">{toolbar}<ThemeSwitcher /></div>
          </div>
          <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.button type="button" tabIndex={-1} aria-label="Close navigation" className="absolute inset-0 bg-[rgba(28,21,18,.48)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={close} />
            <motion.aside ref={drawerRef} role="dialog" aria-modal="true" aria-label="Workspace navigation" tabIndex={-1} className="app-sidebar absolute inset-y-0 left-0 flex w-[min(320px,88vw)] flex-col shadow-2xl" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}>
              <button type="button" onClick={close} aria-label="Close navigation" className={cn(buttonClass('ghost', 'sm', 'icon-button'), 'absolute right-3 top-5')}><X size={18} /></button>
              {sidebarContent('mobile')}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
