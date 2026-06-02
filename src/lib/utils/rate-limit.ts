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
 *
 * Smoke bypass：当 env `SMOKE_BYPASS_TOKEN` 已设置，且请求 header
 * `X-Smoke-Bypass` 等于该 token 时，直接放行（不计数、不返回 429）。
 * 这是为了让 `make smoke-intent` 这类**端到端真实 LLM 调用**测试不被
 * 项目自有的 rate-limiter 卡住——开发同学跑测试不会和正常用户共享 IP 配额。
 *
 * 安全性：
 *   - SMOKE_BYPASS_TOKEN 只在 .env 内部，线上不应配置
 *   - 即使 token 泄漏，攻击者只能绕过 rate limit，不能绕过 auth/计费
 *   - 没配 SMOKE_BYPASS_TOKEN 时此分支恒不命中
 */
export async function applyRateLimit(
  request: NextRequest,
  apiType: RateLimitType
): Promise<Response | null> {
  const bypassToken = process.env.SMOKE_BYPASS_TOKEN;
  if (bypassToken && request.headers.get('X-Smoke-Bypass') === bypassToken) {
    return null;
  }

  const userId = getUserIdFromRequest(request);
  const identifier = getIdentifier(request, userId);

  const result = await checkRateLimit(identifier, apiType);

  if (!result.allowed) {
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
