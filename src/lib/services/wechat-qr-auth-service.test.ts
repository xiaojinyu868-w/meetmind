import { describe, expect, it, vi } from 'vitest';
import type { AuthResponse } from '@/types/user';
import {
  createWechatQrAuthCoordinator,
  extractWechatQrAuthScene,
  hashWechatQrBrowserToken,
  requestWechatOfficialQr,
  type WechatQrChallengeRecord,
  type WechatQrChallengeRepository,
} from './wechat-qr-auth-service';

const now = new Date('2026-07-17T00:00:00.000Z');

function challenge(overrides: Partial<WechatQrChallengeRecord> = {}): WechatQrChallengeRecord {
  return {
    id: 'challenge-1',
    scene: 'mm_auth_scene-1',
    mode: 'login',
    browserTokenHash: hashWechatQrBrowserToken('browser-secret'),
    targetUserId: null,
    status: 'pending',
    imageUrl: 'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=ticket',
    openId: null,
    resultUserId: null,
    error: null,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    scannedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function createRepository(record: WechatQrChallengeRecord): WechatQrChallengeRepository {
  return {
    create: vi.fn(async () => record),
    findById: vi.fn(async () => record),
    findByScene: vi.fn(async () => record),
    findReusable: vi.fn(async () => null),
    markScanned: vi.fn(async () => true),
    claimForProcessing: vi.fn(async () => true),
    markConsumed: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
    markExpired: vi.fn(async () => true),
    deleteStale: vi.fn(async () => 0),
  };
}

function createCoordinator(record: WechatQrChallengeRecord) {
  const repository = createRepository(record);
  const authResult: AuthResponse = {
    success: true,
    user: {
      id: 'user-1',
      username: 'wx_user',
      nickname: '微信用户',
      role: 'student',
      status: 'active',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };
  const loginWithOpenId = vi.fn(async () => authResult);
  const bindOpenId = vi.fn(async () => ({ success: true }));
  const createOfficialQr = vi.fn(async () => ({
    imageUrl: record.imageUrl,
    expiresIn: 300,
  }));
  const coordinator = createWechatQrAuthCoordinator({
    repository,
    createOfficialQr,
    loginWithOpenId,
    createSessionForUserId: vi.fn(async () => authResult),
    bindOpenId,
    createScene: () => 'mm_auth_scene-1',
    now: () => now,
  });
  return { coordinator, repository, loginWithOpenId, bindOpenId, createOfficialQr };
}

describe('wechat QR auth event parsing', () => {
  it('accepts both subscribe and SCAN event keys', () => {
    expect(extractWechatQrAuthScene({ MsgType: 'event', Event: 'subscribe', EventKey: 'qrscene_mm_auth_abc' }))
      .toBe('mm_auth_abc');
    expect(extractWechatQrAuthScene({ MsgType: 'event', Event: 'SCAN', EventKey: 'mm_auth_def' }))
      .toBe('mm_auth_def');
  });

  it('ignores ordinary official-account events', () => {
    expect(extractWechatQrAuthScene({ MsgType: 'event', Event: 'subscribe' })).toBeNull();
    expect(extractWechatQrAuthScene({ MsgType: 'text', EventKey: 'mm_auth_abc' })).toBeNull();
    expect(extractWechatQrAuthScene({ MsgType: 'event', Event: 'CLICK', EventKey: 'mm_auth_abc' })).toBeNull();
  });
});

describe('wechat QR auth coordinator', () => {
  it('creates a browser-bound five-minute challenge and cleans stale rows', async () => {
    const record = challenge();
    const { coordinator, repository } = createCoordinator(record);

    const result = await coordinator.createChallenge({ mode: 'login', browserToken: 'browser-secret' });

    expect(result).toMatchObject({ challengeId: 'challenge-1', imageUrl: record.imageUrl, expiresIn: 300 });
    expect(repository.deleteStale).toHaveBeenCalledWith(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      scene: 'mm_auth_scene-1',
      imageUrl: record.imageUrl,
      mode: 'login',
      browserTokenHash: hashWechatQrBrowserToken('browser-secret'),
      targetUserId: null,
      status: 'pending',
    }));
  });

  it('coalesces concurrent creation for the same browser into one WeChat API call', async () => {
    const record = challenge();
    const { coordinator, createOfficialQr } = createCoordinator(record);

    const results = await Promise.all([
      coordinator.createChallenge({ mode: 'login', browserToken: 'browser-secret' }),
      coordinator.createChallenge({ mode: 'login', browserToken: 'browser-secret' }),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(createOfficialQr).toHaveBeenCalledTimes(1);
  });

  it('reuses an active challenge for the same browser and mode', async () => {
    const record = challenge();
    const { coordinator, repository } = createCoordinator(record);
    vi.mocked(repository.findReusable).mockResolvedValue(record);

    const result = await coordinator.createChallenge({ mode: 'login', browserToken: 'browser-secret' });

    expect(result).toMatchObject({ challengeId: record.id, imageUrl: record.imageUrl });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('marks a matching scene as scanned without ingesting it as a capture', async () => {
    const record = challenge();
    const { coordinator, repository } = createCoordinator(record);

    const result = await coordinator.markScanned({ scene: record.scene, openId: 'wx-open-id' });

    expect(result).toEqual({ accepted: true, mode: 'login' });
    expect(repository.markScanned).toHaveBeenCalledWith(record.id, 'wx-open-id', now);
  });

  it('accepts repeated delivery for the same openId after processing has started', async () => {
    const record = challenge({ status: 'consumed', openId: 'wx-open-id', resultUserId: 'user-1' });
    const { coordinator, repository } = createCoordinator(record);

    const result = await coordinator.markScanned({ scene: record.scene, openId: 'wx-open-id' });

    expect(result).toEqual({ accepted: true, mode: 'login' });
    expect(repository.markScanned).not.toHaveBeenCalled();
  });

  it('lets only one concurrent poll execute the login side effect', async () => {
    const record = challenge({ status: 'scanned', openId: 'wx-open-id' });
    const { coordinator, repository, loginWithOpenId } = createCoordinator(record);
    vi.mocked(repository.claimForProcessing)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const results = await Promise.all([
      coordinator.poll({ challengeId: record.id, browserToken: 'browser-secret' }),
      coordinator.poll({ challengeId: record.id, browserToken: 'browser-secret' }),
    ]);

    expect(results).toContainEqual(expect.objectContaining({ status: 'authenticated', accessToken: 'access-token' }));
    expect(results).toContainEqual({ status: 'processing' });
    expect(loginWithOpenId).toHaveBeenCalledTimes(1);
    expect(repository.claimForProcessing).toHaveBeenCalledWith(record.id, now);
    expect(repository.markConsumed).toHaveBeenCalledWith(record.id, 'user-1', now);
  });

  it('binds the scan to the authenticated target account in bind mode', async () => {
    const record = challenge({ mode: 'bind', targetUserId: 'current-user', status: 'scanned', openId: 'wx-open-id' });
    const { coordinator, bindOpenId } = createCoordinator(record);

    const result = await coordinator.poll({ challengeId: record.id, browserToken: 'browser-secret' });

    expect(result).toEqual({ status: 'bound' });
    expect(bindOpenId).toHaveBeenCalledWith('current-user', 'wx-open-id');
  });

  it('does not reveal or consume a challenge from another browser', async () => {
    const record = challenge({ status: 'scanned', openId: 'wx-open-id' });
    const { coordinator, repository, loginWithOpenId } = createCoordinator(record);

    const result = await coordinator.poll({ challengeId: record.id, browserToken: 'wrong-browser' });

    expect(result).toEqual({ status: 'not_found' });
    expect(loginWithOpenId).not.toHaveBeenCalled();
    expect(repository.claimForProcessing).not.toHaveBeenCalled();
  });

  it('recovers a consumed login after the QR itself expires when the response was lost', async () => {
    const record = challenge({
      status: 'consumed',
      resultUserId: 'user-1',
      expiresAt: new Date(now.getTime() - 1),
      consumedAt: new Date(now.getTime() - 60 * 1000),
    });
    const { coordinator, repository } = createCoordinator(record);

    const result = await coordinator.poll({ challengeId: record.id, browserToken: 'browser-secret' });

    expect(result).toMatchObject({ status: 'authenticated', accessToken: 'access-token' });
    expect(repository.markExpired).not.toHaveBeenCalled();
  });

  it('expires only a stale non-terminal challenge', async () => {
    const record = challenge({ expiresAt: new Date(now.getTime() - 1) });
    const { coordinator, repository } = createCoordinator(record);

    const result = await coordinator.poll({ challengeId: record.id, browserToken: 'browser-secret' });

    expect(result).toEqual({ status: 'expired' });
    expect(repository.markExpired).toHaveBeenCalledWith(record.id);
  });

  it('moves a claimed challenge to failed when identity processing throws', async () => {
    const record = challenge({ status: 'scanned', openId: 'wx-open-id' });
    const { coordinator, repository, loginWithOpenId } = createCoordinator(record);
    loginWithOpenId.mockRejectedValue(new Error('database offline'));

    const result = await coordinator.poll({ challengeId: record.id, browserToken: 'browser-secret' });

    expect(result).toEqual({ status: 'failed', error: '这次没有接上，请刷新后重试。' });
    expect(repository.markFailed).toHaveBeenCalledWith(record.id, '这次没有接上，请刷新后重试。');
  });
});

describe('official-account QR request', () => {
  it('requests a temporary string scene and returns the official image URL', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      ticket: 'ticket/with+symbols',
      expire_seconds: 300,
    }), { status: 200 }));

    const result = await requestWechatOfficialQr({
      accessToken: 'mp-access-token',
      scene: 'mm_auth_scene-1',
      expiresIn: 300,
      fetchFn: fetchFn as typeof fetch,
    });

    expect(result.imageUrl).toBe('https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=ticket%2Fwith%2Bsymbols');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=mp-access-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          expire_seconds: 300,
          action_name: 'QR_STR_SCENE',
          action_info: { scene: { scene_str: 'mm_auth_scene-1' } },
        }),
      }),
    );
  });
});
