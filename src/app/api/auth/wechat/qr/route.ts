import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { checkRateLimit, getIdentifier } from '@/lib/services/rate-limit-service';
import {
  isWechatQrAuthConfigured,
  wechatQrAuthRuntime,
} from '@/lib/services/wechat-qr-auth-runtime';
import { hashWechatQrBrowserToken, type WechatQrAuthMode } from '@/lib/services/wechat-qr-auth-service';
import { COPY } from '@/lib/ui/copy';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth/wechat/qr');
const BROWSER_COOKIE = 'meetmind_wechat_qr_browser';
const BROWSER_COOKIE_MAX_AGE = 20 * 60;

function getAuthenticatedUserId(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authorization.slice(7))?.sub || null;
}

function setBrowserCookie(response: NextResponse, browserToken: string): void {
  response.cookies.set(BROWSER_COOKIE, browserToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: BROWSER_COOKIE_MAX_AGE,
    path: '/',
  });
}

function jsonResponse(body: Record<string, unknown>, init?: { status?: number }): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: NextRequest) {
  if (!isWechatQrAuthConfigured()) {
    return jsonResponse({ success: false, error: COPY.wechatQr.unavailable }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({})) as {
      mode?: WechatQrAuthMode;
      clientNonce?: string;
    };
    const mode: WechatQrAuthMode = body.mode === 'bind' ? 'bind' : 'login';
    const targetUserId = mode === 'bind' ? getAuthenticatedUserId(request) : null;

    if (mode === 'bind' && !targetUserId) {
      return jsonResponse({ success: false, error: COPY.wechatQr.bindRequiresLogin }, { status: 401 });
    }

    const clientNonce = typeof body.clientNonce === 'string' && /^[a-zA-Z0-9_-]{20,100}$/.test(body.clientNonce)
      ? body.clientNonce
      : null;
    const browserToken = request.cookies.get(BROWSER_COOKIE)?.value
      || clientNonce
      || randomBytes(32).toString('base64url');
    const [networkLimit, browserLimit] = await Promise.all([
      checkRateLimit(getIdentifier(request, targetUserId), 'wechatQr'),
      checkRateLimit(`wechat-qr-browser:${hashWechatQrBrowserToken(browserToken)}`, 'wechatQr'),
    ]);
    if (!networkLimit.allowed || !browserLimit.allowed) {
      return jsonResponse({ success: false, error: COPY.wechatQr.tooManyRequests }, { status: 429 });
    }

    const challenge = await wechatQrAuthRuntime.createChallenge({
      mode,
      browserToken,
      targetUserId: targetUserId || undefined,
    });
    const response = jsonResponse({ success: true, ...challenge });
    setBrowserCookie(response, browserToken);
    return response;
  } catch (error) {
    log.error('创建微信扫码挑战失败:', error);
    return jsonResponse({ success: false, error: COPY.wechatQr.createFailed }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  const challengeId = request.nextUrl.searchParams.get('id')?.trim();
  const browserToken = request.cookies.get(BROWSER_COOKIE)?.value;
  const networkLimit = await checkRateLimit(getIdentifier(request), 'wechatQrPoll');
  if (!networkLimit.allowed) {
    return jsonResponse({ success: false, status: 'failed', error: COPY.wechatQr.tooManyRequests }, { status: 429 });
  }

  if (!challengeId || !browserToken) {
    return jsonResponse({ success: false, status: 'not_found', error: COPY.wechatQr.sessionMissing }, { status: 404 });
  }
  const browserLimit = await checkRateLimit(
    `wechat-qr-poll:${hashWechatQrBrowserToken(browserToken)}`,
    'wechatQrPoll',
  );
  if (!browserLimit.allowed) {
    return jsonResponse({ success: false, status: 'failed', error: COPY.wechatQr.tooManyRequests }, { status: 429 });
  }

  try {
    const result = await wechatQrAuthRuntime.poll({ challengeId, browserToken });

    if (result.status === 'not_found') {
      return jsonResponse({ success: false, ...result }, { status: 404 });
    }
    if (result.status === 'expired') {
      return jsonResponse({ success: false, ...result }, { status: 410 });
    }
    if (result.status === 'failed') {
      return jsonResponse({ success: false, ...result }, { status: 409 });
    }
    if (result.status !== 'authenticated') {
      return jsonResponse({ success: true, ...result });
    }

    const response = jsonResponse({
      success: true,
      status: result.status,
      accessToken: result.accessToken,
      nickname: result.nickname,
    });
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
    log.error('轮询微信扫码挑战失败:', error);
    return jsonResponse({ success: false, status: 'failed', error: COPY.wechatQr.pollFailed }, { status: 500 });
  }
}
