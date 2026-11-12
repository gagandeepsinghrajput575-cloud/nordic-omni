'use client';

import { useId } from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/lib/theme/ThemeContext';
import { cn } from '@/components/ui/core';

const OPTIONS: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Use light theme', icon: Sun },
  { id: 'dark', label: 'Use dark theme', icon: Moon },
];

export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const id = useId();
  return (
    <div className={cn('theme-switcher', className)} role="group" aria-label="Appearance">
      {OPTIONS.map(({ id: value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className="theme-option"
          aria-label={label}
          title={label}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
        >
          {theme === value ? (
            <motion.span layoutId={`theme-${id}`} className="theme-option-indicator" aria-hidden transition={{ type: 'spring', stiffness: 450, damping: 35 }} />
          ) : null}
          <Icon size={15} strokeWidth={1.7} className="relative z-10" aria-hidden />
        </button>
      ))}
    </div>
  );
}
