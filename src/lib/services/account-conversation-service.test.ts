import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortableWorkspaceConversationMutation } from '@/lib/capture/workspace-conversation';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  conversationFindUnique: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationFindMany: vi.fn(),
  snapshotFindFirst: vi.fn(),
  conversationUpsert: vi.fn(),
  messageFindUnique: vi.fn(),
  messageCreate: vi.fn(),
  messageDeleteMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: mocks.transaction,
    accountConversation: {
      findMany: mocks.conversationFindMany,
      findFirst: mocks.snapshotFindFirst,
    },
  },
}));

import {
  AccountConversationMutationError,
  getAccountConversationSnapshot,
  shouldIgnoreAccountConversationMutation,
  syncAccountConversationMutations,
} from './account-conversation-service';

function conversation(
  overrides: Partial<PortableWorkspaceConversationMutation> = {},
): PortableWorkspaceConversationMutation {
  return {
    conversationId: 'conversation-1',
    type: 'global-chat',
    title: '线性代数复习',
    sessionId: 'global-ask',
    messageCount: 1,
    lastMessage: '特征值是什么？',
    metadata: { scope: 'global-ask', depth: 'quick' },
    status: 'active',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:02:00.000Z',
    mutationId: 'mutation-2',
    ...overrides,
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'message-1',
    conversationId: 'conversation-1',
    role: 'user',
    content: '特征值是什么？',
    status: 'active',
    createdAt: '2026-08-04T00:01:00.000Z',
    updatedAt: '2026-08-04T00:01:00.000Z',
    mutationId: 'message-mutation-1',
    ...overrides,
  };
}

describe('account conversation sync service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      accountConversation: {
        findUnique: mocks.conversationFindUnique,
        findFirst: mocks.conversationFindFirst,
        upsert: mocks.conversationUpsert,
      },
      accountConversationMessage: {
        findUnique: mocks.messageFindUnique,
        create: mocks.messageCreate,
        deleteMany: mocks.messageDeleteMany,
      },
    }));
    mocks.conversationFindUnique.mockResolvedValue(null);
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1' });
    mocks.messageFindUnique.mockResolvedValue(null);
    mocks.snapshotFindFirst.mockResolvedValue(null);
  });

  it('uses client time and mutation id for deterministic last-write-wins', () => {
    const current = {
      clientUpdatedAt: new Date('2026-08-04T00:02:00.000Z'),
      sourceMutationId: 'mutation-2',
    };
    expect(shouldIgnoreAccountConversationMutation(
      current,
      conversation({ updatedAt: '2026-08-04T00:01:00.000Z' }),
    )).toBe(true);
    expect(shouldIgnoreAccountConversationMutation(
      current,
      conversation({ mutationId: 'mutation-1' }),
    )).toBe(true);
    expect(shouldIgnoreAccountConversationMutation(
      current,
      conversation({ mutationId: 'mutation-3' }),
    )).toBe(false);
  });

  it('stores an active conversation before its immutable message', async () => {
    await expect(syncAccountConversationMutations({
      userId: 'user-1',
      conversations: [conversation()],
      messages: [message()],
    })).resolves.toEqual({ accepted: 2, ignored: 0 });

    expect(mocks.conversationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        id: 'conversation-1',
        userId: 'user-1',
        scope: 'global-ask',
        sourceMutationId: 'mutation-2',
      }),
    }));
    expect(mocks.messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'message-1', conversationId: 'conversation-1' }),
    });
  });

  it('ignores a stale mutation without changing server state', async () => {
    mocks.conversationFindUnique.mockResolvedValue({
      userId: 'user-1',
      clientUpdatedAt: new Date('2026-08-04T00:03:00.000Z'),
      sourceMutationId: 'mutation-new',
    });

    await expect(syncAccountConversationMutations({
      userId: 'user-1',
      conversations: [conversation()],
      messages: [],
    })).resolves.toEqual({ accepted: 0, ignored: 1 });
    expect(mocks.conversationUpsert).not.toHaveBeenCalled();
  });

  it('retains a parent tombstone and removes its messages', async () => {
    await syncAccountConversationMutations({
      userId: 'user-1',
      conversations: [conversation({ status: 'deleted' })],
      messages: [],
    });

    expect(mocks.conversationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'deleted' }),
    }));
    expect(mocks.messageDeleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversation-1' },
    });
  });

  it('rejects a stable id already owned by another account', async () => {
    mocks.conversationFindUnique.mockResolvedValue({
      userId: 'user-2',
      clientUpdatedAt: new Date('2026-08-04T00:01:00.000Z'),
      sourceMutationId: 'mutation-1',
    });

    await expect(syncAccountConversationMutations({
      userId: 'user-1',
      conversations: [conversation()],
      messages: [],
    })).rejects.toMatchObject<AccountConversationMutationError>({ code: 'CONFLICT' });
  });

  it('returns active and deleted snapshots without trusting malformed attachments', async () => {
    mocks.conversationFindMany.mockResolvedValue([
      {
        id: 'conversation-1',
        type: 'global-chat',
        title: '线性代数复习',
        messageCount: 1,
        lastMessage: '特征值是什么？',
        model: null,
        metadataJson: '{"scope":"global-ask"}',
        status: 'active',
        clientCreatedAt: new Date('2026-08-04T00:00:00.000Z'),
        clientUpdatedAt: new Date('2026-08-04T00:02:00.000Z'),
        sourceMutationId: 'mutation-2',
        messages: [{
          id: 'message-1',
          conversationId: 'conversation-1',
          role: 'assistant',
          content: '矩阵作用后方向不变的向量对应的缩放量。',
          attachmentsJson: '{bad-json',
          clientCreatedAt: new Date('2026-08-04T00:01:00.000Z'),
          sourceMutationId: 'message-mutation-1',
        }],
      },
      {
        id: 'conversation-deleted',
        type: 'global-chat',
        title: '',
        messageCount: 0,
        lastMessage: null,
        model: null,
        metadataJson: null,
        status: 'deleted',
        clientCreatedAt: new Date('2026-08-03T00:00:00.000Z'),
        clientUpdatedAt: new Date('2026-08-04T00:03:00.000Z'),
        sourceMutationId: 'mutation-deleted',
        messages: [],
      },
    ]);

    await expect(getAccountConversationSnapshot('user-1')).resolves.toMatchObject({
      conversations: [
        { conversationId: 'conversation-1', status: 'active' },
        { conversationId: 'conversation-deleted', status: 'deleted' },
      ],
      messages: [{ messageId: 'message-1', attachments: undefined }],
    });
    expect(mocks.conversationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { messages: { orderBy: { clientCreatedAt: 'desc' }, take: 500 } },
    }));
  });

  it('adds an authenticated pinned thread even when it is outside the recent window', async () => {
    mocks.conversationFindMany.mockResolvedValue([]);
    mocks.snapshotFindFirst.mockResolvedValue({
      id: 'conversation-thread',
      type: 'global-chat',
      title: '继续理解机会成本',
      messageCount: 0,
      lastMessage: null,
      model: null,
      metadataJson: '{"scope":"global-ask","depth":"deep"}',
      status: 'active',
      clientCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
      clientUpdatedAt: new Date('2026-08-01T00:10:00.000Z'),
      sourceMutationId: 'mutation-thread',
      messages: [],
    });

    await expect(getAccountConversationSnapshot('user-1', {
      pinnedConversationId: 'conversation-thread',
    })).resolves.toMatchObject({
      conversations: [{ conversationId: 'conversation-thread' }],
    });
    expect(mocks.snapshotFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'conversation-thread',
        userId: 'user-1',
        scope: 'global-ask',
      },
    }));
  });
});
