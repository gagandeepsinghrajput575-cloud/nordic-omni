import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale, type AppLocale } from './locale';

export async function getServerLocale(fallback: AppLocale = 'en'): Promise<AppLocale> {
  try {
    const jar = await cookies();
    const raw = jar.get(LOCALE_COOKIE)?.value;
    return normalizeLocale(raw, fallback);
  } catch {
    return fallback;
  }
}
