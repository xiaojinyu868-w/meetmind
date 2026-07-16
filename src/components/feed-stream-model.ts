import type { FeedItem } from '@/types';

/**
 * “今日情报”先证明它能带回真实外部信息，再展示基于个人上下文的整理。
 * 分区逻辑保持为纯函数，避免内容优先级散落在 JSX 条件里。
 */
export function partitionFeedItems(items: FeedItem[]): {
  externalItems: FeedItem[];
  internalItems: FeedItem[];
} {
  const externalItems = items.filter((item) => (
    item.type === 'web-recommend' || item.type === 'bili-recommend'
  ));
  const externalSet = new Set(externalItems);
  return {
    externalItems,
    internalItems: items.filter((item) => !externalSet.has(item)),
  };
}

/** 外部发现与个人线索交替出现，让首屏同时具备“向外看”和“看见自己”。 */
export function buildFeedSequence(items: FeedItem[]): FeedItem[] {
  const { externalItems, internalItems } = partitionFeedItems(items);
  const sequence: FeedItem[] = [];
  const maxLength = Math.max(externalItems.length, internalItems.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (externalItems[index]) sequence.push(externalItems[index]);
    if (internalItems[index]) sequence.push(internalItems[index]);
  }
  return sequence;
}
