import { expect, test } from '@playwright/test';
import {
  buildCollectionQuoteDraft,
  buildSelectedCollectionContextText,
  resolveCollectionContextPrimaryId,
  type CollectionContextItem,
} from '../../src/lib/capture/collection-context';

function item(overrides: Partial<CollectionContextItem> = {}): CollectionContextItem {
  return {
    id: 'item-1',
    type: 'text',
    title: '随手记录',
    preview: '我先记一句当下的困惑。',
    fullText: '',
    ...overrides,
  };
}

test.describe('collection context utils', () => {
  test('prefers media first and otherwise falls back to the latest selected item', async () => {
    const items = [
      item({ id: 'text-1', type: 'text', title: '文字线索' }),
      item({ id: 'audio-1', type: 'audio', title: '课堂原声' }),
      item({ id: 'doc-1', type: 'document', title: '讲义' }),
    ];

    expect(resolveCollectionContextPrimaryId(items, 'doc-1')).toBe('audio-1');
    expect(resolveCollectionContextPrimaryId(items, null)).toBe('audio-1');
    expect(
      resolveCollectionContextPrimaryId(
        [
          item({ id: 'text-1', title: '第一条' }),
          item({ id: 'text-2', title: '第二条' }),
        ],
        null
      )
    ).toBe('text-2');
  });

  test('builds selected context text with a main focus section and support sections', async () => {
    const contextText = buildSelectedCollectionContextText({
      items: [
        item({
          id: 'video-1',
          type: 'video',
          title: '极限与导数课堂片段',
          preview: '老师在这里从几何直观过渡到导数定义。',
        }),
        item({
          id: 'doc-1',
          type: 'document',
          title: '课后讲义',
          fullText: '讲义里把单调性、极值和导数符号放在了一起。',
        }),
      ],
      primaryId: 'doc-1',
    });

    expect(contextText).toContain('以下是用户刚刚主动圈出来的上下文');
    expect(contextText).toContain('【这次主要内容｜视频】极限与导数课堂片段');
    expect(contextText).toContain('【补充内容】');
    expect(contextText).toContain('[材料] 课后讲义');
  });

  test('builds a natural quote draft for single and multi selection', async () => {
    const singleDraft = buildCollectionQuoteDraft({
      items: [
        item({
          id: 'audio-1',
          type: 'audio',
          title: '课堂原声',
          preview: '这里老师开始解释为什么导数大于零可以推出单调递增。',
        }),
      ],
      primaryId: 'audio-1',
    });

    expect(singleDraft).toContain('我想顺着这条继续记：');
    expect(singleDraft).toContain('【原声】课堂原声');
    expect(singleDraft).toContain('我想补一句：');

    const multiDraft = buildCollectionQuoteDraft({
      items: [
        item({
          id: 'video-1',
          type: 'video',
          title: '极限与导数课堂片段',
          preview: '老师在这里从几何直观过渡到导数定义。',
        }),
        item({
          id: 'text-2',
          type: 'text',
          title: '我自己的困惑',
          preview: '我卡在“符号”和“变化趋势”之间到底差了哪一步。',
        }),
      ],
      primaryId: 'text-2',
    });

    expect(multiDraft).toContain('我想把这几条一起带上，继续记：');
    expect(multiDraft).toContain('【视频】极限与导数课堂片段');
    expect(multiDraft).toContain('一起参考：');
    expect(multiDraft).toContain('我想补一句：');
  });
});
