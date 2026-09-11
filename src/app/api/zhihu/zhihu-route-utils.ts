/**
 * /api/zhihu/* 路由共用：取用户、把 service 层错误变成稳定的 HTTP 形状。
 * 错误体固定 `{ success:false, error:<机器码>, message:<人话> }`，前端按 error 分流，按 message 展示。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/utils/rate-limit';
import { ZhihuApiError } from '@/lib/services/zhihu/zhihu-open-client';
import { ZhihuImportError } from '@/lib/services/zhihu/zhihu-import-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/zhihu');

export function requireUser(request: NextRequest): { userId: string } | { response: NextResponse } {
  const userId = getUserIdFromRequest(request);
  if (!userId) return { response: NextResponse.json({ success: false, error: 'unauthorized', message: '请先登录' }, { status: 401 }) };
  return { userId };
}

export function zhihuErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZhihuImportError) {
    const status =
      error.code === 'zhihu_disabled' ? 503
      : error.code === 'zhihu_not_connected' ? 403
      : error.code === 'zhihu_reconnect' ? 401
      : 404;
    return NextResponse.json({ success: false, error: error.code, message: error.message }, { status });
  }
  if (error instanceof ZhihuApiError) {
    log.warn('zhihu upstream error', { endpoint: error.endpoint, kind: error.kind, code: error.code, status: error.status });
    if (error.kind === 'rate_limit' || error.kind === 'quota') {
      return NextResponse.json({ success: false, error: `zhihu_${error.kind}`, message: '知乎接口今天的额度用完了，稍后再试' }, { status: 429 });
    }
    if (error.kind === 'auth') {
      return NextResponse.json({ success: false, error: 'zhihu_upstream_auth', message: '知乎那边不认这次请求，请重新连接知乎' }, { status: 502 });
    }
    return NextResponse.json({ success: false, error: 'zhihu_upstream', message: '知乎暂时没有响应，稍后再试' }, { status: 502 });
  }
  log.error('zhihu route unexpected error', { message: (error as Error)?.message });
  return NextResponse.json({ success: false, error: 'internal', message: '出了点问题，稍后再试' }, { status: 500 });
}

export async function readJsonBody<T extends Record<string, unknown>>(request: NextRequest): Promise<T | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as T) : null;
  } catch {
    return null;
  }
}
