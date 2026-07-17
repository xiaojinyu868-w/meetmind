/**
 * 微信 OAuth 回调（Capture 绑定场景）
 * 
 * GET /api/wechat/bind/callback?code=xxx&state=xxx
 * 
 * 流程：
 * 1. 微信授权后携带 code + state 回调到此地址
 * 2. 用 code 换取 access_token + openId
 * 3. 查找或创建用户（自动注册）
 * 4. 绑定 openId → 用户
 * 5. 同步收集流
 * 6. 重定向回 /wechat/capture/[token]?session=xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { wechatAuthService } from '@/lib/services/wechat-auth-service';
import { wechatIdentityService } from '@/lib/services/wechat-identity-service';
import { checkRateLimit, getIdentifier } from '@/lib/services/rate-limit-service';
import { wechatOauthStateService } from '@/lib/services/wechat-oauth-state-service';
import workspaceContextService from '@/lib/services/workspace-context-service';
import { createWechatWebSession, consumeWechatWebSession } from '@/lib/services/wechat-web-session-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('wechat/bind/callback');


/**
 * 生成微信授权 URL 并记住 linkToken
 * 
 * 前端调用: GET /api/wechat/bind/callback?action=authorize&linkToken=xxx
 */
async function handleAuthorize(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const linkToken = searchParams.get('linkToken')?.trim() || '';

  if (!wechatAuthService.isConfigured()) {
    return NextResponse.json(
      { success: false, error: '微信登录未配置，请等待服务号认证完成' },
      { status: 503 }
    );
  }
  if (!/^[a-zA-Z0-9_-]{32,160}$/.test(linkToken)) {
    return NextResponse.json({ success: false, error: '微信收集凭证无效' }, { status: 400 });
  }
  const [message, networkLimit, tokenLimit] = await Promise.all([
    prisma.wechatInboxMessage.findUnique({ where: { linkToken }, select: { id: true } }),
    checkRateLimit(getIdentifier(request), 'wechatQr'),
    checkRateLimit(`wechat-oauth:${linkToken}`, 'wechatQr'),
  ]);
  if (!message) {
    return NextResponse.json({ success: false, error: '微信收集凭证无效' }, { status: 404 });
  }
  if (!networkLimit.allowed || !tokenLimit.allowed) {
    return NextResponse.json({ success: false, error: '请求太频繁，请稍后再试' }, { status: 429 });
  }

  // 构造回调 URL — 指向本路由自身
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  const callbackUrl = `${protocol}://${host}/api/wechat/bind/callback`;

  // 生成持久化一次性 state；多实例部署也能在回调时原子消费。
  const state = await wechatOauthStateService.create(linkToken || undefined);
  const authUrl = wechatAuthService.getAuthUrl(callbackUrl, 'snsapi_base', state);
  return NextResponse.json({ success: true, authUrl });
}

/**
 * 微信回调处理
 * 
 * GET /api/wechat/bind/callback?code=xxx&state=xxx
 */
async function handleCallback(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const baseUrl = `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host') || request.headers.get('host')}`;

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing_params`);
  }

  const consumedState = await wechatOauthStateService.consume(state);
  if (!consumedState) {
    return NextResponse.redirect(`${baseUrl}/login?error=invalid_state`);
  }
  const linkToken = consumedState.linkToken || '';

  try {
    // 用 code 换 access_token
    const tokenResponse = await wechatAuthService.getAccessToken(code);
    if (!tokenResponse) {
      const errorUrl = linkToken
        ? `${baseUrl}/wechat/capture/${linkToken}?error=${encodeURIComponent('微信授权失败')}`
        : `${baseUrl}/login?error=wechat_auth_failed`;
      return NextResponse.redirect(errorUrl);
    }

    const openId = tokenResponse.openid;

    // 仅在具备 snsapi_userinfo 时再拉用户详情，静默授权下直接用 openId 继续绑定/登录
    const wechatUser = String(tokenResponse.scope || '')
      .split(',')
      .map((item) => item.trim())
      .includes('snsapi_userinfo')
      ? await wechatAuthService.getUserInfo(tokenResponse.access_token, openId)
      : null;
    const nickname = wechatUser?.nickname || '微信用户';
    const loginResult = await wechatIdentityService.login({
      openId,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
      unionid: wechatUser?.unionid || tokenResponse.unionid,
      nickname,
      headimgurl: wechatUser?.headimgurl,
    });

    if (!loginResult.success || !loginResult.accessToken) {
      const errorUrl = linkToken
        ? `${baseUrl}/wechat/capture/${linkToken}?error=${encodeURIComponent('登录失败')}`
        : `${baseUrl}/login?error=login_failed`;
      return NextResponse.redirect(errorUrl);
    }

    // 统一身份服务已同步 openId 归属；这里只补当前 capture 的专属产物。
    if (linkToken) {
      await workspaceContextService.syncWechatInboxMessageArtifacts(linkToken);
    }

    // 更新 WechatInboxMessage 的绑定状态
    if (linkToken) {
      await prisma.wechatInboxMessage.updateMany({
        where: { openId },
        data: { bindingStatus: 'bound' },
      });
    }

    // 生成临时 session token，安全传递到前端
    const sessionToken = createWechatWebSession({
      accessToken: loginResult.accessToken!,
      refreshToken: loginResult.refreshToken,
      nickname,
    });

    // 绑定完成后直接跳到主流 /app
    // 注意：不加 mobile=1，微信内浏览器 useResponsive() 自然检测为移动端，
    // mobile=1 会在桌面端触发手机模拟外壳，体验很差。
    const redirectUrl = linkToken
      ? `${baseUrl}/app?wechat_capture=${linkToken}&session=${sessionToken}`
      : `${baseUrl}/app?session=${sessionToken}`;

    const response = NextResponse.redirect(redirectUrl);

    if (loginResult.refreshToken) {
      response.cookies.set('refreshToken', loginResult.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      });
    }

    return response;
  } catch (error) {
    log.error('[wechat bind callback] error:', error);
    const errorUrl = linkToken
      ? `${baseUrl}/wechat/capture/${linkToken}?error=${encodeURIComponent('绑定失败，请重试')}`
      : `${baseUrl}/login?error=server_error`;
    return NextResponse.redirect(errorUrl);
  }
}

/**
 * 交换临时 session 获取 accessToken（前端调用）
 * 
 * POST /api/wechat/bind/callback { sessionToken: "xxx" }
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionToken } = await request.json();

    if (!sessionToken) {
      return NextResponse.json({ success: false, error: '缺少 session' }, { status: 400 });
    }

    const session = consumeWechatWebSession(sessionToken);
    if (!session) {
      return NextResponse.json({ success: false, error: '会话已过期' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      nickname: session.nickname,
    });
  } catch {
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'authorize') {
    return handleAuthorize(request);
  }

  // 默认：微信回调处理
  return handleCallback(request);
}
