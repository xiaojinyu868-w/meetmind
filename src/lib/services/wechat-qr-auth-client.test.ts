import { describe, expect, it, vi } from 'vitest';
import {
  createWechatQrChallenge,
  pollWechatQrChallenge,
} from './wechat-qr-auth-client';

describe('wechat QR auth client', () => {
  it('creates a login challenge with first-party credentials', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      challengeId: 'challenge-1',
      imageUrl: 'https://mp.weixin.qq.com/qr',
      expiresAt: '2026-07-17T00:05:00.000Z',
      expiresIn: 300,
    }), { status: 200 }));

    const result = await createWechatQrChallenge({
      mode: 'login',
      fetchFn: fetchFn as typeof fetch,
    });

    expect(result.challengeId).toBe('challenge-1');
    expect(fetchFn).toHaveBeenCalledWith('/api/auth/wechat/qr', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'login' }),
    });
  });

  it('sends the current access token only when binding', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      challengeId: 'challenge-1',
      imageUrl: 'https://mp.weixin.qq.com/qr',
      expiresAt: '2026-07-17T00:05:00.000Z',
      expiresIn: 300,
    }), { status: 200 }));

    await createWechatQrChallenge({
      mode: 'bind',
      accessToken: 'access-token',
      fetchFn: fetchFn as typeof fetch,
    });

    expect(fetchFn).toHaveBeenCalledWith('/api/auth/wechat/qr', expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer access-token',
      },
    }));
  });

  it('returns the server polling status without hiding terminal errors', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      status: 'expired',
      error: '二维码已过期',
    }), { status: 410 }));

    const result = await pollWechatQrChallenge({
      challengeId: 'challenge-1',
      fetchFn: fetchFn as typeof fetch,
    });

    expect(result).toEqual({
      success: false,
      status: 'expired',
      error: '二维码已过期',
    });
    expect(fetchFn).toHaveBeenCalledWith('/api/auth/wechat/qr?id=challenge-1', {
      credentials: 'include',
      cache: 'no-store',
    });
  });
});
