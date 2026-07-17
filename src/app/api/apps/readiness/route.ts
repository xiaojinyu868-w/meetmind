import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { assessWorkshopReadiness } from '@/lib/services/workshop-readiness-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import type { TranscriptSegment } from '@/types';

const log = createLogger('apps-readiness');

const BodySchema = z.object({
  transcript: z.array(z.object({
    id: z.string().optional(),
    text: z.string(),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
  })).max(2_000),
  contextTitle: z.string().max(300).optional(),
  contextType: z.string().max(80).optional(),
  activeAnchorCount: z.number().int().nonnegative().max(1_000).optional(),
  keyDifficulties: z.array(z.string().max(240)).max(24).optional(),
  summary: z.string().max(4_000).optional(),
  goalIntent: z.string().max(1_000).optional(),
  contextTier: z.enum(['class', 'unit', 'exam']).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'appsExecute');
  if (rateLimit) return rateLimit;

  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'INVALID_CONTEXT' }, { status: 400 });
    }

    const assessment = await assessWorkshopReadiness({
      ...parsed.data,
      transcript: parsed.data.transcript as TranscriptSegment[],
    });
    return NextResponse.json({ ok: true, assessment });
  } catch (error) {
    log.error('readiness assessment failed', error);
    return NextResponse.json({ ok: false, error: 'ASSESSMENT_FAILED' }, { status: 500 });
  }
}
