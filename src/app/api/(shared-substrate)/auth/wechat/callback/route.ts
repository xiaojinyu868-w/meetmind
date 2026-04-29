/**
 * 微信登录回调 API
 * GET /api/auth/wechat/callback
 * 
 * 微信授权后会重定向到此地址，携带 code 和 state 参数
 * 使用临时会话 token 安全传递认证信息
 */

import { NextRequest, NextResponse } from 'next/server';
import { wechatAuthService } from '@/lib/services/wechat-auth-service';
import { createWechatWebSession, consumeWechatWebSession } from '@/lib/services/wechat-web-session-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('auth/wechat/callback');


function resolveBaseUrl(request: NextRequest): string {
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  return `${protocol}://${host}`;
}

export async function GET(request: NextRequest) {
  const baseUrl = resolveBaseUrl(request);

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    
    // 检查参数
    if (!code || !state) {
      log.error('[wechat-callback] 缺少 code 或 state 参数');
      return NextResponse.redirect(`${baseUrl}/login?error=missing_params`);
    }
    
    // 处理微信登录
    const result = await wechatAuthService.login(code, state);
    
    if (!result.success) {
      log.error(`[wechat-callback] 登录失败: ${result.error}`);
      const errorMsg = encodeURIComponent(result.error || '登录失败');
      return NextResponse.redirect(`${baseUrl}/login?error=${errorMsg}`);
    }
    
    // 登录成功，使用共享 session 服务创建临时会话
    const sessionToken = createWechatWebSession({
      accessToken: result.accessToken!,
      refreshToken: result.refreshToken,
      nickname: result.user?.nickname || '',
    });
    
    // 重定向到登录页，由 useAuth 消费 session 后再进入 /app
    const redirectUrl = new URL('/login', baseUrl);
    redirectUrl.searchParams.set('session', sessionToken);
    
    const response = NextResponse.redirect(redirectUrl);
    
    // 设置 refreshToken 到 HTTP-only cookie
    if (result.refreshToken) {
      response.cookies.set('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      });
    }
    
    return response;
  } catch (error) {
    log.error('微信回调错误:', error);
    return NextResponse.redirect(`${baseUrl}/login?error=server_error`);
  }
}

/**
 * 交换临时会话 token 获取 accessToken
 * POST /api/auth/wechat/callback
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionToken } = await request.json();
    
    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: '缺少会话令牌' },
        { status: 400 }
      );
    }
    
    const session = consumeWechatWebSession(sessionToken);

    if (!session) {
      return NextResponse.json(
        { success: false, error: '会话不存在或已过期' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      nickname: session.nickname,
    });
  } catch (error) {
    log.error('会话交换错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
