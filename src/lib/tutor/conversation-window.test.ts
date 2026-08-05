import { describe, expect, it } from 'vitest';
import {
  mergeRestoredAndLiveMessages,
  selectPreferredConversation,
  selectTutorConversationWindow,
} from './conversation-window';

function message(id: string, role: 'user' | 'assistant', text: string) {
  return { id, role, parts: [{ type: 'text', text }] };
}

describe('selectTutorConversationWindow', () => {
  it('keeps the newest turns and drops an orphaned leading assistant reply', () => {
    const messages = [
      message('u1', 'user', 'first'),
      message('a1', 'assistant', 'first answer'),
      message('u2', 'user', 'second'),
      message('a2', 'assistant', 'second answer'),
      message('u3', 'user', 'latest'),
    ];

    expect(selectTutorConversationWindow(messages, { maxMessages: 4 }).map((item) => item.id))
      .toEqual(['u2', 'a2', 'u3']);
  });

  it('always keeps the latest user message even when it alone exceeds the budget', () => {
    const latest = message('latest', 'user', 'x'.repeat(4_000));
    const selected = selectTutorConversationWindow([
      message('old', 'user', 'old'),
      latest,
    ], { maxSerializedChars: 1_000 });

    expect(selected).toEqual([latest]);
  });

  it('does not mutate the adapter message list', () => {
    const messages = [message('u1', 'user', 'one'), message('a1', 'assistant', 'two')];
    selectTutorConversationWindow(messages, { maxMessages: 1 });
    expect(messages.map((item) => item.id)).toEqual(['u1', 'a1']);
  });

  it('keeps optimistic messages submitted while persisted history is restoring', () => {
    const restored = [message('old', 'assistant', 'earlier')];
    const live = [message('new', 'user', 'just submitted')];
    expect(mergeRestoredAndLiveMessages(restored, live).map((item) => item.id))
      .toEqual(['old', 'new']);
  });
});

describe('selectPreferredConversation', () => {
  const conversations = [
    { conversationId: 'latest', scope: 'global-ask' },
    { conversationId: 'thread', scope: 'global-ask' },
    { conversationId: 'classroom', scope: 'classroom' },
  ];

  it('restores the conversation bound to a learning thread', () => {
    expect(selectPreferredConversation(
      conversations,
      'thread',
      (conversation) => conversation.scope === 'global-ask',
    )?.conversationId).toBe('thread');
  });

  it('falls back to the latest matching history for legacy threads', () => {
    expect(selectPreferredConversation(
      conversations,
      'missing',
      (conversation) => conversation.scope === 'global-ask',
    )?.conversationId).toBe('latest');
  });

  it('never restores an ineligible preferred conversation', () => {
    expect(selectPreferredConversation(
      conversations,
      'classroom',
      (conversation) => conversation.scope === 'global-ask',
    )?.conversationId).toBe('latest');
  });
});
