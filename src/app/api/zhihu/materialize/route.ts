/**
 * POST /api/zhihu/materialize {captureIds[], force?} —— 给这些收藏抽正文（Firecrawl ≈1 credit / 条，并发 3）并去杂质。
 * 每条返回 status：full / already-full / unsupported（视频 / 想法）/ failed（留摘要，失败原因记在 metadata）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { materializeCaptures } from '@/lib/services/zhihu/zhihu-import-service';
import { readJsonBody, requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

const MAX_PER_CALL = 30;

export async function POST(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const body = await readJsonBody<{ captureIds?: unknown; force?: unknown }>(request);
  const ids = Array.isArray(body?.captureIds) ? body.captureIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  if (!ids.length || ids.length > MAX_PER_CALL) {
    return NextResponse.json({ success: false, error: 'bad_request', message: `需要 1–${MAX_PER_CALL} 个 captureIds` }, { status: 400 });
  }
  try {
    const results = await materializeCaptures(auth.userId, [...new Set(ids)], { force: body?.force === true });
    return NextResponse.json({ success: true, results });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
