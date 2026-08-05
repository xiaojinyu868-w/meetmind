import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createConversationHistory: vi.fn(),
  getConversationById: vi.fn(),
  getConversationByAnchorId: vi.fn(),
  getUserConversations: vi.fn(),
  searchUserConversations: vi.fn(),
  updateConversationHistory: vi.fn(),
  deleteConversationHistory: vi.fn(),
  addConversationMessage: vi.fn(),
  addConversationMessages: vi.fn(),
  getConversationMessages: vi.fn(),
  getConversationMessageCount: vi.fn(),
  enqueueConversation: vi.fn(),
  enqueueMessage: vi.fn(),
  enqueueAccountConversation: vi.fn(),
  enqueueAccountMessage: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  createConversationHistory: mocks.createConversationHistory,
  getConversationById: mocks.getConversationById,
  getConversationByAnchorId: mocks.getConversationByAnchorId,
  getUserConversations: mocks.getUserConversations,
  searchUserConversations: mocks.searchUserConversations,
  updateConversationHistory: mocks.updateConversationHistory,
  deleteConversationHistory: mocks.deleteConversationHistory,
  addConversationMessage: mocks.addConversationMessage,
  addConversationMessages: mocks.addConversationMessages,
  getConversationMessages: mocks.getConversationMessages,
  getConversationMessageCount: mocks.getConversationMessageCount,
}));

vi.mock('@/lib/services/workspace-conversation-sync-client', () => ({
  enqueueWorkspaceConversationMutation: mocks.enqueueConversation,
  enqueueWorkspaceConversationMessageMutation: mocks.enqueueMessage,
}));

vi.mock('@/lib/services/account-conversation-sync-client', () => ({
  enqueueAccountConversationMutation: mocks.enqueueAccountConversation,
  enqueueAccountConversationMessageMutation: mocks.enqueueAccountMessage,
}));

import { conversationService } from './conversation-service';

function storedConversation() {
  return {
    id: 1,
    conversationId: 'conversation-1',
    userId: 'user-1',
    type: 'global-chat' as const,
    title: '矩阵复习',
    sessionId: 'session-1',
    messageCount: 1,
    lastMessage: '为什么这里这样推导？',
    createdAt: new Date('2026-08-04T00:00:00.000Z'),
    updatedAt: new Date('2026-08-04T00:02:00.000Z'),
  };
}

describe('conversation service workspace sync wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'conversation-1') });
    mocks.getConversationMessageCount.mockResolvedValue(1);
    mocks.getConversationById.mockResolvedValue(storedConversation());
  });

  it('queues a classroom conversation after its local record succeeds', async () => {
    await conversationService.createConversation({
      userId: 'user-1',
      type: 'global-chat',
      title: '矩阵复习',
      sessionId: 'session-1',
    });

    expect(mocks.createConversationHistory).toHaveBeenCalledOnce();
    expect(mocks.enqueueConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      sessionId: 'session-1',
    }));
  });

  it('queues both the updated parent and an appended message', async () => {
    const message = await conversationService.addMessage('conversation-1', {
      role: 'user',
      content: '为什么这里这样推导？',
    });

    expect(mocks.addConversationMessage).toHaveBeenCalledOnce();
    expect(mocks.updateConversationHistory).toHaveBeenCalledOnce();
    expect(mocks.enqueueConversation).toHaveBeenCalledOnce();
    expect(mocks.enqueueMessage).toHaveBeenCalledWith('session-1', message);
  });

  it('queues a parent tombstone after deleting the local conversation', async () => {
    await conversationService.deleteConversation('conversation-1');

    expect(mocks.deleteConversationHistory).toHaveBeenCalledWith('conversation-1');
    expect(mocks.enqueueConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-1' }),
      { status: 'deleted' },
    );
  });

  it('routes account-global history away from classroom evidence', async () => {
    mocks.getConversationById.mockResolvedValue({
      ...storedConversation(),
      sessionId: 'global-ask',
    });
    const message = await conversationService.addMessage('conversation-1', {
      role: 'user',
      content: '把今天所有课里的矩阵知识串起来',
    });

    expect(mocks.enqueueAccountConversation).toHaveBeenCalledOnce();
    expect(mocks.enqueueAccountMessage).toHaveBeenCalledWith('user-1', message);
    expect(mocks.enqueueConversation).not.toHaveBeenCalled();
    expect(mocks.enqueueMessage).not.toHaveBeenCalled();
  });
});
