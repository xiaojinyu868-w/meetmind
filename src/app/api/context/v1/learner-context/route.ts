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
 * 与外部 context 系统约定的是同一个接口形状：body = LearnerContextRequest，200 = LearnerContext。
 * 这里由本仓库自己的存储供给（LearningEvent assessment 事件 + 用户画像），source = 'server'。
 * 鉴权：Bearer = MeetMind JWT，learnerId 以 token 为准（body 里写别人的 id 不生效——个人上下文默认私有）。
 * 外部系统合并后可以：(a) 代理到这个口对拍；(b) 在 CONTEXT_SYSTEM_URL 提供同形接口，本仓库自动改问它。
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
