export type CollectionContextItemType = 'audio' | 'video' | 'image' | 'document' | 'text';

export interface CollectionContextItem {
  id: string;
  type: CollectionContextItemType;
  title: string;
  preview?: string;
  fullText?: string;
}

function compactText(value: string, maxLength: number): string {
  const normalized = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function getCollectionContextDisplayTitle(
  item: Pick<CollectionContextItem, 'type' | 'title' | 'preview' | 'fullText'>,
  maxLength: number
): string {
  const normalizedTitle = String(item.title || '').trim();
  const looksLikeClockLabel = /^(录音|原声|视频)\s*\d{1,2}:\d{2}(?::\d{2})?$/.test(normalizedTitle);

  const preferred =
    item.type === 'text'
      ? item.preview || item.fullText || item.title
      : (item.type === 'audio' || item.type === 'video') && looksLikeClockLabel
        ? item.preview || item.fullText || '一段原声'
        : item.title || item.preview || item.fullText || '';

  return compactText(preferred, maxLength);
}

export function getCollectionContextTypeLabel(type: CollectionContextItemType): string {
  switch (type) {
    case 'audio':
      return '原声';
    case 'video':
      return '视频';
    case 'image':
      return '图片';
    case 'document':
      return '材料';
    default:
      return '文字';
  }
}

function getCollectionContextBody(item: CollectionContextItem, maxLength: number): string {
  return compactText(item.fullText || item.preview || item.title, maxLength);
}

export function resolveCollectionContextPrimaryId(
  items: CollectionContextItem[],
  currentPrimaryId?: string | null
): string | null {
  if (items.length === 0) return null;

  const mediaFirst = items.find((item) => item.type === 'audio' || item.type === 'video');
  if (mediaFirst) {
    return mediaFirst.id;
  }

  if (currentPrimaryId && items.some((item) => item.id === currentPrimaryId)) {
    return currentPrimaryId;
  }

  return items[items.length - 1]?.id || null;
}

export function buildSelectedCollectionContextText(params: {
  items: CollectionContextItem[];
  primaryId?: string | null;
  maxLength?: number;
}): string {
  const maxLength = params.maxLength ?? 2600;
  const items = params.items.filter(Boolean);
  if (items.length === 0) return '';

  const primaryId = resolveCollectionContextPrimaryId(items, params.primaryId);
  const primaryItem = items.find((item) => item.id === primaryId) || items[items.length - 1];
  const supportItems = items.filter((item) => item.id !== primaryItem.id);

  const sections: string[] = [
    '以下是用户刚刚主动圈出来的上下文。请先围绕“这次主要内容”理解问题，再参考后面的补充内容，不要把未选内容当成当前重点。',
    '',
    `【这次主要内容｜${getCollectionContextTypeLabel(primaryItem.type)}】${getCollectionContextDisplayTitle(primaryItem, 60)}`,
    getCollectionContextBody(primaryItem, 700),
  ];

  if (supportItems.length > 0) {
    sections.push('', '【补充内容】');
    supportItems.forEach((item, index) => {
      sections.push(
        `${index + 1}. [${getCollectionContextTypeLabel(item.type)}] ${getCollectionContextDisplayTitle(item, 60)}`,
        getCollectionContextBody(item, 320)
      );
    });
  }

  return compactText(sections.join('\n'), maxLength);
}

export function buildCollectionQuoteDraft(params: {
  items: CollectionContextItem[];
  primaryId?: string | null;
  maxLength?: number;
}): string {
  const maxLength = params.maxLength ?? 900;
  const items = params.items.filter(Boolean);
  if (items.length === 0) return '';

  const primaryId = resolveCollectionContextPrimaryId(items, params.primaryId);
  const primaryItem = items.find((item) => item.id === primaryId) || items[items.length - 1];
  const supportItems = items.filter((item) => item.id !== primaryItem.id);

  const lines: string[] = [
    items.length > 1 ? '我想把这几条一起带上，继续记：' : '我想顺着这条继续记：',
    `【${getCollectionContextTypeLabel(primaryItem.type)}】${getCollectionContextDisplayTitle(primaryItem, 48)}`,
    getCollectionContextBody(primaryItem, 180),
  ];

  if (supportItems.length > 0) {
    lines.push('一起参考：');
    supportItems.forEach((item) => {
      lines.push(`- ${getCollectionContextDisplayTitle(item, 36)}：${getCollectionContextBody(item, 90)}`);
    });
  }

  lines.push('我想补一句：');
  return compactText(lines.join('\n'), maxLength);
}
