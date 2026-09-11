/**
 * GET /api/auth/zhihu/callback —— 知乎授权后回来的地方（顶层导航，没有 Bearer）。
 *
 * 全部判断在 zhihu-auth-service.completeZhihuOAuth；这里只做三件事：
 * 1. 把 outcome 变成 302：绑定成功 → next?zhihu=connected；登录成功 → next?session=<临时会话>&zhihu=connected|created
 *    （复用微信登录的临时会话交换：useAuth 在任何页面看到 ?session= 都会去 POST /api/auth/wechat/callback 换 accessToken，
 *    前端零改动）；失败 → next?zhihu_error=<code>
 * 2. 登录成功时同微信一样把 refreshToken 放 HttpOnly cookie
 * 3. 清掉一次性 oauth cookie
 * 不在 URL 或日志里出现 authorization_code / access_token。
 */

import { NextRequest, NextResponse } from 'next/server';
import { completeZhihuOAuth, ZHIHU_OAUTH_COOKIE } from '@/lib/services/zhihu/zhihu-auth-service';
import { createWechatWebSession } from '@/lib/services/wechat-web-session-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth/zhihu/callback');

function resolveBaseUrl(request: NextRequest): string {
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  return `${protocol}://${host}`;
}

export async function GET(request: NextRequest) {
  const baseUrl = resolveBaseUrl(request);
  const outcome = await completeZhihuOAuth({
    cookieValue: request.cookies.get(ZHIHU_OAUTH_COOKIE)?.value,
    params: request.nextUrl.searchParams,
  });

  const target = new URL(outcome.next, baseUrl);
  let refreshToken: string | undefined;

  if (outcome.kind === 'error') {
    log.warn('zhihu oauth failed', { code: outcome.code });
    target.searchParams.set('zhihu_error', outcome.code);
  } else if (outcome.kind === 'bound') {
    target.searchParams.set('zhihu', 'connected');
  } else {
    const sessionToken = createWechatWebSession({
      accessToken: outcome.session.accessToken,
      refreshToken: outcome.session.refreshToken,
      nickname: outcome.session.nickname,
    });
    refreshToken = outcome.session.refreshToken;
    target.searchParams.set('session', sessionToken);
    target.searchParams.set('zhihu', outcome.created ? 'created' : 'connected');
  }

  const response = NextResponse.redirect(target);
  response.cookies.set(ZHIHU_OAUTH_COOKIE, '', { maxAge: 0, path: '/api/auth/zhihu' });
  if (refreshToken) {
    response.cookies.set('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
  }
  return response;
}
