import { describe, expect, it } from 'vitest';
import type { FeedItem } from '@/types';
import { partitionFeedItems } from './feed-stream-model';

describe('partitionFeedItems', () => {
  it('separates real external discoveries from generated internal context', () => {
    const internal: FeedItem = {
      type: 'summary',
      title: '你最近在读学习科学',
      body: '这是从个人上下文形成的内部整理。',
    };
    const external: FeedItem = {
      type: 'web-recommend',
      title: 'Retrieval Practice Review',
      body: 'A real external source.',
      contentUrl: 'https://example.edu/retrieval-practice',
      contentKind: 'paper',
    };

    expect(partitionFeedItems([internal, external])).toEqual({
      externalItems: [external],
      internalItems: [internal],
    });
  });
});
