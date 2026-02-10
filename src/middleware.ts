/**
 * Next.js 中间件
 * 
 * 实现路由级别的权限控制和认证检查
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 公开路由（无需登录）
const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/help',
  '/feedback',
  '/app',
];

// API 公开路由
const PUBLIC_API_ROUTES = [
  '/api/auth/login',
  '/api/auth/login-with-code',
  '/api/auth/send-code',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/wechat',
  '/api/auth/wechat/callback',
  '/api/tutor',
  '/api/chat',
  '/api/asr-config',
  '/api/transcribe',
  '/api/transcribe-fast',
  '/api/transcribe-turbo',
  '/api/video/import',
  '/api/generate-topics',
  '/api/generate-summary',
  '/api/feedback',
  '/api/health',
  '/api/locale',
];

// 静态资源路径
const STATIC_PATHS = [
  '/_next',
  '/favicon.ico',
  '/public',
  '/videos',
  '/images',
];

// API 路由前缀
const API_PREFIX = '/api';

/**
 * 检查路径是否匹配
 */
function matchPath(pathname: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    if (pattern.endsWith('*')) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern || pathname.startsWith(pattern + '/');
  });
}

/**
 * 验证 JWT 令牌（简化版，仅检查格式和过期时间）
 */
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
  
  // 跳过静态资源
  if (STATIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }
  
  // API 路由处理
  if (pathname.startsWith(API_PREFIX)) {
    // 检查是否是公开 API
    const isPublicApi = PUBLIC_API_ROUTES.some(route => 
      pathname === route || pathname.startsWith(route + '/')
    );
    
    if (isPublicApi) {
      return NextResponse.next();
    }
    
    // 需要认证的 API
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    
    const token = authHeader.slice(7);
    const { valid, payload } = verifyToken(token);
    
    if (!valid) {
      return NextResponse.json(
        { success: false, error: 'Token invalid or expired', code: 'TOKEN_INVALID' },
        { status: 401 }
      );
    }
    
    const requestHeaders = new Headers(request.headers);
    if (payload?.sub) {
      requestHeaders.set('x-user-id', payload.sub);
    }
    if (payload?.role) {
      requestHeaders.set('x-user-role', payload.role);
    }
    
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }
  
  // 页面路由直接放行，国际化由 layout 处理
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
