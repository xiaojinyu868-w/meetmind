/**
 * POST /api/zhihu/sync —— 把最近在知乎收的（跨收藏夹，≤50 条）同步进收集流，只新增本地没有的。
 * 第一屏每次打开都会调；服务端 15 分钟节流（额度）。响应 { added, scanned, skipped }。
 * 没被节流的那次顺手把知乎画像（收藏夹 / 最近收藏 / 关注 / 创作）写成一条学习观察进个人上下文（24h 一次，fire-and-forget）。
 * body（可选）：{ force?: boolean }（仅用于手动刷新）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { syncRecentCollections } from '@/lib/services/zhihu/zhihu-import-service';
import { recordZhihuProfileObservation } from '@/lib/services/zhihu/zhihu-profile-service';
import { readJsonBody, requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const body = await readJsonBody<{ force?: boolean }>(request);
  try {
    const result = await syncRecentCollections(auth.userId, { force: body?.force === true });
    if (!result.skipped) void recordZhihuProfileObservation(auth.userId, result.identity, { recent: result.items });
    return NextResponse.json({ success: true, mode: result.mode, added: result.added, scanned: result.scanned, skipped: result.skipped });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
