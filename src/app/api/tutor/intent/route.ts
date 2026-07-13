import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { confirmLearningIntent } from '@/lib/services/learning-intent-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('tutor-intent');

const BodySchema = z.object({
  query: z.string().min(1).max(2_000),
  learnerContext: z.string().max(3_000).optional(),
  recentContext: z.string().max(3_000).optional(),
  activeContext: z.string().max(4_000).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: '请求内容不完整' }, { status: 400 });
    }
    const plan = await confirmLearningIntent(parsed.data);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    log.error('confirm intent failed', error);
    return NextResponse.json({ ok: false, error: '暂时没有理解好，再试一次' }, { status: 500 });
  }
}
