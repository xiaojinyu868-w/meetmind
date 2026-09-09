import { describe, expect, it } from 'vitest';
import { countToday, formatPocketTime, groupPocketItems, shouldClipPastedHtml, type PocketItem } from './pocket-model';

function item(partial: Partial<PocketItem> & { id: string; occurredAt: string }): PocketItem {
  return {
    sourceKey: `k-${partial.id}`,
    sourceType: 'desktop-clip',
    contentType: 'text',
    title: partial.id,
    previewText: partial.id,
    normalizedText: null,
    mediaUrl: null,
    pocket: null,
    ...partial,
  };
}

describe('groupPocketItems', () => {
  it('相邻同 groupKey 归一组，来源名取第一条', () => {
    const groups = groupPocketItems([
      item({ id: 'a', occurredAt: '2026-09-09T06:10:00Z', pocket: { groupKey: 'chatgpt.com/c/1#1', sourceLabel: 'ChatGPT', source: { url: 'https://chatgpt.com/c/1' } } }),
      item({ id: 'b', occurredAt: '2026-09-09T06:05:00Z', pocket: { groupKey: 'chatgpt.com/c/1#1', sourceLabel: 'ChatGPT' } }),
      item({ id: 'c', occurredAt: '2026-09-09T05:00:00Z', sourceType: 'desktop-screenshot', contentType: 'image', mediaUrl: '/x.png' }),
      item({ id: 'd', occurredAt: '2026-09-09T04:00:00Z', pocket: { groupKey: 'chatgpt.com/c/1#0', sourceLabel: 'ChatGPT' } }),
    ]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(groups[0].label).toBe('ChatGPT');
    expect(groups[0].url).toBe('https://chatgpt.com/c/1');
    expect(groups[1].label).toBe('屏幕截图');
  });
});

describe('formatPocketTime / countToday', () => {
  const now = new Date('2026-09-09T14:30:00');
  it('相对与绝对时间口径', () => {
    expect(formatPocketTime('2026-09-09T14:29:40', now)).toBe('刚刚');
    expect(formatPocketTime('2026-09-09T14:12:00', now)).toBe('18 分钟前');
    expect(formatPocketTime('2026-09-09T09:05:00', now)).toBe('09:05');
    expect(formatPocketTime('2026-09-08T21:00:00', now)).toBe('昨天 21:00');
    expect(formatPocketTime('2026-09-01T08:00:00', now)).toBe('9-1 08:00');
  });
  it('只数今天的', () => {
    expect(countToday([
      item({ id: 'a', occurredAt: '2026-09-09T01:00:00' }),
      item({ id: 'b', occurredAt: '2026-09-08T23:59:00' }),
    ], now)).toBe(1);
  });
});

describe('shouldClipPastedHtml', () => {
  it('带结构的 HTML 直接收；一句话留给输入框', () => {
    expect(shouldClipPastedHtml('x = 1', '<pre><code>x = 1</code></pre>')).toBe(true);
    expect(shouldClipPastedHtml('好的', '<span>好的</span>')).toBe(false);
    expect(shouldClipPastedHtml('好的', '')).toBe(false);
  });
});
