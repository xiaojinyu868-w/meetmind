/**
 * 微信登录 API
 * GET /api/auth/wechat - 获取微信授权 URL
 * POST /api/auth/wechat - 处理微信登录
 * 
 * 当前仅支持微信公众号（服务号）OAuth：
 * - 微信内浏览器 → oauth2/authorize + snsapi_userinfo
 * - 非微信浏览器 → 返回 wechatOnly 标记，前端引导用户在微信中打开
 * 
 * 注意：PC 扫码登录（qrconnect + snsapi_login）需要微信开放平台的独立 AppID，
 * 公众号 AppID 不支持该接口。未配置开放平台 AppID 时不走 qrconnect。
 */

import { NextRequest, NextResponse } from 'next/server';
import { wechatAuthService } from '@/lib/services/wechat-auth-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('auth/wechat');


// 微信开放平台 AppID（用于 PC 扫码登录），与公众号 AppID 不同
const WECHAT_OPEN_APP_ID = process.env.WECHAT_OPEN_APP_ID || '';

function resolveWechatRedirectUri(request: NextRequest, explicitRedirectUri?: string | null): string | undefined {
  const fromQuery = explicitRedirectUri?.trim();
  if (fromQuery) return fromQuery;

  const fromEnv = process.env.WECHAT_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return undefined;

  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  return `${protocol}://${host}/api/auth/wechat/callback`;
}

function isWechatBrowser(request: NextRequest): boolean {
  const userAgent = request.headers.get('user-agent') || '';
  return /MicroMessenger/i.test(userAgent);
}

function resolveWechatOauthScope(explicitScope?: string | null): 'snsapi_base' | 'snsapi_userinfo' {
  // 登录场景默认 snsapi_userinfo 以获取用户昵称/头像（需要用户授权确认）
  // 仅在明确指定 snsapi_base 时才用静默授权（如绑定场景只需 openId）
  if (explicitScope === 'snsapi_base') return 'snsapi_base';
  return 'snsapi_userinfo';
}

/**
 * 获取微信授权 URL
 */
export async function GET(request: NextRequest) {
  try {
    // 检查微信配置
    if (!wechatAuthService.isConfigured()) {
      return NextResponse.json(
        { success: false, error: '微信登录未配置' },
        { status: 503 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const redirectUri = resolveWechatRedirectUri(request, searchParams.get('redirect_uri'));
    const inWechat = isWechatBrowser(request);
    const scope = resolveWechatOauthScope(searchParams.get('scope'));
    
    if (inWechat) {
      // 微信内置浏览器 → 公众号网页授权
      const authUrl = wechatAuthService.getAuthUrl(redirectUri, scope);
      return NextResponse.json({ success: true, authUrl });
    }

    // 非微信浏览器 → 检查是否有开放平台 AppID
    if (WECHAT_OPEN_APP_ID) {
      // 有开放平台配置 → PC 扫码登录
      const authUrl = wechatAuthService.getQRConnectUrl(redirectUri);
      return NextResponse.json({ success: true, authUrl });
    }

    // 没有开放平台配置 → 告知前端需要在微信中打开
    return NextResponse.json({
      success: true,
      authUrl: null,
      wechatOnly: true,
      message: '请在微信中打开此页面完成登录',
    });
  } catch (error) {
    log.error('获取微信授权URL错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

/**
 * 处理微信登录（直接传入 code 和 state）
 */
export async function POST(request: NextRequest) {
  try {
    // 检查微信配置
    if (!wechatAuthService.isConfigured()) {
      return NextResponse.json(
        { success: false, error: '微信登录未配置' },
        { status: 503 }
      );
    }
    
    const body = await request.json();
    const { code, state } = body;
    
    if (!code || !state) {
      return NextResponse.json(
        { success: false, error: '缺少授权参数' },
        { status: 400 }
      );
    }
    
    const result = await wechatAuthService.login(code, state);
    
    if (!result.success) {
      return NextResponse.json(result, { status: 401 });
    }
    
    // 设置 HTTP-only cookie
    const response = NextResponse.json(result);
    
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
    log.error('微信登录错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
