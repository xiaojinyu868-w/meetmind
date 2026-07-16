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
