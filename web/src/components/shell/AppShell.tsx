'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Menu, X, LayoutDashboard, Users, Settings, Building2, MessagesSquare, Phone, BookOpen, Webhook, ChevronRight, Bot, type LucideIcon } from 'lucide-react';
import { cn } from '@/components/ui/core';
import { BrandLockup, BrandMark } from '@/components/ui/BrandMark';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { buttonClass } from '@/components/ui/form';
import { useFocusTrap } from '@/components/ui/overlay';
import { SPRING, pageIn, pageRest } from '@/lib/motion/springs';
import { LogoutButton } from './LogoutButton';

const ICONS = { dashboard: LayoutDashboard, users: Users, settings: Settings, building: Building2, phone: Phone, knowledge: BookOpen, webhook: Webhook, messages: MessagesSquare, bot: Bot } satisfies Record<string, LucideIcon>;
export type IconKey = keyof typeof ICONS;
export interface NavItem { href: string; label: string; icon: IconKey; exact?: boolean }

/** The spring the nav tile travels on: the shared vocabulary, not a local copy. */
const NAV_SPRING = SPRING;

export function AppShell({ nav, brandEyebrow, brandName, brandHref, footer, toolbar, accountEmail, children }: {
  nav: NavItem[]; brandEyebrow: string; brandName: string; brandHref: string;
  footer?: ReactNode; toolbar?: ReactNode; accountEmail?: string; children: ReactNode;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
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
    <nav aria-label={`${brandEyebrow} navigation`} className="flex flex-col gap-1 px-3">
      {nav.map((item) => {
        const active = isActive(item);
        const Icon = ICONS[item.icon];
        return (
          <Link key={item.href} href={item.href} onClick={close} aria-current={active ? 'page' : undefined} className="el-nav-link">
            {/* One shared tile glides between rows instead of a per-row slab. */}
            {active ? (
              <motion.span
                layoutId={`nav-tile-${scope}`}
                className="el-nav-tile"
                transition={reduceMotion ? { duration: 0 } : NAV_SPRING}
                aria-hidden
              />
            ) : null}
            <Icon size={16} strokeWidth={1.7} className="relative z-10 shrink-0" aria-hidden />
            <span className="relative z-10 truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const sidebarContent = (scope: string) => (
    <>
      <Link href={brandHref} onClick={close} className="flex min-h-[74px] items-center px-5" aria-label="Nordic Omni home">
        <BrandLockup eyebrow="Voice-led business" />
      </Link>
      <div className="mx-3 mb-5 rounded-xl border border-[var(--el-line)] bg-[color-mix(in_srgb,var(--el-elevated)_55%,transparent)] px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] text-[var(--el-ink-muted)]"><BrandMark size={12} />{brandEyebrow}</div>
        <p className="truncate text-[13px] font-semibold tracking-[-0.015em]" title={brandName}>{brandName}</p>
      </div>
      <p className="mb-2 px-5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--el-ink-muted)]">{brandEyebrow === 'Agency' ? 'Management' : 'Workspace'}</p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">{navigation(scope)}</div>
      <div className="border-t border-[var(--el-line)] px-4 py-4">
        {footer ? <div className="mb-4">{footer}</div> : null}
        {accountEmail ? <p className="mb-2 truncate text-[11px] text-[var(--el-ink-muted)]" title={accountEmail}>{accountEmail}</p> : null}
        <LogoutButton />
      </div>
    </>
  );

  return (
    <div className="el-canvas app-shell-el min-h-dvh">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="flex min-h-dvh">
        <aside className="el-sidebar sticky top-0 hidden h-dvh w-[var(--sidebar-width)] shrink-0 lg:flex lg:flex-col">
          {sidebarContent('desktop')}
        </aside>
        <div className="min-w-0 flex-1">
          <header className="el-header sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-2.5 lg:hidden">
            <Link href={brandHref} aria-label={`${brandName} overview`}><BrandLockup eyebrow={brandEyebrow} name={brandName} compact /></Link>
            <div className="flex items-center gap-2">
              <ThemeSwitcher />
              <button ref={menuRef} type="button" onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open} className={buttonClass('secondary', 'sm', 'icon-button')}><Menu size={18} /></button>
            </div>
          </header>

          {/* A floating frosted bar rather than a full-bleed strip. */}
          <div className="sticky top-0 z-20 hidden px-6 pt-4 lg:block">
            <div className="el-header el-shimmer flex items-center justify-between gap-4 rounded-2xl border border-[var(--el-line)] px-5 py-2.5">
              <div className="flex min-w-0 items-center gap-2 text-[12px]">
                <span className="truncate text-[var(--el-ink-muted)]">{brandName}</span>
                <ChevronRight size={13} className="shrink-0 text-[var(--el-ink-muted)]" aria-hidden />
                <span className="shrink-0 font-medium text-[var(--el-ink)]">{current?.label ?? brandEyebrow}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">{toolbar}<ThemeSwitcher /></div>
            </div>
          </div>

          {/*
            Route transition: the stage springs up 8px into place on every
            navigation. Keyed on the pathname so it replays, and collapsed to
            opacity-only under reduced motion so nothing travels.
          */}
          <motion.main
            key={pathname}
            id="main-content"
            tabIndex={-1}
            initial={pageIn(reduceMotion)}
            animate={pageRest(reduceMotion)}
            className="mx-auto w-full max-w-[1440px] px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-7"
          >
            {children}
          </motion.main>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.button type="button" tabIndex={-1} aria-label="Close navigation" className="absolute inset-0 bg-[var(--overlay)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} onClick={close} />
            <motion.aside ref={drawerRef} role="dialog" aria-modal="true" aria-label="Workspace navigation" tabIndex={-1} className="el-sidebar absolute inset-y-0 left-0 flex w-[min(320px,88vw)] flex-col shadow-2xl" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 34 }}>
              <button type="button" onClick={close} aria-label="Close navigation" className={cn(buttonClass('ghost', 'sm', 'icon-button'), 'absolute right-3 top-5')}><X size={18} /></button>
              {sidebarContent('mobile')}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
