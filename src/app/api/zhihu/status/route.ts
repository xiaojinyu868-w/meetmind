/**
 * GET /api/zhihu/status —— 这个用户和知乎的连接状态：{ enabled, connected, mode: 'oauth'|'self'|null, expired, expiresAt }。
 * 第一屏据此决定显示「用知乎登录 / 连接知乎」还是「选一个收藏夹」；expired 时显示「重新连接知乎」。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getZhihuConfig } from '@/lib/config/zhihu.config';
import { getZhihuConnection } from '@/lib/services/zhihu/zhihu-import-service';
import { requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

export async function GET(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  try {
    const config = getZhihuConfig();
    const connection = await getZhihuConnection(auth.userId);
    return NextResponse.json({ success: true, enabled: config.enabled, ...connection });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
