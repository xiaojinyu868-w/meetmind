import { describe, expect, it } from 'vitest';
import { mergeFeedPreferences, parseFeedPreferenceRecord } from './feed-preference-service';

describe('feed preference service', () => {
  it('parses persisted intelligence feed feedback', () => {
    const result = parseFeedPreferenceRecord({
      title: '[feed:probe-near:quick-sort] 👍',
      content: JSON.stringify({
        rating: 'up',
        mode: 'intelligence-feed',
        messageText: '随机化快排\n一段摘要\n对齐你收藏的快排问题',
      }),
      createdAt: new Date('2026-07-12T00:00:00.000Z'),
    });
    expect(result).toMatchObject({
      type: 'probe-near',
      title: '随机化快排',
      rating: 'up',
      whyForYou: '对齐你收藏的快排问题',
    });
  });

  it('ignores unrelated or malformed feedback', () => {
    expect(parseFeedPreferenceRecord({
      title: '[message] 👍',
      content: JSON.stringify({ rating: 'up', mode: 'review', messageText: 'x' }),
      createdAt: new Date(),
    })).toBeNull();
  });

  it('lets current-device feedback override older account history', () => {
    const current = [{ type: 'summary' as const, title: 'A', rating: 'down' as const, createdAt: 'new' }];
    const account = [
      { type: 'summary' as const, title: 'A', rating: 'up' as const, createdAt: 'old' },
      { type: 'probe-near' as const, title: 'B', rating: 'up' as const, createdAt: 'old' },
    ];
    expect(mergeFeedPreferences(current, account)).toEqual([
      current[0],
      account[1],
    ]);
  });
});
