'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';

export type ThemeMode = 'light' | 'dark';
const STORAGE_KEY = 'nordic-omni-theme';

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/** The fallback when the visitor has expressed no preference at all. */
export const DEFAULT_THEME: ThemeMode = 'light';

/**
 * Resolve the theme in the same order the pre-paint script uses, so hydration
 * never disagrees with what the browser already painted:
 *   saved preference -> OS preference -> DEFAULT_THEME.
 */
function readTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Storage can be unavailable in private or embedded browsing. */ }
  try {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch { /* matchMedia is not guaranteed in every embedded webview. */ }
  return DEFAULT_THEME;
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.remove('light', 'dark', 'theme-nordic-noir', 'theme-industrial-volt', 'theme-surgical-daylight');
  root.classList.add(theme);
  document.body.classList.remove('theme-nordic-noir', 'theme-industrial-volt', 'theme-surgical-daylight');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      // Another tab toggled: adopt its value verbatim rather than re-deriving,
      // because that tab may have chosen explicitly against the OS preference.
      if (event.newValue === 'light' || event.newValue === 'dark') setTheme(event.newValue);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* In-memory preference still works. */ }
  }, [theme, ready]);

  const cycleTheme = useCallback(
    () => setTheme((current) => (current === 'light' ? 'dark' : 'light')),
    [],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme }}>
      <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
        {children}
      </MotionConfig>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
