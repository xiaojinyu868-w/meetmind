/**
 * POST /api/zhihu/lesson —— 开一节 live 课。课的单位（2026-09-13 起）：
 *   { captureIds:[一条] }                      → single：讲这一篇（全文）
 *   { captureIds:[2–4 条], topic }            → theme：一条线几篇连起来讲
 *   { favlistUrlToken, auto:true }            → 随手开一节：同学挑最值得先讲的一篇（用分线结果的 start）并说出理由
 *   { favlistUrlToken }（旧）                  → favlist：整个收藏夹按赞同挑 ≤8 篇节选——兜底 / smoke 用
 * 只给进材料包的几篇抽正文 → 建 engine=live 的 TeachThread + 材料包落盘。
 * 「这个学习者」读槽与 /api/teach/threads 同款：服务端 resolveLearnerContext（登录用户），开课时老师知道哪些概念还没稳。
 * 返回 { thread:{id,title,topic}, pack, materialized }；前端拿 thread.id 去 /apps/zhihu/lesson/<id> 开讲。
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildZhihuLesson, type ZhihuLessonMode } from '@/lib/services/zhihu/zhihu-lesson-service';
import { listFavlistsForUser, listZhihuCaptures, ZhihuImportError } from '@/lib/services/zhihu/zhihu-import-service';
import { themesForFavlist } from '@/lib/services/zhihu/zhihu-theme-service';
import { preflightTeachLive } from '@/lib/services/teach-live/teach-live-service';
import { resolveLearnerContext } from '@/lib/services/learner-context-service';
import { LEARNER_CONTEXT_VERSION, isLearnerContextEmpty } from '@/types/learner-context';
import { readJsonBody, requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

export async function POST(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const pre = preflightTeachLive();
  if (!pre.ok) return NextResponse.json({ success: false, error: 'teach_live_unavailable', message: pre.error }, { status: 503 });

  const body = await readJsonBody<{ favlistUrlToken?: unknown; captureIds?: unknown; topic?: unknown; maxItems?: unknown; mode?: unknown; auto?: unknown }>(request);
  const favlistUrlToken = typeof body?.favlistUrlToken === 'string' || typeof body?.favlistUrlToken === 'number' ? String(body.favlistUrlToken).trim() : undefined;
  let captureIds = Array.isArray(body?.captureIds) ? body.captureIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 50) : undefined;
  if (!favlistUrlToken && !captureIds?.length) {
    return NextResponse.json({ success: false, error: 'bad_request', message: '需要 favlistUrlToken 或 captureIds' }, { status: 400 });
  }
  let topic = typeof body?.topic === 'string' ? body.topic.trim().slice(0, 100) : undefined;
  const maxItems = typeof body?.maxItems === 'number' && Number.isFinite(body.maxItems) ? body.maxItems : undefined;
  let mode: ZhihuLessonMode | undefined = body?.mode === 'single' || body?.mode === 'theme' || body?.mode === 'favlist' ? body.mode : undefined;
  let pickReason: string | undefined;

  try {
    // 随手开一节：同学替学生挑最值得先讲的一篇（用分线结果的 start；没有分线就现算一次）
    if (body?.auto === true && favlistUrlToken) {
      const { favlists } = await listFavlistsForUser(auth.userId);
      const favlist = favlists.find((f) => f.urlToken === favlistUrlToken);
      if (!favlist) throw new ZhihuImportError('favlist_not_found', '没有这个收藏夹');
      const captures = await listZhihuCaptures(auth.userId, { favlistUrlToken });
      const themes = await themesForFavlist(auth.userId, favlistUrlToken, favlist.title, captures);
      if (!themes.start) throw new ZhihuImportError('favlist_not_found', '这个收藏夹里没有可以讲的正文（都是视频或想法）');
      captureIds = [themes.start.itemId];
      pickReason = themes.start.why || undefined;
      mode = 'single';
      topic = undefined;
    }
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
      mode,
      pickReason,
      learner: isLearnerContextEmpty(learner) ? null : learner,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
