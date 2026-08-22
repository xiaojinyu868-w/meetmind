import { NextResponse } from 'next/server';
import { gradeStudentInk } from '@/lib/services/ink-grading-service';
import { createLogger } from '@/lib/logger';

/**
 * POST /api/board/grade-ink —— 学生板演批改薄壳（Practice 场景闭环）
 *
 * { image: dataURL（叠网格的笔迹图）, question, answer } →
 * { verdict, comment, marks }（ink-grading-service 已清洗）。
 * 未配置模型 / 调用失败 → 502（前端按"不批改也能继续"静默降级）。
 */

const log = createLogger('api-board-grade-ink');

const MAX_IMAGE_CHARS = 6_000_000; // base64 dataURL 约 4.5MB 图
const MAX_TEXT_CHARS = 2000;

export async function POST(request: Request) {
  let body: { image?: unknown; question?: unknown; answer?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }

  const { image, question, answer } = body;
  if (
    typeof image !== 'string' ||
    !image.startsWith('data:image/') ||
    image.length > MAX_IMAGE_CHARS ||
    typeof question !== 'string' ||
    !question.trim() ||
    question.length > MAX_TEXT_CHARS ||
    typeof answer !== 'string' ||
    !answer.trim() ||
    answer.length > MAX_TEXT_CHARS
  ) {
    return NextResponse.json(
      { error: '需要 image（data:image/...，≤4.5MB）+ 非空 question/answer（≤2000 字）' },
      { status: 400 },
    );
  }

  try {
    const result = await gradeStudentInk({
      imageDataUrl: image,
      question: question.trim(),
      answer: answer.trim(),
    });
    return NextResponse.json(result);
  } catch (cause) {
    log.error('ink-grading failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return NextResponse.json({ error: '批改服务暂时不可用' }, { status: 502 });
  }
}
