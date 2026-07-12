import type { FeedItem } from '@/types';

const STORAGE_KEY = 'meetmind-feed-preferences-v1';
const MAX_PREFERENCES = 20;

export interface FeedPreference {
  type: FeedItem['type'];
  title: string;
  whyForYou?: string;
  rating: 'up' | 'down';
  createdAt: string;
}

export function readFeedPreferences(): FeedPreference[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.slice(0, MAX_PREFERENCES) : [];
  } catch {
    return [];
  }
}

export function recordFeedPreference(item: FeedItem, rating: 'up' | 'down'): void {
  if (typeof window === 'undefined') return;
  const preference: FeedPreference = {
    type: item.type,
    title: item.title.slice(0, 120),
    whyForYou: item.whyForYou?.slice(0, 160),
    rating,
    createdAt: new Date().toISOString(),
  };
  try {
    const previous = readFeedPreferences().filter((entry) => (
      entry.type !== preference.type || entry.title !== preference.title
    ));
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([preference, ...previous].slice(0, MAX_PREFERENCES)),
    );
  } catch {
    // 私密模式或存储禁用时，服务端反馈仍然可以正常上报。
  }
}
