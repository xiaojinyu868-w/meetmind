import { describe, expect, it } from 'vitest';
import type { ConversationHistory, ConversationMessage } from '@/types/conversation';
import {
  MAX_WORKSPACE_CONVERSATION_MESSAGE_CHARS,
  buildAccountConversationMutation,
  buildWorkspaceConversationMessageMutation,
  buildWorkspaceConversationMutation,
  parseWorkspaceConversationMessageMutations,
  parseWorkspaceConversationMutations,
} from './workspace-conversation';

function conversation(overrides: Partial<ConversationHistory> = {}): ConversationHistory {
  return {
    conversationId: 'conversation-1',
    userId: 'user-1',
    type: 'global-chat',
    title: '复习对话',
    sessionId: 'session-1',
    messageCount: 2,
    lastMessage: '为什么这里可以直接约掉？',
    createdAt: new Date('2026-08-04T00:00:00.000Z'),
    updatedAt: new Date('2026-08-04T00:02:00.000Z'),
    ...overrides,
  };
}

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    messageId: 'message-1',
    conversationId: 'conversation-1',
    role: 'user',
    content: '为什么这里可以直接约掉？',
    createdAt: new Date('2026-08-04T00:01:00.000Z'),
    ...overrides,
  };
}

describe('workspace conversation contract', () => {
  it('builds active and deletion mutations for a classroom conversation', () => {
    expect(buildWorkspaceConversationMutation(conversation(), {
      mutationId: 'mutation-1',
    })).toMatchObject({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      status: 'active',
      mutationId: 'mutation-1',
    });
    expect(buildWorkspaceConversationMutation(conversation(), {
      mutationId: 'mutation-2',
      status: 'deleted',
    })?.status).toBe('deleted');
  });

  it('does not queue account-global chat against a classroom capture', () => {
    expect(buildWorkspaceConversationMutation(conversation({ sessionId: 'global-ask' }), {
      mutationId: 'mutation-1',
    })).toBeNull();
    expect(buildAccountConversationMutation(conversation({ sessionId: 'global-ask' }), {
      mutationId: 'mutation-account',
    })).toMatchObject({
      sessionId: 'global-ask',
      mutationId: 'mutation-account',
    });
    expect(buildAccountConversationMutation(conversation(), {
      mutationId: 'mutation-classroom',
    })).toBeNull();
  });

  it('keeps remote attachments but drops local data and blob URLs', () => {
    const mutation = buildWorkspaceConversationMessageMutation(message({
      attachments: [
        { type: 'image', url: 'data:image/png;base64,abc' },
        { type: 'file', url: 'blob:https://meetmind.local/123' },
        { type: 'image', url: 'https://cdn.example.com/frame.png', name: '板书' },
      ],
    }), 'mutation-1');
    expect(mutation?.attachments).toEqual([{
      type: 'image',
      url: 'https://cdn.example.com/frame.png',
      name: '板书',
    }]);
  });

  it('bounds an individual message artifact', () => {
    const mutation = buildWorkspaceConversationMessageMutation(message({
      content: '课'.repeat(MAX_WORKSPACE_CONVERSATION_MESSAGE_CHARS + 10),
    }), 'mutation-1');
    expect(mutation?.content).toHaveLength(MAX_WORKSPACE_CONVERSATION_MESSAGE_CHARS);
  });

  it('parses valid evidence and rejects incomplete records', () => {
    expect(parseWorkspaceConversationMutations([
      buildWorkspaceConversationMutation(conversation(), { mutationId: 'mutation-1' }),
      { conversationId: 'broken' },
    ])).toHaveLength(1);
    expect(parseWorkspaceConversationMessageMutations([
      buildWorkspaceConversationMessageMutation(message(), 'mutation-2'),
      { messageId: 'broken' },
    ])).toHaveLength(1);
  });
});
