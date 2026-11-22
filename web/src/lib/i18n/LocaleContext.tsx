'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  DICTIONARY,
  LOCALE_COOKIE,
  normalizeLocale,
  type AppLocale,
  type UiDictionary,
} from './locale';

interface LocaleContextValue {
  locale: AppLocale;
  dict: UiDictionary;
  setLocale: (next: AppLocale) => void;
  toggleLocale: () => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function persistLocale(next: AppLocale): void {
  try {
    window.localStorage.setItem(LOCALE_COOKIE, next);
  } catch {
    // Storage may be blocked in restricted browser contexts.
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  document.documentElement.lang = next;
}

export function LocaleProvider({
  initialLocale = 'en',
  children,
}: {
  initialLocale?: AppLocale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: AppLocale) => {
      const normalized = normalizeLocale(next, 'en');
      if (normalized === locale) return;
      setLocaleState(normalized);
      persistLocale(normalized);
      // Re-render Server Components with the updated omni_locale cookie.
      router.refresh();
    },
    [locale, router],
  );

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'en' ? 'da' : 'en');
  }, [locale, setLocale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dict: DICTIONARY[locale],
      setLocale,
      toggleLocale,
    }),
    [locale, setLocale, toggleLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: 'en',
      dict: DICTIONARY.en,
      setLocale: () => {},
      toggleLocale: () => {},
    };
  }
  return ctx;
}
