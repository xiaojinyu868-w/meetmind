/**
 * POST /api/zhihu/lesson {favlistUrlToken? | captureIds?, topic?, maxItems?} —— 把一个收藏夹开成一节 live 课。
 *
 * 挑材料（按赞同，≤8 篇有正文可讲的）→ 只给进材料包的几篇抽正文 → 建 engine=live 的 TeachThread + 材料包落盘。
 * 「这个学习者」读槽与 /api/teach/threads 同款：服务端 resolveLearnerContext（登录用户），开课时老师知道哪些概念还没稳。
 * 返回 { thread:{id,title,topic}, pack, materialized }；前端拿 thread.id 去 /apps/zhihu/lesson/<id> 开讲。
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildZhihuLesson } from '@/lib/services/zhihu/zhihu-lesson-service';
import { preflightTeachLive } from '@/lib/services/teach-live/teach-live-service';
import { resolveLearnerContext } from '@/lib/services/learner-context-service';
import { LEARNER_CONTEXT_VERSION, isLearnerContextEmpty } from '@/types/learner-context';
import { readJsonBody, requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

export async function POST(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const pre = preflightTeachLive();
  if (!pre.ok) return NextResponse.json({ success: false, error: 'teach_live_unavailable', message: pre.error }, { status: 503 });

  const body = await readJsonBody<{ favlistUrlToken?: unknown; captureIds?: unknown; topic?: unknown; maxItems?: unknown }>(request);
  const favlistUrlToken = typeof body?.favlistUrlToken === 'string' || typeof body?.favlistUrlToken === 'number' ? String(body.favlistUrlToken).trim() : undefined;
  const captureIds = Array.isArray(body?.captureIds) ? body.captureIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 50) : undefined;
  if (!favlistUrlToken && !captureIds?.length) {
    return NextResponse.json({ success: false, error: 'bad_request', message: '需要 favlistUrlToken 或 captureIds' }, { status: 400 });
  }
  const topic = typeof body?.topic === 'string' ? body.topic.trim().slice(0, 100) : undefined;
  const maxItems = typeof body?.maxItems === 'number' && Number.isFinite(body.maxItems) ? body.maxItems : undefined;

  try {
    const learner = await resolveLearnerContext({
      request: {
        v: LEARNER_CONTEXT_VERSION,
        appId: 'teach',
        learnerId: auth.userId,
        need: ['mastery', 'challenges', 'topics', 'goals'],
        limit: 8,
        task: `用学生自己的知乎收藏夹给 TA 上一课${topic ? `：${topic}` : ''}`,
      },
    });
    const result = await buildZhihuLesson(auth.userId, {
      favlistUrlToken,
      captureIds,
      topic,
      maxItems,
      learner: isLearnerContextEmpty(learner) ? null : learner,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
