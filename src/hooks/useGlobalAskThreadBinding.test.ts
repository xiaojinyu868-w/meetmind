import { describe, expect, it } from 'vitest';
import type { LearningThreadEntry } from '@/types/user';
import { linkLearningThreadToConversation } from './useGlobalAskThreadBinding';

function thread(overrides: Partial<LearningThreadEntry> = {}): LearningThreadEntry {
  return {
    id: 'thread-1',
    title: '学会机会成本',
    intent: '我想真正理解机会成本',
    depth: 'deep',
    status: 'active',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('linkLearningThreadToConversation', () => {
  it('links an active thread to the actual conversation', () => {
    expect(linkLearningThreadToConversation(
      thread(),
      'conversation-1',
      '2026-08-05T00:01:00.000Z',
    )).toMatchObject({
      conversationId: 'conversation-1',
      updatedAt: '2026-08-05T00:01:00.000Z',
    });
  });

  it('does not overwrite a thread that is already linked', () => {
    expect(linkLearningThreadToConversation(
      thread({ conversationId: 'conversation-original' }),
      'conversation-other',
    )).toBeUndefined();
  });

  it('does not bind an inactive thread', () => {
    expect(linkLearningThreadToConversation(
      thread({ status: 'completed' }),
      'conversation-1',
    )).toBeUndefined();
  });
});
