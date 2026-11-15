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

/**
 * The product has one visual identity, so this always resolves to 'dark'.
 *
 * The old three-theme engine (`nordic-noir`, `industrial-volt`,
 * `surgical-daylight`) and the retired light shell all collapse here. Reading
 * storage is kept so a stale key is overwritten rather than reinterpreted, but
 * no stored value can bring the warm shell back.
 */
function readTheme(): ThemeMode {
  try {
    localStorage.getItem(STORAGE_KEY);
  } catch { /* Storage can be unavailable in private or embedded browsing. */ }
  return 'dark';
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
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setTheme(readTheme());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* In-memory preference still works. */ }
  }, [theme, ready]);

  const cycleTheme = useCallback(() => setTheme((current) => current === 'light' ? 'dark' : 'light'), []);

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
