// 清小搭 OpenAI 兼容适配层 — 共享 Bearer 鉴权
//
// 平台网关调用 {baseUrl}/models 与 {baseUrl}/chat/completions 时携带
// `Authorization: Bearer <XIAODA_API_KEY>`。两个端点共用这里的校验，避免重复实现。
//
// 返回 null = 通过；否则返回应直接回给调用方的 Response。

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';

const log = createLogger('xiaoda-compat');

function jsonError(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function checkXiaodaAuth(request: NextRequest): Response | null {
  const expected = process.env.XIAODA_API_KEY?.trim();
  if (!expected) {
    log.error('XIAODA_API_KEY not configured; compat layer disabled');
    return jsonError(503, 'service_disabled', 'xiaoda compat layer is not enabled (XIAODA_API_KEY missing)');
  }

  const header = request.headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || match[1].trim() !== expected) {
    log.debug('auth rejected', { hasHeader: Boolean(header) });
    return jsonError(401, 'unauthorized', 'invalid or missing bearer credential');
  }
  return null;
}
