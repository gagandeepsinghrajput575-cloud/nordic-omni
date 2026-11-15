'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SPRING, springFor } from '@/lib/motion/springs';
import { BORDER_REVEAL_PX, NAV_LINKS } from './welcome-content';

/**
 * The sticky frosted header.
 *
 * **Border reveal.** Past 20px the bottom edge becomes visible. The edge is its
 * own absolutely-positioned 1px layer that is always present, so revealing it
 * animates `opacity` (compositor-friendly, no layout) instead of toggling a
 * border on the bar — which would reflow the fixed header and everything under
 * it by a pixel on every crossing.
 *
 * **Scroll listener.** Passive, and the handler is idempotent: it only calls
 * `setScrolled` when the boolean actually changes, so a long scroll does not
 * queue a re-render per frame.
 *
 * The gradient CTA is `--primary-bg`, which already resolves to the light
 * gradient in dark and `#09090b` in light. No literal is needed.
 */

export interface WelcomeNavigationProps {
  className?: string;
}

export function WelcomeNavigation({ className }: WelcomeNavigationProps) {
  const reduceMotion = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const next = window.scrollY > BORDER_REVEAL_PX;
      // Guarded so the state setter is not called on every scroll frame.
      setScrolled((current) => (current === next ? current : next));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={['wnav', className ?? ''].filter(Boolean).join(' ')}>
      <div className="wnav__inner">
        <a className="wnav__brand" href="/welcome">
          Nordic Omni
        </a>

        <nav className="wnav__links" aria-label="Hovednavigation">
          {NAV_LINKS.map((link) => (
            <a className="wnav__link" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="wnav__actions">
          <a className="wnav__ghost" href="/portal">
            Portal
          </a>
          <a className="wnav__cta" href="/agency">
            Åbn konsol
          </a>
        </div>
      </div>

      <motion.span
        className="wnav__edge"
        aria-hidden="true"
        initial={false}
        animate={{ opacity: scrolled ? 1 : 0 }}
        transition={springFor(reduceMotion, SPRING)}
      />
    </header>
  );
}
