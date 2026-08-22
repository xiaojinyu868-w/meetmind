// 清小搭 OpenAI 兼容适配层 — GET /api/compat/v1/models
//
// 平台网关用它做连通性 / 凭证校验。通过 Bearer 校验后返回固定模型列表，
// 不查询真实 LLM provider（探测要求秒级响应）。

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { checkXiaodaAuth } from '../auth';

const log = createLogger('xiaoda-compat');

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authError = checkXiaodaAuth(request);
  if (authError) return authError;

  log.debug('models listed');
  return new Response(
    JSON.stringify({
      object: 'list',
      data: [{ id: 'shangchangqian', object: 'model', owned_by: 'meetmind' }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
