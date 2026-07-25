import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isPublicRoute } from '@/lib/utils/public-routes';

const STATIC_PATHS = [
  '/_next',
  '/favicon.ico',
  '/public',
];

const API_PREFIX = '/api';

function matchPath(pathname: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pathname === pattern || pathname.startsWith(`${pattern}/`));
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
  const hostname = request.headers.get('host')?.split(':')[0].toLowerCase() ?? '';

  // 技术站与产品站共享一套部署。DNS 指向同一服务后，tech.* / technology.*
  // 会把根路径映射到专业技术介绍；产品主域和 landing.* 继续展示消费级首页。
  if (pathname === '/' && /^(tech|technology)\./.test(hostname)) {
    const technologyUrl = request.nextUrl.clone();
    technologyUrl.pathname = '/technology';
    return NextResponse.rewrite(technologyUrl);
  }

  // 消费级主域保留根路径 URL，内部直接交付无产品截图的品牌叙事版本。
  if (pathname === '/') {
    const landingUrl = request.nextUrl.clone();
    landingUrl.pathname = '/landing-concept-v1.html';
    return NextResponse.rewrite(landingUrl);
  }

  if (matchPath(pathname, STATIC_PATHS)) {
    return NextResponse.next();
  }

  if (isPublicRoute(pathname)) {
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
