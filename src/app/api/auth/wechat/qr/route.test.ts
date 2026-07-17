import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  createChallenge: vi.fn(async () => ({
    challengeId: 'challenge-1',
    imageUrl: 'https://mp.weixin.qq.com/qr',
    expiresIn: 300,
    expiresAt: '2026-07-17T00:05:00.000Z',
  })),
  poll: vi.fn(async () => ({ status: 'pending' as const })),
  verifyToken: vi.fn(() => null),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getIdentifier: vi.fn(() => 'ip:test'),
}));

vi.mock('@/lib/services/auth-service', () => ({
  authService: { verifyToken: mocks.verifyToken },
}));
vi.mock('@/lib/services/rate-limit-service', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getIdentifier: mocks.getIdentifier,
}));
vi.mock('@/lib/services/wechat-qr-auth-runtime', () => ({
  isWechatQrAuthConfigured: mocks.configured,
  wechatQrAuthRuntime: {
    createChallenge: mocks.createChallenge,
    poll: mocks.poll,
  },
}));

import { GET, POST } from './route';

function postRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/auth/wechat/qr', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('/api/auth/wechat/qr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.verifyToken.mockReturnValue(null);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.poll.mockResolvedValue({ status: 'pending' });
  });

  it('creates a no-store browser-bound challenge with hardened cookie attributes', async () => {
    const response = await POST(postRequest({ mode: 'login' }));
    const payload = await response.json();
    const cookie = response.headers.get('set-cookie') || '';

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, challengeId: 'challenge-1' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(cookie).toContain('meetmind_wechat_qr_browser=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain('Max-Age=1200');
    expect(mocks.checkRateLimit).toHaveBeenCalledTimes(2);
  });

  it('requires a valid account before creating a bind challenge', async () => {
    const response = await POST(postRequest({ mode: 'bind' }));

    expect(response.status).toBe(401);
    expect(mocks.createChallenge).not.toHaveBeenCalled();
  });

  it('rejects QR creation when either public limit is exhausted', async () => {
    mocks.checkRateLimit
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValueOnce({ allowed: true });

    const response = await POST(postRequest({ mode: 'login' }));

    expect(response.status).toBe(429);
    expect(mocks.createChallenge).not.toHaveBeenCalled();
  });

  it('limits public polling before reading the challenge store', async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false });
    const request = new NextRequest('http://localhost/api/auth/wechat/qr?id=random-id');

    const response = await GET(request);

    expect(response.status).toBe(429);
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  it('returns the access token once and keeps the refresh token in HttpOnly cookie', async () => {
    mocks.poll.mockResolvedValue({
      status: 'authenticated',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      nickname: '微信用户',
    });
    const request = new NextRequest('http://localhost/api/auth/wechat/qr?id=challenge-1', {
      headers: { cookie: 'meetmind_wechat_qr_browser=browser-secret' },
    });

    const response = await GET(request);
    const payload = await response.json();
    const cookie = response.headers.get('set-cookie') || '';

    expect(payload).toEqual({
      success: true,
      status: 'authenticated',
      accessToken: 'access-token',
      nickname: '微信用户',
    });
    expect(JSON.stringify(payload)).not.toContain('refresh-token');
    expect(cookie).toContain('refreshToken=refresh-token');
    expect(cookie).toContain('HttpOnly');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
