'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Moon } from 'lucide-react';

/**
 * The product ships one visual identity: obsidian glass.
 *
 * The theme engine still writes `data-theme` for backwards compatibility and so
 * a returning visitor's saved preference does not break, but both values now
 * resolve to the same palette. This indicator replaces the old light/dark toggle
 * rather than pretending to offer a choice that no longer exists.
 */
export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px 3px 8px',
        border: '1px solid rgba(255,255,255,.10)',
        borderRadius: 999,
        background: 'rgba(255,255,255,.045)',
        fontSize: 11,
        fontWeight: 550,
        letterSpacing: '0.02em',
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}
      initial={false}
      animate={reduceMotion ? undefined : { opacity: 1 }}
      title="Obsidian is the only appearance"
    >
      <motion.span
        aria-hidden
        animate={reduceMotion ? undefined : { rotate: [0, -8, 0] }}
        transition={reduceMotion ? undefined : { duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ display: 'inline-flex', color: 'var(--accent-primary)' }}
      >
        <Moon size={12} strokeWidth={1.8} />
      </motion.span>
      <span>Obsidian</span>
    </motion.div>
  );
}
