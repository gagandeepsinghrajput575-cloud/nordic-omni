'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'nordic-noir' | 'industrial-volt' | 'surgical-daylight';

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEMES: ThemeMode[] = ['nordic-noir', 'industrial-volt', 'surgical-daylight'];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('nordic-noir');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('nordic-omni-theme') as ThemeMode | null;
      if (savedTheme && THEMES.includes(savedTheme)) {
        setThemeState(savedTheme);
      }
    } catch {
      // Ignore localStorage errors (e.g. private browsing)
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const body = document.body;

    // Remove any previous theme classes
    THEMES.forEach((t) => {
      root.classList.remove(`theme-${t}`);
      body.classList.remove(`theme-${t}`);
    });

    // Add current theme class
    root.classList.add(`theme-${theme}`);
    body.classList.add(`theme-${theme}`);

    // Manage standard dark class for Tailwind
    if (theme === 'surgical-daylight') {
      root.classList.remove('dark');
      body.classList.remove('dark');
    } else {
      root.classList.add('dark');
      body.classList.add('dark');
    }

    try {
      localStorage.setItem('nordic-omni-theme', theme);
    } catch {
      // Ignore
    }
  }, [theme, mounted]);

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
  };

  const cycleTheme = () => {
    const nextIndex = (THEMES.indexOf(theme) + 1) % THEMES.length;
    setThemeState(THEMES[nextIndex]);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

