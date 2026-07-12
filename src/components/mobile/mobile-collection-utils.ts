import type { SourceIngestItem } from '@/types/page-types';

/** 移动首页按资料收件箱呈现；复制后排序，避免改动桌面收集流共享顺序。 */
export function sortCollectionNewestFirst(items: SourceIngestItem[]): SourceIngestItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const timeDifference = new Date(b.item.addedAt).getTime() - new Date(a.item.addedAt).getTime();
      return timeDifference || b.index - a.index;
    })
    .map(({ item }) => item);
}
