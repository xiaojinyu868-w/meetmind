import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stateFind: vi.fn(),
  stateUpdateMany: vi.fn(),
  stateCreate: vi.fn(),
  stateDeleteMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    wechatOauthState: {
      create: mocks.stateCreate,
      deleteMany: mocks.stateDeleteMany,
    },
    $transaction: mocks.transaction,
  },
}));

import { wechatOauthStateService } from './wechat-oauth-state-service';

describe('wechat OAuth state service', () => {
  it('atomically consumes a valid state only once', async () => {
    const record = {
      id: 'state-id',
      state: 'state-value',
      linkToken: 'capture-token',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    };
    mocks.stateFind.mockResolvedValue(record);
    mocks.stateUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mocks.transaction.mockImplementation(async (callback) => callback({
      wechatOauthState: {
        findUnique: mocks.stateFind,
        updateMany: mocks.stateUpdateMany,
      },
    }));

    await expect(wechatOauthStateService.consume('state-value')).resolves.toEqual({ linkToken: 'capture-token' });
    await expect(wechatOauthStateService.consume('state-value')).resolves.toBeNull();
  });

  it('rejects an expired state without claiming it', async () => {
    vi.clearAllMocks();
    mocks.stateFind.mockResolvedValue({
      id: 'state-id',
      state: 'expired',
      linkToken: null,
      expiresAt: new Date(Date.now() - 1),
      consumedAt: null,
    });
    mocks.transaction.mockImplementation(async (callback) => callback({
      wechatOauthState: {
        findUnique: mocks.stateFind,
        updateMany: mocks.stateUpdateMany,
      },
    }));

    await expect(wechatOauthStateService.consume('expired')).resolves.toBeNull();
    expect(mocks.stateUpdateMany).not.toHaveBeenCalled();
  });
});
