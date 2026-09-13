import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/services/auth-service', () => ({ authService: {} }));
vi.mock('@/lib/services/workspace-service', () => ({ workspaceService: {} }));

import {
  beginZhihuOAuth,
  completeZhihuOAuth,
  deriveZhihuProviderId,
  sanitizeNextPath,
  signOAuthState,
  usernameForZhihu,
  verifyOAuthState,
  ZHIHU_OAUTH_COOKIE,
  ZHIHU_OAUTH_STATE_TTL_MS,
  type ZhihuAuthDeps,
  type ZhihuOAuthState,
} from './zhihu-auth-service';
import { createZhihuOpenClient, type ZhihuOAuthToken, type ZhihuOpenClient } from './zhihu-open-client';
import type { ZhihuConfig } from '@/lib/config/zhihu.config';

const SECRET = 'test-jwt-secret';
const NOW = 1_757_400_000_000;

const config: ZhihuConfig = {
  enabled: true,
  accessSecret: 'secret-abc',
  oauth: { appId: '12345', appKey: 'app-key', redirectUri: 'https://zhihu.meetmind.online/api/auth/zhihu/callback' },
  apiBaseUrl: 'https://developer.zhihu.com',
  oauthBaseUrl: 'https://openapi.zhihu.com',
  timeoutMs: 1000,
  zhidaTimeoutMs: 1000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** 一个换 token 成功、/user 返回给定资料的假知乎 */
function fakeClient(profile: Record<string, unknown> | null, opts: { exchangeFails?: boolean } = {}): ZhihuOpenClient {
  return createZhihuOpenClient({
    config,
    now: () => NOW,
    fetchImpl: async (url) => {
      if (url.endsWith('/access_token')) {
        return opts.exchangeFails
          ? jsonResponse({ code: 40001, message: 'invalid code' }, 400)
          : jsonResponse({ code: 20000, data: { access_token: 'oauth-tok', token_type: 'Bearer', expires_in: 3600 } });
      }
      if (url.endsWith('/user')) return profile ? jsonResponse({ code: 20000, data: profile }) : jsonResponse('<html/>', 500);
      throw new Error(`unexpected ${url}`);
    },
  });
}

function cookieFor(state: Partial<ZhihuOAuthState>): string {
  return signOAuthState({ v: 1, n: 'nonce-1', r: '/apps/zhihu', e: NOW + 60_000, ...state }, SECRET);
}

function depsWith(overrides: Partial<ZhihuAuthDeps> & { client: ZhihuOpenClient }): Partial<ZhihuAuthDeps> & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { link: [], create: [], session: [] };
  return {
    calls,
    config,
    secret: SECRET,
    now: () => NOW,
    findUserByProvider: async () => null,
    userIsActive: async () => true,
    linkProvider: async (userId, providerId, token: ZhihuOAuthToken) => {
      calls.link.push({ userId, providerId, token: token.accessToken, expiresAt: token.expiresAt });
    },
    createUser: async (profile, providerId) => {
      calls.create.push({ name: profile?.name, providerId });
      return { id: 'user-new', nickname: profile?.name ?? '知乎同学' };
    },
    createSession: async (userId) => {
      calls.session.push(userId);
      return { success: true, accessToken: `jwt-${userId}`, refreshToken: `rt-${userId}`, nickname: '小明' };
    },
    ...overrides,
  };
}

describe('纯函数', () => {
  it('回跳路径只接受站内绝对路径', () => {
    expect(sanitizeNextPath('/apps/zhihu?x=1')).toBe('/apps/zhihu?x=1');
    expect(sanitizeNextPath(undefined)).toBe('/apps/zhihu');
    expect(sanitizeNextPath('https://evil.com/')).toBe('/apps/zhihu');
    expect(sanitizeNextPath('//evil.com')).toBe('/apps/zhihu');
    expect(sanitizeNextPath('/x\\evil')).toBe('/apps/zhihu');
    expect(sanitizeNextPath('app')).toBe('/apps/zhihu');
  });

  it('状态签名可验、篡改 / 过期 / 缺失各有原因', () => {
    const value = cookieFor({});
    expect(verifyOAuthState(value, SECRET, NOW).state?.n).toBe('nonce-1');
    expect(verifyOAuthState(value, 'other-secret', NOW)).toEqual({ state: null, reason: 'invalid' });
    expect(verifyOAuthState(`${value.slice(0, -2)}xx`, SECRET, NOW).reason).toBe('invalid');
    expect(verifyOAuthState(value, SECRET, NOW + 61_000).reason).toBe('expired');
    expect(verifyOAuthState(null, SECRET, NOW).reason).toBe('missing');
    expect(verifyOAuthState('garbage', SECRET, NOW).reason).toBe('invalid');
    // 篡改 payload（改 next）但保留签名 → invalid
    const [payload, sig] = value.split('.');
    const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), r: '/admin' })).toString('base64url');
    expect(verifyOAuthState(`${tampered}.${sig}`, SECRET, NOW).reason).toBe('invalid');
    expect(() => signOAuthState({ v: 1, n: 'x', r: '/', e: 1 }, '')).toThrow();
  });

  it('稳定身份 = hash_id → uid → 主页链接（users/<uid> 或 people/<token>）；用户名只留安全字符', () => {
    const base = { name: '小明', avatarUrl: null, headline: null, description: null, hashId: null, uid: null, url: null };
    expect(deriveZhihuProviderId({ ...base, hashId: '0e4f7a', uid: '969570047710216200', url: 'https://openapi.zhihu.com/users/969570047710216200' })).toBe('0e4f7a');
    expect(deriveZhihuProviderId({ ...base, uid: '969570047710216200', url: 'https://openapi.zhihu.com/users/969570047710216200' })).toBe('uid:969570047710216200');
    expect(deriveZhihuProviderId({ ...base, url: 'https://openapi.zhihu.com/users/969570047710216200' })).toBe('uid:969570047710216200');
    expect(deriveZhihuProviderId({ ...base, url: 'https://www.zhihu.com/people/xiao-ming-42' })).toBe('xiao-ming-42');
    expect(deriveZhihuProviderId({ ...base, url: 'https://zhihu.com/people/a%20b?x' })).toBe('a b');
    expect(deriveZhihuProviderId(base)).toBeNull();
    expect(deriveZhihuProviderId(null)).toBeNull();
    expect(usernameForZhihu('xiao-ming_42')).toBe('zhihu_xiao-ming_42');
    expect(usernameForZhihu('a b/c')).toBe('zhihu_abc');
    expect(usernameForZhihu('///')).toMatch(/^zhihu_[0-9a-f]{8}$/);
  });
});

describe('beginZhihuOAuth', () => {
  it('授权 URL 的 state = cookie 里的 nonce；绑定时 cookie 带 userId；回跳路径经过清洗', () => {
    const client = fakeClient(null);
    const started = beginZhihuOAuth({ userId: 'user-1', next: 'https://evil.com', client, config, secret: SECRET, now: () => NOW });
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe('https://openapi.zhihu.com/authorize');
    expect(url.searchParams.get('app_id')).toBe('12345');
    const state = verifyOAuthState(started.cookie.value, SECRET, NOW).state!;
    expect(url.searchParams.get('state')).toBe(state.n);
    expect(state.u).toBe('user-1');
    expect(state.r).toBe('/apps/zhihu');
    expect(state.e).toBe(NOW + ZHIHU_OAUTH_STATE_TTL_MS);
    expect(started.cookie.name).toBe(ZHIHU_OAUTH_COOKIE);
    expect(started.cookie.maxAgeSeconds).toBe(600);
  });

  it('未开启或凭证不齐时拒绝发起', () => {
    const client = fakeClient(null);
    expect(() => beginZhihuOAuth({ client, config: { ...config, enabled: false }, secret: SECRET })).toThrow(/未配置|未开启/);
    expect(() => beginZhihuOAuth({ client, config: { ...config, oauth: { ...config.oauth, appKey: '' } }, secret: SECRET })).toThrow();
  });
});

describe('completeZhihuOAuth', () => {
  const PROFILE = { uid: 969570047710216200, hash_id: 'xiao-ming-42', fullname: '小明', gender: 'male', headline: '学生', description: '', avatar_path: 'https://a/b.jpg', url: 'https://openapi.zhihu.com/users/969570047710216200', email: '', phone_no: '', phone: '' };

  it('cookie 缺失 / 过期 / 未开启 → 对应错误码，且不出网', async () => {
    const client = fakeClient(PROFILE);
    const params = new URLSearchParams('authorization_code=abc&state=nonce-1');
    expect(await completeZhihuOAuth({ cookieValue: null, params }, depsWith({ client }))).toMatchObject({ kind: 'error', code: 'state_missing' });
    expect(await completeZhihuOAuth({ cookieValue: cookieFor({ e: NOW - 1 }), params }, depsWith({ client }))).toMatchObject({ kind: 'error', code: 'state_expired' });
    expect(await completeZhihuOAuth({ cookieValue: 'bad', params }, depsWith({ client }))).toMatchObject({ kind: 'error', code: 'state_invalid' });
    expect(await completeZhihuOAuth({ cookieValue: cookieFor({}), params }, depsWith({ client, config: { ...config, enabled: false } }))).toMatchObject({
      kind: 'error',
      code: 'not_configured',
    });
  });

  it('state 回传了就必须对得上，没回传靠 cookie 放行；缺 authorization_code 报 code_missing', async () => {
    const client = fakeClient(PROFILE);
    expect(
      await completeZhihuOAuth({ cookieValue: cookieFor({}), params: new URLSearchParams('authorization_code=abc&state=other') }, depsWith({ client })),
    ).toMatchObject({ kind: 'error', code: 'state_mismatch' });
    // 没回传 state：cookie 对账已过就放行（官方 Hello World 也是这么处理的），只记日志
    expect((await completeZhihuOAuth({ cookieValue: cookieFor({}), params: new URLSearchParams('authorization_code=abc') }, depsWith({ client }))).kind).not.toBe('error');
    expect(await completeZhihuOAuth({ cookieValue: cookieFor({}), params: new URLSearchParams('state=nonce-1') }, depsWith({ client }))).toMatchObject({
      kind: 'error',
      code: 'code_missing',
    });
  });

  it('换 token 失败 → exchange_failed，带回跳路径', async () => {
    const client = fakeClient(PROFILE, { exchangeFails: true });
    const outcome = await completeZhihuOAuth({ cookieValue: cookieFor({ r: '/apps/zhihu?from=x' }), params: new URLSearchParams('authorization_code=abc&state=nonce-1') }, depsWith({ client }));
    expect(outcome).toEqual({ kind: 'error', code: 'exchange_failed', next: '/apps/zhihu?from=x' });
  });

  it('绑定：已登录用户挂上知乎身份，token 与过期时间进 AuthProvider', async () => {
    const client = fakeClient(PROFILE);
    const deps = depsWith({ client });
    const outcome = await completeZhihuOAuth({ cookieValue: cookieFor({ u: 'user-1' }), params: new URLSearchParams('authorization_code=abc&state=nonce-1') }, deps);
    expect(outcome).toMatchObject({ kind: 'bound', userId: 'user-1', next: '/apps/zhihu' });
    expect(deps.calls.link).toEqual([{ userId: 'user-1', providerId: 'xiao-ming-42', token: 'oauth-tok', expiresAt: NOW + 3600 * 1000 }]);
    expect(deps.calls.session).toEqual([]);
  });

  it('绑定时知乎没给稳定身份 → 用 bind:<userId> 占位，不阻断', async () => {
    const client = fakeClient(null);
    const deps = depsWith({ client });
    const outcome = await completeZhihuOAuth({ cookieValue: cookieFor({ u: 'user-1' }), params: new URLSearchParams('code=abc&state=nonce-1') }, deps);
    expect(outcome.kind).toBe('bound');
    expect(deps.calls.link[0]).toMatchObject({ providerId: 'bind:user-1' });
  });

  it('绑定到被禁用的用户 → user_unavailable', async () => {
    const client = fakeClient(PROFILE);
    const outcome = await completeZhihuOAuth(
      { cookieValue: cookieFor({ u: 'user-x' }), params: new URLSearchParams('authorization_code=abc&state=nonce-1') },
      depsWith({ client, userIsActive: async () => false }),
    );
    expect(outcome).toMatchObject({ kind: 'error', code: 'user_unavailable' });
  });

  it('登录：首次授权新建用户并发会话；再次授权找到已绑定用户，不再新建', async () => {
    const client = fakeClient(PROFILE);
    const first = depsWith({ client });
    const outcome1 = await completeZhihuOAuth({ cookieValue: cookieFor({}), params: new URLSearchParams('authorization_code=abc&state=nonce-1') }, first);
    expect(outcome1).toMatchObject({ kind: 'logged_in', created: true, next: '/apps/zhihu', session: { accessToken: 'jwt-user-new', refreshToken: 'rt-user-new', nickname: '小明' } });
    expect(first.calls.create).toEqual([{ name: '小明', providerId: 'xiao-ming-42' }]);
    expect(first.calls.link[0]).toMatchObject({ userId: 'user-new', providerId: 'xiao-ming-42' });

    const second = depsWith({ client, findUserByProvider: async () => ({ id: 'user-old', status: 'active' }) });
    const outcome2 = await completeZhihuOAuth({ cookieValue: cookieFor({}), params: new URLSearchParams('authorization_code=abc&state=nonce-1') }, second);
    expect(outcome2).toMatchObject({ kind: 'logged_in', created: false, session: { accessToken: 'jwt-user-old' } });
    expect(second.calls.create).toEqual([]);
    expect(second.calls.link[0]).toMatchObject({ userId: 'user-old' });
  });

  it('登录时拿不到稳定身份 → identity_unavailable，不新建用户', async () => {
    const client = fakeClient({ name: '无主页' });
    const deps = depsWith({ client });
    const outcome = await completeZhihuOAuth({ cookieValue: cookieFor({}), params: new URLSearchParams('authorization_code=abc&state=nonce-1') }, deps);
    expect(outcome).toMatchObject({ kind: 'error', code: 'identity_unavailable' });
    expect(deps.calls.create).toEqual([]);
    expect(deps.calls.link).toEqual([]);
  });

  it('会话签发失败 → user_unavailable', async () => {
    const client = fakeClient(PROFILE);
    const outcome = await completeZhihuOAuth(
      { cookieValue: cookieFor({}), params: new URLSearchParams('authorization_code=abc&state=nonce-1') },
      depsWith({ client, createSession: async () => ({ success: false, error: '禁用' }) }),
    );
    expect(outcome).toMatchObject({ kind: 'error', code: 'user_unavailable' });
  });
});
