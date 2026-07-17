import { describe, expect, it, vi } from 'vitest';
import type { AuthResponse, User } from '@/types/user';
import { createWechatIdentityService } from './wechat-identity-service';

const existingUser: User = {
  id: 'user-existing',
  username: 'existing',
  nickname: '已有用户',
  role: 'student',
  status: 'active',
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
};

function createDeps() {
  const session: AuthResponse = {
    success: true,
    user: existingUser,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };

  return {
    claimIdentity: vi.fn(async () => ({
      status: 'existing' as const,
      userId: 'user-existing',
      created: false,
    })),
    createSessionForUserId: vi.fn(async () => session),
    ensureAccountDataOwnership: vi.fn(async () => ({ workspace: null, repairedWechatMessages: 0 })),
    resolveWechatWorkspace: vi.fn(async () => null),
    syncWechatInboxArtifactsForOpenId: vi.fn(async () => undefined),
    randomHex: vi.fn(() => '0123456789abcdef'),
  };
}

describe('wechat identity service', () => {
  it('logs an existing WeChat identity into the actual linked account', async () => {
    const deps = createDeps();
    const service = createWechatIdentityService(deps);

    const result = await service.login({ openId: 'wx-open-id' });

    expect(result).toMatchObject({ success: true, accessToken: 'access-token' });
    expect(deps.claimIdentity).toHaveBeenCalledWith(expect.objectContaining({
      openId: 'wx-open-id',
      nickname: '微信用户',
    }));
    expect(deps.createSessionForUserId).toHaveBeenCalledTimes(1);
    expect(deps.createSessionForUserId).toHaveBeenCalledWith('user-existing');
  });

  it('creates a first WeChat account atomically and issues only one session', async () => {
    const deps = createDeps();
    deps.claimIdentity.mockResolvedValue({ status: 'created', userId: 'user-new', created: true });
    deps.createSessionForUserId.mockResolvedValue({
      success: true,
      user: { ...existingUser, id: 'user-new', username: 'wx_new' },
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    const service = createWechatIdentityService(deps);

    const result = await service.login({ openId: 'wx-first-login', nickname: '微信同学' });

    expect(result).toMatchObject({ success: true, accessToken: 'new-access' });
    expect(deps.claimIdentity).toHaveBeenCalledWith(expect.objectContaining({
      username: 'wx_st-login_012345',
      nickname: '微信同学',
    }));
    expect(deps.createSessionForUserId).toHaveBeenCalledTimes(1);
    expect(deps.createSessionForUserId).toHaveBeenCalledWith('user-new');
  });

  it('refuses to bind a WeChat identity owned by another account', async () => {
    const deps = createDeps();
    deps.claimIdentity.mockResolvedValue({
      status: 'owned-by-other',
      userId: 'other-user',
      created: false,
    });
    const service = createWechatIdentityService(deps);

    const result = await service.bind({ userId: 'current-user', openId: 'wx-open-id' });

    expect(result).toEqual({ success: false, error: '该微信已绑定其他账户' });
    expect(deps.createSessionForUserId).not.toHaveBeenCalled();
  });

  it('binds an unclaimed WeChat identity to the current account', async () => {
    const deps = createDeps();
    deps.claimIdentity.mockResolvedValue({
      status: 'owned-by-target',
      userId: 'current-user',
      created: false,
    });
    const service = createWechatIdentityService(deps);

    const result = await service.bind({ userId: 'current-user', openId: 'wx-open-id' });

    expect(result).toEqual({ success: true });
    expect(deps.claimIdentity).toHaveBeenCalledWith(expect.objectContaining({
      targetUserId: 'current-user',
      openId: 'wx-open-id',
    }));
    expect(deps.resolveWechatWorkspace).toHaveBeenCalledWith('wx-open-id');
    expect(deps.syncWechatInboxArtifactsForOpenId).toHaveBeenCalledWith('wx-open-id');
  });
});
