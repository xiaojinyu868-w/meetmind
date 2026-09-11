/**
 * GET /api/zhihu/favlists —— 当前用户的知乎收藏夹列表（最多 50 个，知乎该接口无分页）。
 * 403 zhihu_not_connected / 401 zhihu_reconnect / 429 额度 / 502 上游。
 */
import { NextRequest, NextResponse } from 'next/server';
import { listFavlistsForUser } from '@/lib/services/zhihu/zhihu-import-service';
import { requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

export async function GET(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  try {
    const result = await listFavlistsForUser(auth.userId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
