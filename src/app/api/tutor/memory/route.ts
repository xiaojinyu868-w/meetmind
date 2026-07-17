import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { distillLearningMemories } from '@/lib/services/learning-memory-distillation-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';

const log = createLogger('tutor-memory');

const MemoryKindSchema = z.enum(['preference', 'strength', 'challenge', 'topic', 'progress']);
const BodySchema = z.object({
  userText: z.string().min(1).max(3_000),
  assistantText: z.string().min(1).max(8_000),
  existingMemories: z.array(z.object({
    id: z.string().min(1).max(120),
    kind: MemoryKindSchema,
    title: z.string().min(1).max(80),
    detail: z.string().max(240).optional(),
  })).max(12).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: '请求内容不完整' }, { status: 400 });
    }
    const memories = await distillLearningMemories(parsed.data);
    return NextResponse.json({ ok: true, memories });
  } catch (error) {
    log.error('distill learning memory failed', error);
    return NextResponse.json({ ok: false, error: '这次没有形成新的理解' }, { status: 500 });
  }
}
