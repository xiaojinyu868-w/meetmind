/**
 * POST /api/zhihu/import {favlistUrlToken, limit?} —— 把一个收藏夹收进收集流（每条一个 capture，只有摘要，正文按需 materialize）。
 * 同一条收藏重复导入只更新不重复；返回 { favlist, fetched, imported, captures[] }。
 */
import { NextRequest, NextResponse } from 'next/server';
import { importFavlist } from '@/lib/services/zhihu/zhihu-import-service';
import { readJsonBody, requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

export async function POST(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const body = await readJsonBody<{ favlistUrlToken?: unknown; limit?: unknown }>(request);
  const token = typeof body?.favlistUrlToken === 'string' || typeof body?.favlistUrlToken === 'number' ? String(body.favlistUrlToken).trim() : '';
  if (!/^\d+$/.test(token)) {
    return NextResponse.json({ success: false, error: 'bad_request', message: '需要收藏夹标识 favlistUrlToken' }, { status: 400 });
  }
  const limit = typeof body?.limit === 'number' && Number.isFinite(body.limit) ? body.limit : undefined;
  try {
    const result = await importFavlist(auth.userId, token, { limit });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
