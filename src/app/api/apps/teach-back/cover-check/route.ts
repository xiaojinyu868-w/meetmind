import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { checkTeachBackCoverage } from '@/lib/services/teach-back-cover-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';

const log = createLogger('teach-back-cover');

const TargetSchema = z.object({
  id: z.string().min(1).max(60),
  point: z.string().min(1).max(120),
  why: z.string().max(200).optional(),
  evidence: z.object({
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    snippet: z.string().max(600),
  }).nullable(),
});

const BodySchema = z.object({
  targets: z.array(TargetSchema).min(1).max(8),
  teachingTurns: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().max(2_000),
  })).min(1).max(60),
});

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'appsExecute');
  if (rateLimit) return rateLimit;

  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: '请求内容不完整' }, { status: 400 });
    }
    const covered = await checkTeachBackCoverage(parsed.data);
    return NextResponse.json({ ok: true, covered });
  } catch (error) {
    log.error('cover check failed', error);
    return NextResponse.json({ ok: false, error: '这次没能判断讲到哪了' }, { status: 500 });
  }
}
