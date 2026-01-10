/**
 * Next.js 中间件
 * 
 * 实现路由级别的权限控制和认证检查
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 公开路由（无需登录）
const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/wechat',
  '/api/auth/wechat/callback',
  // 核心功能 API（开发阶段允许公开访问）
  '/api/tutor',
  '/api/chat',
  '/api/asr-config',
  '/api/transcribe',
  '/api/generate-topics',
  '/api/generate-summary',
  '/api/health',
];

// 静态资源路径
const STATIC_PATHS = [
  '/_next',
  '/favicon.ico',
  '/public',
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
    return pathname === pattern;
  });
}

/**
 * 验证 JWT 令牌（简化版，仅检查格式和过期时间）
 */
function verifyToken(token: string): { valid: boolean; payload?: any } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };
    
    // Base64URL 解码
    const payloadStr = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64').toString('utf8'));
    
    // 检查过期时间
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
  if (matchPath(pathname, STATIC_PATHS)) {
    return NextResponse.next();
  }
  
  // 公开路由直接放行
  if (matchPath(pathname, PUBLIC_ROUTES)) {
    return NextResponse.next();
  }
  
  // API 路由的认证检查
  if (pathname.startsWith(API_PREFIX)) {
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: '未授权' },
        { status: 401 }
      );
    }
    
    const token = authHeader.slice(7);
    const { valid, payload } = verifyToken(token);
    
    if (!valid) {
      return NextResponse.json(
        { success: false, error: '令牌无效或已过期' },
        { status: 401 }
      );
    }
    
    // 将用户信息添加到请求头（供 API 路由使用）
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', payload.sub);
    requestHeaders.set('x-user-role', payload.role);
    
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }
  
  // 页面路由的认证检查（可选，根据需要启用）
  // 当前设计为前端检查登录状态，未登录时由前端跳转
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配所有请求路径，除了：
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico (网站图标)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
