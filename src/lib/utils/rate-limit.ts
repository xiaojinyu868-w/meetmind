/**
 * API 速率限制工具函数
 * 用于在 API 路由中快速应用速率限制
 */

import { NextRequest } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { 
  checkRateLimit, 
  getIdentifier, 
  createRateLimitResponse,
  type RateLimitType 
} from '@/lib/services/rate-limit-service';

/**
 * 从请求中提取用户ID（如果已登录）
 */
export function getUserIdFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.slice(7);
  const payload = authService.verifyToken(token);
  return payload?.sub || null;
}

/**
 * 应用速率限制
 * 返回 null 表示通过，返回 Response 表示被限制
 */
export async function applyRateLimit(
  request: NextRequest,
  apiType: RateLimitType
): Promise<Response | null> {
  const userId = getUserIdFromRequest(request);
  const identifier = getIdentifier(request, userId);
  
  const result = await checkRateLimit(identifier, apiType);
  
  if (!result.allowed) {
    console.log(`[RateLimit] ${apiType} blocked for ${identifier}: ${result.error}`);
    return createRateLimitResponse(result);
  }
  
  return null;
}

/**
 * 包装 API 处理函数，自动应用速率限制
 */
export function withRateLimit<T>(
  apiType: RateLimitType,
  handler: (request: NextRequest) => Promise<T>
) {
  return async (request: NextRequest): Promise<T | Response> => {
    const rateLimitResponse = await applyRateLimit(request, apiType);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
    return handler(request);
  };
}
