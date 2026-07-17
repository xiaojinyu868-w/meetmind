import { describe, expect, it, vi } from 'vitest';
import {
  createWechatIdentityClaimService,
  type WechatIdentityClaimStore,
} from './wechat-identity-claim-service';

function createStore(overrides: Partial<WechatIdentityClaimStore> = {}): WechatIdentityClaimStore {
  return {
    claim: vi.fn(async (input) => ({
      status: input.targetUserId ? 'owned-by-target' : 'created',
      userId: input.targetUserId || 'new-user',
      created: !input.targetUserId,
    })),
    findOwner: vi.fn(async () => null),
    ...overrides,
  };
}

describe('wechat identity claim service', () => {
  it('returns the winning owner when concurrent first-login claims collide', async () => {
    const store = createStore({
      claim: vi.fn(async () => {
        const error = new Error('unique constraint');
        Object.assign(error, { code: 'P2002' });
        throw error;
      }),
      findOwner: vi.fn(async () => 'winning-user'),
    });
    const service = createWechatIdentityClaimService(store);

    const result = await service.claim({
      openId: 'wx-open-id',
      username: 'wx_candidate',
      nickname: '微信用户',
    });

    expect(result).toEqual({ status: 'existing', userId: 'winning-user', created: false });
  });

  it('reports a conflict when another user wins a concurrent bind', async () => {
    const store = createStore({
      claim: vi.fn(async () => {
        const error = new Error('unique constraint');
        Object.assign(error, { code: 'P2002' });
        throw error;
      }),
      findOwner: vi.fn(async () => 'other-user'),
    });
    const service = createWechatIdentityClaimService(store);

    const result = await service.claim({
      openId: 'wx-open-id',
      targetUserId: 'current-user',
      username: 'unused',
      nickname: '微信用户',
    });

    expect(result).toEqual({ status: 'owned-by-other', userId: 'other-user', created: false });
  });

  it('does not swallow unrelated database errors', async () => {
    const store = createStore({
      claim: vi.fn(async () => { throw new Error('database offline'); }),
    });
    const service = createWechatIdentityClaimService(store);

    await expect(service.claim({
      openId: 'wx-open-id',
      username: 'wx_candidate',
      nickname: '微信用户',
    })).rejects.toThrow('database offline');
  });
});
