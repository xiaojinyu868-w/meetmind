/**
 * POST /api/zhihu/continue {concepts[], threadId?, topic?, perConcept?} —— 考后补货：还没稳的概念 → 知乎上讲得最清楚的几条。
 *
 * 每个概念搜一次站内搜索（≤3 次 / 调用，额度 5,000/天），按权威 / 赞同 / 有反方评论排序，排除这节课材料包里已有的链接。
 * 带 threadId 时从材料包取课题与已有链接。检索失败宁可少推：返回空组不报错（产品论点 §5）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { continueReading } from '@/lib/services/zhihu/zhihu-discovery-service';
import { readLiveMaterials } from '@/lib/services/teach-live/live-materials';
import { readJsonBody, requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

export async function POST(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const body = await readJsonBody<{ concepts?: unknown; threadId?: unknown; topic?: unknown; perConcept?: unknown }>(request);
  const concepts = Array.isArray(body?.concepts) ? body.concepts.filter((c): c is string => typeof c === 'string' && c.trim().length >= 2).slice(0, 5) : [];
  if (!concepts.length) {
    return NextResponse.json({ success: false, error: 'bad_request', message: '需要至少一个概念' }, { status: 400 });
  }
  const threadId = typeof body?.threadId === 'string' && /^[a-zA-Z0-9_-]+$/.test(body.threadId) ? body.threadId : null;
  let topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
  let excludeUrls: string[] = [];
  if (threadId) {
    const pack = await readLiveMaterials(threadId);
    if (pack) {
      topic = topic || pack.title;
      excludeUrls = pack.items.map((item) => item.url);
    }
  }
  try {
    const groups = await continueReading({
      concepts,
      topic: topic || undefined,
      excludeUrls,
      perConcept: typeof body?.perConcept === 'number' ? body.perConcept : undefined,
    });
    return NextResponse.json({ success: true, groups });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
