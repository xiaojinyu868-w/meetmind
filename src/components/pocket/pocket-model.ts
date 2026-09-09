/**
 * 口袋流的纯模型：服务端只列条目，分组与时间口径在这里（可单测）。
 * 相邻两条 groupKey 相同就归一组（同一来源 30 分钟窗内的连续剪藏），截图 / 随手记各自成组。
 */

import { POCKET_COPY } from '@/lib/ui/copy-pocket';

export interface PocketItem {
  id: string;
  sourceKey: string;
  sourceType: string;
  contentType: string;
  title: string;
  previewText: string;
  normalizedText: string | null;
  mediaUrl: string | null;
  occurredAt: string;
  pocket: {
    source?: { app?: string; windowTitle?: string; url?: string; pageTitle?: string };
    sourceLabel?: string;
    groupKey?: string;
    format?: string;
    hasMath?: boolean;
    charCount?: number;
  } | null;
}

export interface PocketGroup {
  key: string;
  /** 来源名（ChatGPT / 微信 / 屏幕截图 / 随手记…） */
  label: string;
  url?: string;
  items: PocketItem[];
  latestAt: string;
}

export function pocketItemLabel(item: PocketItem): string {
  if (item.pocket?.sourceLabel) return item.pocket.sourceLabel;
  if (item.pocket?.source?.app) return item.pocket.source.app;
  if (item.sourceType === 'desktop-screenshot') return '屏幕截图';
  if (item.sourceType === 'desktop-drop') return '拖进来的图';
  if (item.sourceType === 'manual-note') return '随手记';
  return '桌面';
}

function groupKeyOf(item: PocketItem): string {
  if (item.pocket?.groupKey) return item.pocket.groupKey;
  // 没有分组键的（截图 / 随手记）：同类型 30 分钟内归一组
  const bucket = Math.floor(new Date(item.occurredAt).getTime() / (30 * 60 * 1000));
  return `${item.sourceType}#${bucket}`;
}

/** items 按发生时间倒序传入；相邻同组合并 */
export function groupPocketItems(items: PocketItem[]): PocketGroup[] {
  const groups: PocketGroup[] = [];
  for (const item of items) {
    const key = groupKeyOf(item);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    groups.push({
      key,
      label: pocketItemLabel(item),
      url: item.pocket?.source?.url,
      items: [item],
      latestAt: item.occurredAt,
    });
  }
  return groups;
}

export function isToday(iso: string, now = new Date()): boolean {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function countToday(items: PocketItem[], now = new Date()): number {
  return items.filter((item) => isToday(item.occurredAt, now)).length;
}

/** 刚刚 / N 分钟前 / 14:02 / 昨天 14:02 / 9-7 14:02 */
export function formatPocketTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return POCKET_COPY.justNow;
  if (minutes < 60) return POCKET_COPY.minutesAgo(minutes);
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (isToday(iso, now)) return hhmm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isToday(iso, yesterday)) return `${POCKET_COPY.yesterday} ${hhmm}`;
  return `${date.getMonth() + 1}-${date.getDate()} ${hhmm}`;
}

/** 粘贴的内容够"富"（带结构的 HTML）才直接收进口袋，否则留在输入框里让人编辑 */
export function shouldClipPastedHtml(text: string, html: string): boolean {
  const plain = text.trim();
  const rich = html.trim();
  if (!rich) return false;
  if (/<(pre|code|table|ul|ol|h[1-6]|img|annotation)\b/i.test(rich)) return true;
  // 多段落的长文本也直接收（不是在写一句话）
  return plain.length > 240 && plain.includes('\n');
}
