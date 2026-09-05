import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { respondTeachBack } from '@/lib/services/teach-back-respond-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';

const log = createLogger('teach-back-respond');

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

const BodySchema = z.object({
  targets: z.array(TargetSchema).min(1).max(8),
  teachingTurns: z.array(TurnSchema).min(0).max(200),
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
    const say = await respondTeachBack({
      targets: parsed.data.targets,
      teachingTurns: parsed.data.teachingTurns,
      metadata: parsed.data.metadata,
    });
    // say 为 null = 同桌安静不打扰，也是成功
    return NextResponse.json({ ok: true, say });
  } catch (error) {
    log.error('teach-back respond failed', error);
    return NextResponse.json({ ok: false, error: '同桌这次没反应过来' }, { status: 500 });
  }
}
