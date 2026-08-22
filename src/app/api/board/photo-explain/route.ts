import { NextResponse } from 'next/server';
import { explainPhotoProblem } from '@/lib/services/photo-lecture-service';
import { createLogger } from '@/lib/logger';

/**
 * POST /api/board/photo-explain —— 拍题开讲薄壳（Phase 1 AHA 层）
 *
 * { image: dataURL（题目照片） } →
 *   200 { script, problem: { subject, statement, figureDesc?, studentAttempt? }, models }
 *   422 { error: 'not_a_problem' }（照片里没有题 / 完全看不清）
 *   502 上游模型失败
 *
 * 链路：审题（Qwen3.7-Plus）→ 独立解题锚定（DeepSeek V4 Pro）→
 * BoardScript 生成（DeepSeek V4 Flash）→ sanitize。全程约 30-90s，
 * 前端用分阶段进度文案覆盖等待。
 */

const log = createLogger('api-board-photo-explain');

const MAX_IMAGE_CHARS = 6_000_000; // base64 dataURL 约 4.5MB 图

export async function POST(request: Request) {
  let body: { image?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }

  const { image } = body;
  if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json(
      { error: '需要 image（data:image/...，≤4.5MB）' },
      { status: 400 },
    );
  }

  try {
    const result = await explainPhotoProblem(image);
    if (!result) {
      return NextResponse.json({ error: 'not_a_problem' }, { status: 422 });
    }
    return NextResponse.json({
      script: result.script,
      problem: result.problem,
      models: result.models,
    });
  } catch (cause) {
    log.error('photo-explain failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return NextResponse.json({ error: '讲解生成暂时不可用' }, { status: 502 });
  }
}
