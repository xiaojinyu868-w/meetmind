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
import { randomBytes } from 'crypto';
import prisma from '@/lib/prisma';
import { wechatAuthService } from '@/lib/services/wechat-auth-service';
import { authService } from '@/lib/services/auth-service';
import workspaceService from '@/lib/services/workspace-service';
import workspaceContextService from '@/lib/services/workspace-context-service';
import { createWechatWebSession, consumeWechatWebSession } from '@/lib/services/wechat-web-session-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('wechat/bind/callback');


// state → linkToken 映射（传递 capture token 到回调）
const stateStore = new Map<string, { linkToken: string; expiresAt: number }>();

/**
 * 清理过期条目
 */
function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of stateStore) {
    if (v.expiresAt < now) stateStore.delete(k);
  }
}

/**
 * 生成微信授权 URL 并记住 linkToken
 * 
 * 前端调用: GET /api/wechat/bind/callback?action=authorize&linkToken=xxx
 */
function handleAuthorize(request: NextRequest): NextResponse {
  cleanExpired();

  const { searchParams } = new URL(request.url);
  const linkToken = searchParams.get('linkToken') || '';

  if (!wechatAuthService.isConfigured()) {
    return NextResponse.json(
      { success: false, error: '微信登录未配置，请等待服务号认证完成' },
      { status: 503 }
    );
  }

  // 构造回调 URL — 指向本路由自身
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  const callbackUrl = `${protocol}://${host}/api/wechat/bind/callback`;

  // 生成授权 URL（优先走静默授权，确保服务号网页授权可稳定返回 openId）
  const authUrl = wechatAuthService.getAuthUrl(callbackUrl, 'snsapi_base');

  // 从 authUrl 中提取 state 参数
  const authUrlObj = new URL(authUrl.replace('#wechat_redirect', ''));
  const state = authUrlObj.searchParams.get('state') || '';

  // 记住 state → linkToken 映射
  if (state && linkToken) {
    stateStore.set(state, {
      linkToken,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
  }

  return NextResponse.json({ success: true, authUrl });
}

/**
 * 微信回调处理
 * 
 * GET /api/wechat/bind/callback?code=xxx&state=xxx
 */
async function handleCallback(request: NextRequest): Promise<NextResponse> {
  cleanExpired();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const baseUrl = `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host') || request.headers.get('host')}`;

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing_params`);
  }

  // 找回 linkToken
  const stateData = stateStore.get(state);
  const linkToken = stateData?.linkToken || '';
  if (stateData) stateStore.delete(state);

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

    // 查找已绑定的用户
    const user = await authService.findUserByProvider('wechat', openId);
    let loginResult;

    if (user) {
      // 已绑定，更新 token 后直接为原账号签发会话，避免误走验证码登录逻辑
      await authService.linkAuthProvider(user.id, 'wechat', {
        providerId: openId,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
        metadata: {
          unionid: wechatUser?.unionid,
          nickname,
          headimgurl: wechatUser?.headimgurl,
        },
      });

      loginResult = await authService.createSessionForUserId(user.id);
    } else {
      // 新用户，自动注册
      // 生成满足密码强度要求的随机密码（至少含大小写字母和数字）
      const randomPart = randomBytes(16).toString('hex');
      const safePassword = `Wx${randomPart}9`;
      const username = `wx_${openId.slice(-8)}_${Date.now().toString(36)}`;
      const registerResult = await authService.register({
        username,
        password: safePassword,
        nickname,
        role: 'student',
      });

      if (!registerResult.success || !registerResult.user) {
        const errorUrl = linkToken
          ? `${baseUrl}/wechat/capture/${linkToken}?error=${encodeURIComponent('创建账号失败')}`
          : `${baseUrl}/login?error=register_failed`;
        return NextResponse.redirect(errorUrl);
      }

      // 绑定微信
      await authService.linkAuthProvider(registerResult.user.id, 'wechat', {
        providerId: openId,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
        metadata: {
          unionid: wechatUser?.unionid || tokenResponse.unionid,
          nickname,
          headimgurl: wechatUser?.headimgurl,
        },
      });

      if (wechatUser?.headimgurl) {
        await authService.updateProfile(registerResult.user.id, {
          avatar: wechatUser.headimgurl,
          nickname,
        });
      }

      loginResult = await authService.createSessionForUserId(registerResult.user.id);
    }

    if (!loginResult?.success || !loginResult.accessToken) {
      const errorUrl = linkToken
        ? `${baseUrl}/wechat/capture/${linkToken}?error=${encodeURIComponent('登录失败')}`
        : `${baseUrl}/login?error=login_failed`;
      return NextResponse.redirect(errorUrl);
    }

    // 同步工作区
    await workspaceService.resolveWechatWorkspace(openId);
    await workspaceContextService.syncWechatInboxArtifactsForOpenId(openId);
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
  cleanExpired();

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
