import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { locales, defaultLocale } from './config';

// Import messages statically for Windows compatibility
import zhMessages from './messages/zh.json';
import enMessages from './messages/en.json';

const messagesMap: Record<string, typeof zhMessages> = {
  zh: zhMessages,
  en: enMessages,
};

const COOKIE_NAME = 'NEXT_LOCALE';

async function getLocale() {
  const cookieStore = cookies();
  const localeCookie = cookieStore.get(COOKIE_NAME);
  
  if (localeCookie && locales.includes(localeCookie.value as 'zh' | 'en')) {
    return localeCookie.value;
  }
  
  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await getLocale();
  
  return {
    locale,
    messages: messagesMap[locale] || messagesMap[defaultLocale]
  };
});
