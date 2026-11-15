'use client';

import { useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme/ThemeContext';
import { SPRING, springFor } from '@/lib/motion/springs';

/**
 * Tier 2 — a real theme toggle, not a badge.
 *
 * Two states, one spring-animated pill that glides between them via `layoutId`.
 * It is a single button with `aria-pressed`, so it is reachable and operable by
 * keyboard (Space/Enter are native button semantics) and announced correctly.
 *
 * The icon rotates rather than swapping instantly, so the state change reads as
 * a physical motion; under `prefers-reduced-motion` the rotation is dropped and
 * the pill jumps, because the icon swap plus the label still convey the state.
 */
export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const { theme, cycleTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    // A button already reports Space/Enter, but handling them explicitly keeps
    // the toggle working when it is composed into a non-button host element.
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      cycleTheme();
    }
  }, [cycleTheme]);

  return (
    <button
      type="button"
      onClick={cycleTheme}
      onKeyDown={onKeyDown}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        minHeight: 30,
        padding: '3px 11px 3px 9px',
        border: '1px solid var(--line)',
        borderRadius: 999,
        background: 'var(--accent-soft)',
        color: 'var(--text)',
        fontSize: 11,
        fontWeight: 550,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      {/* The travelling pill: one shared layout element, so it glides. */}
      <motion.span
        aria-hidden
        layoutId="theme-pill"
        transition={springFor(reduceMotion, SPRING)}
        style={{
          position: 'absolute',
          insetBlock: 3,
          left: isDark ? 'calc(50% - 1px)' : 3,
          right: isDark ? 3 : 'calc(50% + 1px)',
          borderRadius: 999,
          background: isDark ? 'var(--wash-4)' : 'var(--chip-glass)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--hl)',
        }}
      />
      <motion.span
        aria-hidden
        style={{ position: 'relative', display: 'inline-flex' }}
        animate={reduceMotion ? undefined : { rotate: isDark ? 0 : 180 }}
        transition={springFor(reduceMotion, SPRING)}
      >
        {isDark ? <Moon size={12} strokeWidth={1.9} /> : <Sun size={12} strokeWidth={1.9} />}
      </motion.span>
      <span style={{ position: 'relative' }}>{isDark ? 'Obsidian' : 'Studio'}</span>
    </button>
  );
}
