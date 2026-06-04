/**
 * GET /api/llm/models —— 返回所有可用 LLM 模型列表 + 默认模型 id。
 *
 * M13 收口：从 /api/chat GET 拆出来，专门给 ModelSelector / settings 用。
 * /api/chat 是 AI 对话路由（POST 流式），不应该兼任"模型 catalog"职责。
 *
 * 公开接口：无需鉴权（公开 routes 列表已包含），只读。
 */

import { NextResponse } from 'next/server';
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID, DEFAULT_WORKSHOP_MODEL_ID } from '@/lib/services/llm-service';

export const dynamic = 'force-static';
export const revalidate = 60;

export async function GET() {
  return NextResponse.json(
    {
      models: AVAILABLE_MODELS,
      defaultModel: DEFAULT_MODEL_ID,
      // workshop（学习应用）用途默认模型——前端不再自己硬编码，统一从这里取，
      // 保证前后端模型列表/默认值永远一致（消除 unknown model）。
      workshopModel: DEFAULT_WORKSHOP_MODEL_ID,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300',
      },
    },
  );
}
