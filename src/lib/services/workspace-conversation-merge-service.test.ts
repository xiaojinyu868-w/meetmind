import { describe, expect, it } from 'vitest';
import type { ConversationHistoryRecord, ConversationMessageRecord } from '@/lib/db';
import type {
  PortableWorkspaceConversationMessageMutation,
  PortableWorkspaceConversationMutation,
} from '@/lib/capture/workspace-conversation';
import { planWorkspaceConversationMerge } from './workspace-conversation-merge-service';

function local(overrides: Partial<ConversationHistoryRecord> = {}): ConversationHistoryRecord {
  return {
    id: 1,
    conversationId: 'conversation-1',
    userId: 'user-1',
    type: 'global-chat',
    title: '本机标题',
    sessionId: 'session-1',
    messageCount: 1,
    createdAt: new Date('2026-08-04T00:00:00.000Z'),
    updatedAt: new Date('2026-08-04T00:01:00.000Z'),
    ...overrides,
  };
}

function remote(overrides: Partial<PortableWorkspaceConversationMutation> = {}): PortableWorkspaceConversationMutation {
  return {
    conversationId: 'conversation-1',
    type: 'global-chat',
    title: '云端标题',
    sessionId: 'session-1',
    messageCount: 2,
    status: 'active',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:02:00.000Z',
    mutationId: 'mutation-2',
    ...overrides,
  };
}

function message(overrides: Partial<PortableWorkspaceConversationMessageMutation> = {}): PortableWorkspaceConversationMessageMutation {
  return {
    messageId: 'message-1',
    conversationId: 'conversation-1',
    role: 'user',
    content: '为什么这里这样推导？',
    status: 'active',
    createdAt: '2026-08-04T00:01:00.000Z',
    updatedAt: '2026-08-04T00:01:00.000Z',
    mutationId: 'message-mutation-1',
    ...overrides,
  };
}

function plan(params: {
  localConversations?: ConversationHistoryRecord[];
  localMessages?: ConversationMessageRecord[];
  remoteConversations?: PortableWorkspaceConversationMutation[];
  remoteMessages?: PortableWorkspaceConversationMessageMutation[];
}) {
  return planWorkspaceConversationMerge({
    localConversations: params.localConversations || [],
    localMessages: params.localMessages || [],
    remoteConversations: params.remoteConversations || [],
    remoteMessages: params.remoteMessages || [],
    sessionId: 'session-1',
    userId: 'user-1',
  });
}

describe('workspace conversation cloud merge', () => {
  it('inserts a cloud conversation and its immutable message', () => {
    const result = plan({ remoteConversations: [remote()], remoteMessages: [message()] });
    expect(result).toMatchObject({ inserted: 1, messagesInserted: 1 });
    expect(result.conversationPuts[0]).toMatchObject({
      title: '云端标题',
      sourceMutationId: 'mutation-2',
    });
  });

  it('applies newer cloud metadata while preserving the IndexedDB primary key', () => {
    const result = plan({ localConversations: [local()], remoteConversations: [remote()] });
    expect(result).toMatchObject({ updated: 1 });
    expect(result.conversationPuts[0]).toMatchObject({ id: 1, title: '云端标题' });
  });

  it('preserves a newer local edit', () => {
    const result = plan({
      localConversations: [local({ updatedAt: new Date('2026-08-04T00:03:00.000Z') })],
      remoteConversations: [remote()],
    });
    expect(result).toMatchObject({ updated: 0, ignored: 1, conversationPuts: [] });
  });

  it('uses mutation id as the deterministic equal-time tie breaker', () => {
    const result = plan({
      localConversations: [local({
        updatedAt: new Date('2026-08-04T00:02:00.000Z'),
        sourceMutationId: 'mutation-1',
      })],
      remoteConversations: [remote()],
    });
    expect(result.updated).toBe(1);
  });

  it('turns a newer parent tombstone into a conversation and message delete', () => {
    const result = plan({
      localConversations: [local()],
      remoteConversations: [remote({ status: 'deleted' })],
      remoteMessages: [message()],
    });
    expect(result).toMatchObject({
      deleted: 1,
      conversationDeleteIds: [1],
      deletedConversationIds: ['conversation-1'],
      messagesInserted: 0,
    });
  });

  it('deduplicates messages and rejects orphan messages', () => {
    const existingMessage: ConversationMessageRecord = {
      id: 1,
      messageId: 'message-1',
      conversationId: 'conversation-1',
      role: 'user',
      content: '已经存在',
      createdAt: new Date('2026-08-04T00:01:00.000Z'),
    };
    const result = plan({
      localConversations: [local()],
      localMessages: [existingMessage],
      remoteMessages: [message(), message({ messageId: 'orphan', conversationId: 'missing' })],
    });
    expect(result).toMatchObject({ messagesInserted: 0, ignored: 2 });
  });
});
