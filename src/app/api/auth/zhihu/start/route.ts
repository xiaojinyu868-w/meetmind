/**
 * GET /api/auth/zhihu/start —— 发起知乎 OAuth。
 *
 * 前端用 fetch（可带 Bearer）调它拿到 `{ url }` 再跳转：带 Bearer 时是「把知乎绑到当前账号」，
 * 不带时是「用知乎登录」。一次性 nonce（+ 绑定用户 + 回跳路径）签进 HttpOnly cookie，
 * 回调用它对账——知乎回调实测不回传 state，CSRF 靠这个 cookie。
 *
 * ?next=/apps/zhihu 指定授权完成后的站内回跳路径（只接受站内绝对路径）；?redirect=1 直接 302 到授权页（纯链接场景，不能绑定）。
 * ZHIHU_ENABLED 未开或凭证没配齐 → 503，不暴露缺哪一项。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/utils/rate-limit';
import { beginZhihuOAuth } from '@/lib/services/zhihu/zhihu-auth-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth/zhihu/start');

export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  const next = request.nextUrl.searchParams.get('next');
  const wantsRedirect = request.nextUrl.searchParams.get('redirect') === '1';

  let started: ReturnType<typeof beginZhihuOAuth>;
  try {
    started = beginZhihuOAuth({ userId, next });
  } catch (error) {
    log.warn('zhihu oauth not available', { message: (error as Error)?.message });
    return NextResponse.json({ success: false, error: 'zhihu_login_unavailable' }, { status: 503 });
  }

  const response = wantsRedirect
    ? NextResponse.redirect(started.url)
    : NextResponse.json({ success: true, url: started.url, mode: userId ? 'bind' : 'login' });
  response.cookies.set(started.cookie.name, started.cookie.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // 知乎回调是顶层 GET 导航，Lax 会带上
    maxAge: started.cookie.maxAgeSeconds,
    path: '/api/auth/zhihu',
  });
  return response;
}
