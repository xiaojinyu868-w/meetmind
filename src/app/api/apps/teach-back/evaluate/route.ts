import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { evaluateTeachBack } from '@/lib/services/teach-back-eval-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';

const log = createLogger('teach-back-eval');

const EvidenceSchema = z.object({
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  snippet: z.string().max(600),
}).nullable();

const TargetSchema = z.object({
  id: z.string().min(1).max(60),
  point: z.string().min(1).max(120),
  why: z.string().max(200).optional(),
  evidence: EvidenceSchema,
});

const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(2_000),
});

const SegmentSchema = z.object({
  text: z.string().max(2_000),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
}).passthrough();

const BodySchema = z.object({
  targets: z.array(TargetSchema).min(1).max(8),
  teachingTurns: z.array(TurnSchema).min(1).max(200),
  transcript: z.array(SegmentSchema).min(1).max(2_000),
  metadata: z.object({
    title: z.string().max(200).optional(),
    subject: z.string().max(120).optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'appsExecute');
  if (rateLimit) return rateLimit;

  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: '请求内容不完整' }, { status: 400 });
    }
    const evaluation = await evaluateTeachBack({
      targets: parsed.data.targets,
      teachingTurns: parsed.data.teachingTurns,
      transcript: parsed.data.transcript as never,
      metadata: parsed.data.metadata,
    });
    return NextResponse.json({ ok: true, evaluation });
  } catch (error) {
    log.error('teach-back evaluation failed', error);
    return NextResponse.json({ ok: false, error: '这次没能完成核对' }, { status: 500 });
  }
}
