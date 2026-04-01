import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/help',
  '/feedback',
  '/app',
  '/api/auth/login',
  '/api/auth/login-with-code',
  '/api/auth/send-code',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/wechat',
  '/api/auth/wechat/callback',
  '/api/wechat/mp',
  '/api/wechat/bind',
  '/api/wechat/bind/callback',
  '/api/wechat/capture/*',
  '/wechat/open/*',
  '/api/tutor',
  '/api/tutor/intent-probe',
  '/api/chat',
  '/api/asr-config',
  '/api/asr-stream',
  '/api/tutor-call',
  '/api/transcribe',
  '/api/transcribe-fast',
  '/api/transcribe-turbo',
  '/api/video/import',
  '/api/sources/ingest',
  '/api/sources/ingest-image',
  '/api/generate-topics',
  '/api/generate-summary',
  '/api/apps/plugins',
  '/api/apps/catalog',
  '/api/apps/execute',
  '/api/apps/infographic/generate-image',
  '/api/extract-terms',
  '/api/analytics',
  '/api/analytics/stats',
  '/api/feedback',
  '/api/health',
];

const STATIC_PATHS = [
  '/_next',
  '/favicon.ico',
  '/public',
];

const API_PREFIX = '/api';

function matchPath(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern;
  });
}

type TokenPayload = {
  exp?: number;
  sub?: string;
  role?: string;
};

function verifyToken(token: string): { valid: boolean; payload?: TokenPayload } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const payloadStr = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64').toString('utf8')) as TokenPayload;

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (matchPath(pathname, STATIC_PATHS)) {
    return NextResponse.next();
  }

  if (matchPath(pathname, PUBLIC_ROUTES)) {
    return NextResponse.next();
  }

  if (pathname.startsWith(API_PREFIX)) {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: '未授权' },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7);
    const { valid, payload } = verifyToken(token);

    if (!valid) {
      return NextResponse.json(
        { success: false, error: '令牌无效或已过期' },
        { status: 401 },
      );
    }

    const requestHeaders = new Headers(request.headers);
    if (payload?.sub) requestHeaders.set('x-user-id', payload.sub);
    if (payload?.role) requestHeaders.set('x-user-role', payload.role);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
