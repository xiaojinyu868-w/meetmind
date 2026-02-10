import { cookies } from 'next/headers';
import { Locale, defaultLocale, locales } from '@/i18n/config';

const COOKIE_NAME = 'NEXT_LOCALE';

export async function getUserLocale(): Promise<Locale> {
  const cookieStore = cookies();
  const locale = cookieStore.get(COOKIE_NAME)?.value as Locale;
  
  if (locale && locales.includes(locale)) {
    return locale;
  }
  
  return defaultLocale;
}

export async function setUserLocale(locale: Locale) {
  const cookieStore = cookies();
  cookieStore.set(COOKIE_NAME, locale, {
    maxAge: 365 * 24 * 60 * 60, // 1 year
    path: '/',
  });
}
