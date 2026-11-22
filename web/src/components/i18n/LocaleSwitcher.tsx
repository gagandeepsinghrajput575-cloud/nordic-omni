'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Globe } from 'lucide-react';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { SPRING, springFor } from '@/lib/motion/springs';

/**
 * Instant DA | EN segmented language switcher.
 * Uses only theme tokens (zero literal colors) to preserve monochrome parity
 * across both Studio light and Obsidian dark themes.
 */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const reduceMotion = useReducedMotion();

  return (
    <div
      role="group"
      aria-label="Language"
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        border: '1px solid var(--line)',
        borderRadius: 999,
        background: 'var(--accent-soft)',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          paddingLeft: 6,
          paddingRight: 2,
          color: 'var(--muted)',
        }}
      >
        <Globe size={12} strokeWidth={1.8} />
      </span>
      {(['en', 'da'] as const).map((code) => {
        const active = locale === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={active}
            aria-label={code === 'en' ? 'Switch to English' : 'Skift til dansk'}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 24,
              padding: '2px 9px',
              borderRadius: 999,
              border: 'none',
              background: 'transparent',
              color: active ? 'var(--text)' : 'var(--muted)',
              fontSize: 11,
              fontWeight: active ? 620 : 500,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {active ? (
              <motion.span
                aria-hidden
                layoutId="locale-pill"
                transition={springFor(reduceMotion, SPRING)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 999,
                  background: 'var(--wash-3)',
                  border: '1px solid var(--accent-line)',
                  boxShadow: 'var(--hl)',
                }}
              />
            ) : null}
            <span style={{ position: 'relative' }}>{code.toUpperCase()}</span>
          </button>
        );
      })}
    </div>
  );
}
