/**
 * 知乎 OAuth 登录 / 绑定（server-only）。
 *
 * 知乎的 Authorization Code 流程有两个协议缺口，这里各补一处：
 * 1. 回调实测不回传 `state` → CSRF 不指望它。发起时把一次性 nonce（+ 要绑定的用户 + 回跳路径）签进一个
 *    HttpOnly cookie，回调用 cookie 对账：同一个浏览器发起、同一个浏览器回来，才算一次授权。回传了 state 就顺带比对。
 * 2. token 只有 3600 秒且没有 refresh → 存进 AuthProvider.expiresAt，过期就如实说「重新连接知乎」，不静默降级。
 *
 * 两种结果：已登录用户 = 绑定（把知乎身份挂到当前账号）；未登录 = 用知乎登录（找到已绑定的用户或新建一个）。
 * 稳定身份来自 `/user` 里主页链接的 url_token；知乎不给稳定身份时只允许绑定，不允许凭它登录（否则每次都是新用户）。
 *
 * 不改 schema：nonce 走 cookie，token 存现有 AuthProvider(provider='zhihu')。
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import prisma from '@/lib/prisma';
import { authService } from '@/lib/services/auth-service';
import { workspaceService } from '@/lib/services/workspace-service';
import { AuthConfig } from '@/lib/config/app.config';
import { getZhihuConfig, isZhihuOAuthReady, type ZhihuConfig } from '@/lib/config/zhihu.config';
import { createLogger } from '@/lib/logger';
import { getZhihuOpenClient, ZhihuApiError, type ZhihuOAuthProfile, type ZhihuOAuthToken, type ZhihuOpenClient } from './zhihu-open-client';

const log = createLogger('zhihu-auth');

export const ZHIHU_OAUTH_COOKIE = 'mm_zhihu_oauth';
export const ZHIHU_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const ZHIHU_DEFAULT_NEXT = '/apps/zhihu';
export const ZHIHU_PROVIDER = 'zhihu' as const;

/** 签进 cookie 的一次性状态：n = nonce（也作 state 发给知乎）；u = 要绑定的已登录用户；r = 回跳路径；e = 过期 ms */
export interface ZhihuOAuthState {
  v: 1;
  n: string;
  u?: string;
  r: string;
  e: number;
}

export type ZhihuOAuthErrorCode =
  | 'not_configured'
  | 'state_missing'
  | 'state_invalid'
  | 'state_expired'
  | 'state_mismatch'
  | 'state_not_returned'
  | 'code_missing'
  | 'exchange_failed'
  | 'identity_unavailable'
  | 'user_unavailable';

export type ZhihuOAuthOutcome =
  | { kind: 'bound'; userId: string; next: string; profile: ZhihuOAuthProfile | null }
  | { kind: 'logged_in'; next: string; created: boolean; session: { accessToken: string; refreshToken?: string; nickname: string } }
  | { kind: 'error'; code: ZhihuOAuthErrorCode; next: string };

// ---------------------------------------------------------------------------
// 纯函数：回跳路径 / 状态签名 / 身份推导
// ---------------------------------------------------------------------------

/** 只接受站内绝对路径（防开放重定向）：以单个 / 开头、不含协议或反斜杠 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next) return ZHIHU_DEFAULT_NEXT;
  const trimmed = next.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /[\\\r\n]/.test(trimmed) || trimmed.includes('://')) {
    return ZHIHU_DEFAULT_NEXT;
  }
  return trimmed.length > 512 ? ZHIHU_DEFAULT_NEXT : trimmed;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signOAuthState(state: ZhihuOAuthState, secret: string): string {
  if (!secret) throw new Error('zhihu_oauth_state_secret_missing');
  const payload = b64url(JSON.stringify(state));
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifyOAuthState(value: string | null | undefined, secret: string, now: number = Date.now()): { state: ZhihuOAuthState | null; reason?: 'missing' | 'invalid' | 'expired' } {
  if (!value) return { state: null, reason: 'missing' };
  if (!secret) return { state: null, reason: 'invalid' };
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return { state: null, reason: 'invalid' };
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { state: null, reason: 'invalid' };
  let parsed: ZhihuOAuthState;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ZhihuOAuthState;
  } catch {
    return { state: null, reason: 'invalid' };
  }
  if (parsed?.v !== 1 || typeof parsed.n !== 'string' || typeof parsed.r !== 'string' || typeof parsed.e !== 'number') {
    return { state: null, reason: 'invalid' };
  }
  if (parsed.e <= now) return { state: null, reason: 'expired' };
  return { state: parsed };
}

/** 稳定身份 = 主页链接里的 url_token（https://www.zhihu.com/people/<token>）；拿不到就 null */
/**
 * 稳定身份：hash_id（字符串标识）→ uid（int64 无损字符串，前缀 uid:）→ 主页链接里的 url_token / users/<id>。
 * 黑客松版 /user 正式给了 hash_id 与 uid（2026-09 资料），主页 url 形如 openapi.zhihu.com/users/<uid>，不再是 zhihu.com/people/<token>。
 */
export function deriveZhihuProviderId(profile: ZhihuOAuthProfile | null): string | null {
  if (!profile) return null;
  if (profile.hashId) return profile.hashId;
  if (profile.uid) return `uid:${profile.uid}`;
  const url = profile.url;
  if (!url) return null;
  const match = /zhihu\.com\/(?:people|users)\/([^/?#]+)/i.exec(url);
  if (!match) return null;
  const token = decodeURIComponent(match[1]).trim();
  return token ? (/^\d+$/.test(token) ? `uid:${token}` : token) : null;
}

/** 用户名只允许 [a-zA-Z0-9_-]，≤32；知乎 url_token 本身就是这个字符集 */
export function usernameForZhihu(providerId: string): string {
  const cleaned = providerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || randomBytes(4).toString('hex');
  return `zhihu_${cleaned}`;
}

// ---------------------------------------------------------------------------
// 发起
// ---------------------------------------------------------------------------

export interface BeginZhihuOAuthResult {
  url: string;
  cookie: { name: string; value: string; maxAgeSeconds: number };
}

export function beginZhihuOAuth(
  opts: { userId?: string | null; next?: string | null; now?: () => number; client?: ZhihuOpenClient; secret?: string; config?: ZhihuConfig } = {},
): BeginZhihuOAuthResult {
  const config = opts.config ?? getZhihuConfig();
  if (!config.enabled || !isZhihuOAuthReady(config)) {
    throw new ZhihuApiError('oauth', '/authorize', '知乎登录未配置或未开启');
  }
  const now = opts.now ?? (() => Date.now());
  const client = opts.client ?? (opts.config ? undefined : getZhihuOpenClient());
  if (!client) throw new ZhihuApiError('oauth', '/authorize', '缺少知乎客户端');
  const secret = opts.secret ?? AuthConfig.jwt.secret;
  const nonce = randomBytes(24).toString('base64url');
  const state: ZhihuOAuthState = {
    v: 1,
    n: nonce,
    r: sanitizeNextPath(opts.next),
    e: now() + ZHIHU_OAUTH_STATE_TTL_MS,
    ...(opts.userId ? { u: opts.userId } : {}),
  };
  return {
    url: client.buildAuthorizeUrl({ state: nonce }),
    cookie: { name: ZHIHU_OAUTH_COOKIE, value: signOAuthState(state, secret), maxAgeSeconds: Math.floor(ZHIHU_OAUTH_STATE_TTL_MS / 1000) },
  };
}

// ---------------------------------------------------------------------------
// 回调
// ---------------------------------------------------------------------------

export interface ZhihuAuthDeps {
  client: ZhihuOpenClient;
  config: ZhihuConfig;
  secret: string;
  now: () => number;
  findUserByProvider(providerId: string): Promise<{ id: string; status: string } | null>;
  userIsActive(userId: string): Promise<boolean>;
  linkProvider(userId: string, providerId: string, token: ZhihuOAuthToken): Promise<void>;
  createUser(profile: ZhihuOAuthProfile | null, providerId: string): Promise<{ id: string; nickname: string }>;
  createSession(userId: string): Promise<{ success: boolean; accessToken?: string; refreshToken?: string; nickname?: string; error?: string }>;
}

function defaultDeps(): ZhihuAuthDeps {
  return {
    client: getZhihuOpenClient(),
    config: getZhihuConfig(),
    secret: AuthConfig.jwt.secret,
    now: () => Date.now(),
    async findUserByProvider(providerId) {
      const row = await prisma.authProvider.findUnique({
        where: { provider_providerId: { provider: ZHIHU_PROVIDER, providerId } },
        include: { user: { select: { id: true, status: true } } },
      });
      return row ? { id: row.user.id, status: row.user.status } : null;
    },
    async userIsActive(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
      return user?.status === 'active';
    },
    async linkProvider(userId, providerId, token) {
      await authService.linkAuthProvider(userId, ZHIHU_PROVIDER, {
        providerId,
        accessToken: token.accessToken,
        expiresAt: new Date(token.expiresAt).toISOString(),
      });
    },
    async createUser(profile, providerId) {
      const base = usernameForZhihu(providerId);
      const nickname = (profile?.name ?? '').trim() || '知乎同学';
      let username = base;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const user = await prisma.user.create({
            data: { username, nickname, avatar: profile?.avatarUrl ?? null, status: 'active' },
            select: { id: true, nickname: true },
          });
          await workspaceService.ensureDefaultWorkspace(user.id);
          return user;
        } catch (error) {
          // 用户名撞了（P2002）换个后缀再试；别的错误原样抛
          if ((error as { code?: string })?.code !== 'P2002') throw error;
          username = `${base}_${randomBytes(2).toString('hex')}`;
        }
      }
      throw new Error('zhihu_user_create_failed');
    },
    async createSession(userId) {
      const result = await authService.createSessionForUserId(userId);
      return { success: result.success, accessToken: result.accessToken, refreshToken: result.refreshToken, nickname: result.user?.nickname, error: result.error };
    },
  };
}

/**
 * 处理知乎回调。只读 cookie 与 query，不碰响应——路由层按 outcome 决定 302 去哪、设哪些 cookie。
 * 任何一步失败都返回 error outcome（带回跳路径），不抛；日志不记 code / token。
 */
export async function completeZhihuOAuth(
  input: { cookieValue: string | null | undefined; params: URLSearchParams },
  deps: Partial<ZhihuAuthDeps> = {},
): Promise<ZhihuOAuthOutcome> {
  const d: ZhihuAuthDeps = { ...defaultDeps(), ...deps };
  const config = d.config;
  const verified = verifyOAuthState(input.cookieValue, d.secret, d.now());
  const next = verified.state?.r ?? ZHIHU_DEFAULT_NEXT;

  if (!config.enabled || !isZhihuOAuthReady(config)) return { kind: 'error', code: 'not_configured', next };
  if (!verified.state) {
    const code: ZhihuOAuthErrorCode = verified.reason === 'missing' ? 'state_missing' : verified.reason === 'expired' ? 'state_expired' : 'state_invalid';
    return { kind: 'error', code, next };
  }
  const state = verified.state;

  // state：0.7.2 参考文档说黑客松 OAuth 服务会原样透传，官方 Hello World 却仍按"可能不回传"处理。CSRF 绑定靠的是签过名、
  // 绑定到这个浏览器的 cookie（上面已经校验），所以这里：回传了必须等于 cookie 里的 nonce；没回传只记日志不拦——第一次真实授权后看日志定稿
  const returnedState = input.params.get('state');
  if (returnedState && returnedState !== state.n) return { kind: 'error', code: 'state_mismatch', next };
  if (!returnedState) log.warn('zhihu-auth: callback without state (cookie binding only)');

  const code = d.client.extractAuthorizationCode(input.params);
  if (!code) return { kind: 'error', code: 'code_missing', next };

  let token: ZhihuOAuthToken;
  try {
    token = await d.client.exchangeAuthorizationCode(code);
  } catch (error) {
    log.warn('zhihu-auth: exchange failed', { kind: (error as ZhihuApiError)?.kind, status: (error as ZhihuApiError)?.status });
    return { kind: 'error', code: 'exchange_failed', next };
  }

  const profile = await d.client.fetchOAuthProfile(token.accessToken);
  const derived = deriveZhihuProviderId(profile);

  // 绑定：当前登录用户挂上知乎身份；知乎没给稳定身份时用 bind:<userId> 占位（同一用户重复绑定会覆盖，不会分裂）
  if (state.u) {
    if (!(await d.userIsActive(state.u))) return { kind: 'error', code: 'user_unavailable', next };
    const providerId = derived ?? `bind:${state.u}`;
    await d.linkProvider(state.u, providerId, token);
    log.info('zhihu-auth: bound', { userId: state.u, stableIdentity: Boolean(derived) });
    return { kind: 'bound', userId: state.u, next, profile };
  }

  // 登录：没有稳定身份就不能凭知乎登录——否则每次授权都会长出一个新用户
  if (!derived) return { kind: 'error', code: 'identity_unavailable', next };

  const existing = await d.findUserByProvider(derived);
  let userId: string;
  let created = false;
  if (existing) {
    if (existing.status !== 'active') return { kind: 'error', code: 'user_unavailable', next };
    userId = existing.id;
  } else {
    const user = await d.createUser(profile, derived);
    userId = user.id;
    created = true;
  }
  await d.linkProvider(userId, derived, token);

  const session = await d.createSession(userId);
  if (!session.success || !session.accessToken) {
    log.warn('zhihu-auth: session create failed', { userId, error: session.error });
    return { kind: 'error', code: 'user_unavailable', next };
  }
  log.info('zhihu-auth: logged in', { userId, created });
  return {
    kind: 'logged_in',
    next,
    created,
    session: { accessToken: session.accessToken, refreshToken: session.refreshToken, nickname: session.nickname ?? profile?.name ?? '' },
  };
}

// ---------------------------------------------------------------------------
// 给导入层用：这个 MeetMind 用户的知乎身份
// ---------------------------------------------------------------------------

export interface ZhihuIdentityForUser {
  providerId: string;
  oauthToken: string;
  expiresAt: Date | null;
  /** token 已过或没有过期时间信息按已过处理——知乎无 refresh，过期只能重新授权 */
  expired: boolean;
}

export async function getZhihuIdentityForUser(userId: string, now: number = Date.now()): Promise<ZhihuIdentityForUser | null> {
  const row = await prisma.authProvider.findFirst({
    where: { userId, provider: ZHIHU_PROVIDER },
    orderBy: { updatedAt: 'desc' },
    select: { providerId: true, accessToken: true, expiresAt: true },
  });
  if (!row?.accessToken) return null;
  const expired = !row.expiresAt || row.expiresAt.getTime() <= now;
  return { providerId: row.providerId, oauthToken: row.accessToken, expiresAt: row.expiresAt, expired };
}

export async function unlinkZhihu(userId: string): Promise<number> {
  const result = await prisma.authProvider.deleteMany({ where: { userId, provider: ZHIHU_PROVIDER } });
  return result.count;
}
