import prisma from '@/lib/prisma';
import type { FeedPreference } from '@/lib/feed-preferences';
import type { FeedItemType } from '@/types';

interface FeedbackRecord {
  title: string;
  content: string;
  createdAt: Date;
}

const FEED_TYPE_PATTERN = /^\[feed:([^:]+):/;

export function parseFeedPreferenceRecord(record: FeedbackRecord): FeedPreference | null {
  try {
    const content = JSON.parse(record.content) as {
      rating?: unknown;
      mode?: unknown;
      messageText?: unknown;
    };
    if (content.mode !== 'intelligence-feed') return null;
    if (content.rating !== 'up' && content.rating !== 'down') return null;
    if (typeof content.messageText !== 'string') return null;

    const title = content.messageText.split('\n')[0]?.trim().slice(0, 120);
    const typeMatch = record.title.match(FEED_TYPE_PATTERN);
    if (!title || !typeMatch?.[1]) return null;

    const lines = content.messageText.split('\n');
    return {
      type: typeMatch[1] as FeedItemType,
      title,
      whyForYou: lines[2]?.trim().slice(0, 160) || undefined,
      rating: content.rating,
      createdAt: record.createdAt.toISOString(),
    };
  } catch {
    return null;
  }
}

export function mergeFeedPreferences(
  currentDevice: FeedPreference[] | undefined,
  accountHistory: FeedPreference[] | undefined,
): FeedPreference[] {
  const merged: FeedPreference[] = [];
  const seen = new Set<string>();
  for (const item of [...(currentDevice ?? []), ...(accountHistory ?? [])]) {
    if (!item || (item.rating !== 'up' && item.rating !== 'down') || !item.title) continue;
    const key = `${item.type}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      type: item.type,
      title: item.title.slice(0, 120),
      whyForYou: item.whyForYou?.slice(0, 160),
      rating: item.rating,
      createdAt: item.createdAt,
    });
    if (merged.length >= 20) break;
  }
  return merged;
}

export async function loadAccountFeedPreferences(userId: string): Promise<FeedPreference[]> {
  const records = await prisma.feedback.findMany({
    where: {
      userId,
      type: 'message-rating',
      content: { contains: '"mode":"intelligence-feed"' },
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { title: true, content: true, createdAt: true },
  });
  return records
    .map(parseFeedPreferenceRecord)
    .filter((item): item is FeedPreference => item !== null);
}
