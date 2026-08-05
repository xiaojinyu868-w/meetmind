import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationHistoryRecord, ConversationMessageRecord } from '@/lib/db';
import type { ConversationHistory, ConversationMessage } from '@/types/conversation';

const mocks = vi.hoisted(() => ({
  merge: vi.fn(),
  conversationToArray: vi.fn(),
  conversationFirst: vi.fn(),
  conversationUpdate: vi.fn(),
  messageToArray: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  ANONYMOUS_USER_ID: 'anonymous',
  db: {
    conversationHistory: {
      where: vi.fn((field: string) => ({
        equals: vi.fn(() => field === 'conversationId'
          ? { first: mocks.conversationFirst }
          : { toArray: mocks.conversationToArray }),
      })),
      update: mocks.conversationUpdate,
    },
    conversationMessages: {
      where: vi.fn(() => ({
        anyOf: vi.fn(() => ({ toArray: mocks.messageToArray })),
      })),
    },
  },
}));

vi.mock('@/lib/services/workspace-conversation-merge-service', () => ({
  mergeConversationMutationsFromCloud: mocks.merge,
}));

import {
  enqueueAccountConversationMessageMutation,
  enqueueAccountConversationMutation,
  readAccountConversationMutationOutbox,
  syncAccountConversationsNow,
} from './account-conversation-sync-client';

function createStorage() {
  const data = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    removeItem: vi.fn((key: string) => data.delete(key)),
  };
}

function conversation(userId: string, overrides: Partial<ConversationHistory> = {}): ConversationHistory {
  return {
    conversationId: `conversation-${userId}`,
    userId,
    type: 'global-chat',
    title: '跨课程复习',
    sessionId: 'global-ask',
    messageCount: 1,
    createdAt: new Date('2026-08-04T00:00:00.000Z'),
    updatedAt: new Date('2026-08-04T00:02:00.000Z'),
    ...overrides,
  };
}

function message(userId: string): ConversationMessage {
  return {
    messageId: `message-${userId}`,
    conversationId: `conversation-${userId}`,
    role: 'user',
    content: '把今天所有课里的知识串起来',
    createdAt: new Date('2026-08-04T00:01:00.000Z'),
  };
}

function conversationRecord(userId: string, conversationId: string): ConversationHistoryRecord {
  return {
    id: 1,
    conversationId,
    userId,
    type: 'global-chat',
    title: '继续理解机会成本',
    sessionId: 'global-ask',
    messageCount: 1,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:02:00.000Z'),
  };
}

function messageRecord(conversationId: string): ConversationMessageRecord {
  return {
    id: 1,
    messageId: 'message-older-thread',
    conversationId,
    role: 'user',
    content: '继续上次的机会成本练习',
    createdAt: new Date('2026-07-01T00:01:00.000Z'),
  };
}

function completeBootstrap(storage: ReturnType<typeof createStorage>, userId: string): void {
  storage.setItem(`meetmind_account_conversation_bootstrap_v1:${userId}`, 'complete');
}

function successfulFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => init?.method === 'POST'
      ? { success: true }
      : { success: true, conversations: [], messages: [] },
  }));
}

describe('account conversation sync client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mocks.conversationToArray.mockResolvedValue([]);
    mocks.conversationFirst.mockResolvedValue(undefined);
    mocks.conversationUpdate.mockResolvedValue(1);
    mocks.messageToArray.mockResolvedValue([]);
    mocks.merge.mockResolvedValue({
      inserted: 0,
      updated: 0,
      deleted: 0,
      messagesInserted: 0,
      ignored: 0,
    });
  });

  it('never flushes another account with the active account token', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    completeBootstrap(storage, 'user-b');
    enqueueAccountConversationMutation(conversation('user-a'), { mutationId: 'mutation-a' });
    enqueueAccountConversationMutation(conversation('user-b'), { mutationId: 'mutation-b' });
    const fetchMock = successfulFetch();
    vi.stubGlobal('fetch', fetchMock);

    await expect(syncAccountConversationsNow('token-b', 'user-b')).resolves.toMatchObject({
      sent: 1,
      pending: 0,
    });
    const postBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      conversations: Array<{ conversationId: string }>;
    };
    expect(postBody.conversations.map((item) => item.conversationId)).toEqual(['conversation-user-b']);
    expect(readAccountConversationMutationOutbox()).toEqual([
      expect.objectContaining({ userId: 'user-a' }),
    ]);

    completeBootstrap(storage, 'user-a');
    await syncAccountConversationsNow('token-a', 'user-a');
  });

  it('retains failed writes until the server explicitly accepts them', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    completeBootstrap(storage, 'user-retry');
    enqueueAccountConversationMessageMutation('user-retry', message('user-retry'), 'message-mutation');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ success: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
        success: true,
        conversations: [],
        messages: [],
      }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(syncAccountConversationsNow('token', 'user-retry')).resolves.toMatchObject({
      sent: 0,
      pending: 1,
    });
    expect(readAccountConversationMutationOutbox()).toHaveLength(1);

    vi.stubGlobal('fetch', successfulFetch());
    await expect(syncAccountConversationsNow('token', 'user-retry')).resolves.toMatchObject({
      sent: 1,
      pending: 0,
    });
  });

  it('keeps a newer tombstone when an older active mutation arrives late', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    enqueueAccountConversationMutation(conversation('user-delete', {
      updatedAt: new Date('2026-08-04T00:03:00.000Z'),
    }), { mutationId: 'mutation-delete', status: 'deleted' });
    enqueueAccountConversationMutation(conversation('user-delete'), { mutationId: 'mutation-active' });

    expect(readAccountConversationMutationOutbox()).toEqual([
      expect.objectContaining({
        userId: 'user-delete',
        payload: expect.objectContaining({ status: 'deleted', mutationId: 'mutation-delete' }),
      }),
    ]);

    completeBootstrap(storage, 'user-delete');
    vi.stubGlobal('fetch', successfulFetch());
    await syncAccountConversationsNow('token', 'user-delete');
  });

  it('requests the active learning thread even when it is outside the recent snapshot', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    completeBootstrap(storage, 'user-pinned');
    const fetchMock = successfulFetch();
    vi.stubGlobal('fetch', fetchMock);

    await syncAccountConversationsNow('token', 'user-pinned', 'conversation from old thread');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/sync?conversationId=conversation+from+old+thread',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' },
      }),
    );
  });

  it('uploads a pinned legacy thread after the recent-history bootstrap is already complete', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    completeBootstrap(storage, 'user-legacy');
    mocks.conversationFirst.mockResolvedValue(conversationRecord('user-legacy', 'older-thread'));
    mocks.messageToArray.mockResolvedValue([messageRecord('older-thread')]);
    const fetchMock = successfulFetch();
    vi.stubGlobal('fetch', fetchMock);

    await syncAccountConversationsNow('token', 'user-legacy', 'older-thread');

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall).toBeDefined();
    const body = JSON.parse(String(postCall?.[1]?.body)) as {
      conversations: Array<{ conversationId: string }>;
      messages: Array<{ messageId: string }>;
    };
    expect(body.conversations.map((item) => item.conversationId)).toEqual(['older-thread']);
    expect(body.messages.map((item) => item.messageId)).toEqual(['message-older-thread']);
    expect(storage.getItem('meetmind_account_conversation_pinned_bootstrap_v1:user-legacy:older-thread'))
      .toBe('complete');

    const secondFetch = successfulFetch();
    vi.stubGlobal('fetch', secondFetch);
    await syncAccountConversationsNow('token', 'user-legacy', 'older-thread');
    expect(secondFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('retries a pinned legacy upload until the server accepts it', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    completeBootstrap(storage, 'user-pinned-retry');
    mocks.conversationFirst.mockResolvedValue(conversationRecord('user-pinned-retry', 'retry-thread'));
    mocks.messageToArray.mockResolvedValue([messageRecord('retry-thread')]);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ success: false }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, conversations: [], messages: [] }),
      }));

    await syncAccountConversationsNow('token', 'user-pinned-retry', 'retry-thread');
    const marker = 'meetmind_account_conversation_pinned_bootstrap_v1:user-pinned-retry:retry-thread';
    expect(storage.getItem(marker)).toBeNull();

    vi.stubGlobal('fetch', successfulFetch());
    await syncAccountConversationsNow('token', 'user-pinned-retry', 'retry-thread');
    expect(storage.getItem(marker)).toBe('complete');
  });

  it('pulls a pinned thread after an already-running account sync settles', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    completeBootstrap(storage, 'user-concurrent');
    mocks.conversationFirst.mockResolvedValue(conversationRecord('user-concurrent', 'older-thread'));
    mocks.messageToArray.mockResolvedValue([messageRecord('older-thread')]);
    let releaseFirstPull: (() => void) | undefined;
    const firstPull = new Promise<void>((resolve) => { releaseFirstPull = resolve; });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/conversations/sync') await firstPull;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, conversations: [], messages: [] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const baseSync = syncAccountConversationsNow('token', 'user-concurrent');
    const pinnedSync = syncAccountConversationsNow('token', 'user-concurrent', 'older-thread');
    releaseFirstPull?.();
    await Promise.all([baseSync, pinnedSync]);

    expect(fetchMock.mock.calls.map(([url, init]) => init?.method === 'POST' ? 'POST' : url)).toEqual([
      '/api/conversations/sync',
      'POST',
      '/api/conversations/sync?conversationId=older-thread',
    ]);
  });

  it('claims anonymous global ask history for the first signed-in account', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    const guestConversation = conversationRecord('anonymous', 'guest-thread');
    mocks.conversationToArray.mockResolvedValue([guestConversation]);
    mocks.messageToArray.mockResolvedValue([messageRecord('guest-thread')]);
    mocks.conversationUpdate.mockImplementation(async (_id: number, patch: { userId: string }) => {
      guestConversation.userId = patch.userId;
      return 1;
    });
    const fetchMock = successfulFetch();
    vi.stubGlobal('fetch', fetchMock);

    await expect(syncAccountConversationsNow('token', 'user-claimed')).resolves.toMatchObject({
      sent: 0,
      pending: 0,
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall).toBeDefined();
    const body = JSON.parse(String(postCall?.[1]?.body)) as {
      conversations: Array<{ conversationId: string }>;
      messages: Array<{ messageId: string }>;
    };
    expect(body.conversations.map((item) => item.conversationId)).toEqual(['guest-thread']);
    expect(body.messages.map((item) => item.messageId)).toEqual(['message-older-thread']);
    expect(mocks.conversationUpdate).toHaveBeenCalledWith(1, { userId: 'user-claimed' });

    const secondFetch = successfulFetch();
    vi.stubGlobal('fetch', secondFetch);
    await syncAccountConversationsNow('token', 'user-other');
    expect(secondFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('keeps anonymous history claimable when the migration request fails', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    mocks.conversationToArray.mockResolvedValue([conversationRecord('anonymous', 'guest-retry')]);
    mocks.messageToArray.mockResolvedValue([messageRecord('guest-retry')]);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ success: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, conversations: [], messages: [] }) }));

    await expect(syncAccountConversationsNow('token', 'user-retry-guest')).resolves.toMatchObject({
      sent: 0,
      pending: 0,
    });
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', successfulFetch());
    await syncAccountConversationsNow('token', 'user-retry-guest');
    expect(mocks.conversationUpdate).toHaveBeenCalledWith(1, { userId: 'user-retry-guest' });
  });
});
