import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  rateLimit: vi.fn(),
  getSnapshot: vi.fn(),
  syncMutations: vi.fn(),
}));

vi.mock('@/lib/services/auth-service', () => ({
  authService: { verifyToken: mocks.verifyToken },
}));

vi.mock('@/lib/utils/rate-limit', () => ({
  applyRateLimit: mocks.rateLimit,
}));

vi.mock('@/lib/services/account-conversation-service', () => ({
  AccountConversationMutationError: class AccountConversationMutationError extends Error {},
  getAccountConversationSnapshot: mocks.getSnapshot,
  syncAccountConversationMutations: mocks.syncMutations,
}));

import { GET, POST } from './route';

describe('/api/conversations/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(null);
    mocks.verifyToken.mockReturnValue({ sub: 'user-1' });
    mocks.getSnapshot.mockResolvedValue({ conversations: [], messages: [] });
    mocks.syncMutations.mockResolvedValue({ accepted: 2, ignored: 0 });
  });

  it('returns only the authenticated account snapshot', async () => {
    const response = await GET(new NextRequest('http://localhost/api/conversations/sync', {
      headers: { Authorization: 'Bearer token' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      conversations: [],
      messages: [],
    });
    expect(mocks.getSnapshot).toHaveBeenCalledWith('user-1');
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.any(NextRequest), 'default');
  });

  it('requests the active learning thread in addition to the recent snapshot', async () => {
    await GET(new NextRequest(
      'http://localhost/api/conversations/sync?conversationId=conversation-thread',
      { headers: { Authorization: 'Bearer token' } },
    ));

    expect(mocks.getSnapshot).toHaveBeenCalledWith('user-1', {
      pinnedConversationId: 'conversation-thread',
    });
  });

  it('binds every uploaded mutation to the token account', async () => {
    const conversations = [{ conversationId: 'conversation-1' }];
    const messages = [{ messageId: 'message-1' }];
    const response = await POST(new NextRequest('http://localhost/api/conversations/sync', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversations, messages }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.syncMutations).toHaveBeenCalledWith({
      userId: 'user-1',
      conversations,
      messages,
    });
  });

  it('rejects missing bearer authentication before reading account data', async () => {
    mocks.verifyToken.mockReturnValue(null);
    const response = await GET(new NextRequest('http://localhost/api/conversations/sync'));

    expect(response.status).toBe(401);
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
});
