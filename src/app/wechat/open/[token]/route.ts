import { NextRequest, NextResponse } from 'next/server';
import { ensureWechatInboxMessageHydrated } from '@/lib/services/wechat-inbox-service';
import { authService } from '@/lib/services/auth-service';
import { createWechatWebSession } from '@/lib/services/wechat-web-session-service';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // 构建公网 base URL（nginx 反代后 request.url 的 host 是 localhost）
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const baseUrl = `${proto}://${host}`;

  const fallbackUrl = `${baseUrl}/wechat/capture/${encodeURIComponent(token)}`;

  const message = await ensureWechatInboxMessageHydrated(token);
  if (!message || message.bindingStatus !== 'bound' || !message.userId) {
    return NextResponse.redirect(fallbackUrl);
  }

  const sessionResult = await authService.createSessionForUserId(message.userId);
  if (!sessionResult.success || !sessionResult.accessToken) {
    return NextResponse.redirect(fallbackUrl);
  }

  const sessionToken = createWechatWebSession({
    accessToken: sessionResult.accessToken,
    refreshToken: sessionResult.refreshToken,
    nickname: sessionResult.user?.nickname || '',
  });

  const redirectUrl = new URL('/app', baseUrl);
  redirectUrl.searchParams.set('mobile', '1');
  redirectUrl.searchParams.set('wechat_capture', token);
  redirectUrl.searchParams.set('session', sessionToken);

  const response = NextResponse.redirect(redirectUrl);

  if (sessionResult.refreshToken) {
    response.cookies.set('refreshToken', sessionResult.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
  }

  return response;
}
