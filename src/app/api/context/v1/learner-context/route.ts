import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { applyRateLimit, getUserIdFromRequest } from '@/lib/utils/rate-limit';
import { buildLearnerContextFromStore } from '@/lib/services/learner-context-provider';
import { LEARNER_CONTEXT_VERSION } from '@/types/learner-context';

/**
 * POST /api/context/v1/learner-context —— 「这个学习者」读契约的参考实现（renewal plan §6）。
 *
 * body = LearnerContextRequest，200 = LearnerContext 的事实半（source = 'server'：LearningEvent assessment 事件 + 用户画像）。
 * 理解半（Hindsight 召回）不在这个口——它按任务在服务端 resolveLearnerContext 里补，原文走 /api/context/v1/sources/:id。
 * 鉴权：Bearer = MeetMind JWT，learnerId 以 token 为准（body 里写别人的 id 不生效——个人上下文默认私有）。
 * 与 /api/context/v1/[...path]（通用 Context v1：events / prepare / sources / jobs / grants）并存：静态段优先于 catch-all。
 */

const log = createLogger('api-learner-context');

const RequestSchema = z.object({
  v: z.literal(LEARNER_CONTEXT_VERSION),
  appId: z.string().min(1).max(60),
  learnerId: z.string().max(120).optional(),
  deviceId: z.string().max(120).optional(),
  sessionId: z.string().max(120).optional(),
  concepts: z.array(z.string().max(200)).max(40).optional(),
  need: z.array(z.enum(['mastery', 'recent', 'challenges', 'topics', 'preferences', 'goals'])).min(1).max(6),
  limit: z.number().int().min(1).max(40).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'appsExecute');
  if (rateLimit) return rateLimit;
  const learnerId = getUserIdFromRequest(request);
  if (!learnerId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    log.warn('learner-context.request.invalid', { issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}:${i.code}`) });
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
  const context = await buildLearnerContextFromStore({ ...parsed.data, learnerId });
  return NextResponse.json(context);
}
