/**
 * GET /api/zhihu/favlists/[urlToken]/themes?force=1 —— 同学读这个收藏夹：分成几条线 + 最值得先讲的一篇。
 * 一次模型调用（tutorQuick），按条目集合 hash 缓存在 data/zhihu-themes/<uid>/<token>.json；条目变了才重算。
 */
import { NextRequest, NextResponse } from 'next/server';
import { listFavlistsForUser, listZhihuCaptures } from '@/lib/services/zhihu/zhihu-import-service';
import { themesForFavlist } from '@/lib/services/zhihu/zhihu-theme-service';
import { requireUser, zhihuErrorResponse } from '../../../zhihu-route-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { urlToken: string } }) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const urlToken = String(params.urlToken || '').trim();
  if (!/^\d+$/.test(urlToken)) return NextResponse.json({ success: false, error: 'bad_request', message: '收藏夹标识不对' }, { status: 400 });
  try {
    const { favlists } = await listFavlistsForUser(auth.userId);
    const favlist = favlists.find((f) => f.urlToken === urlToken) ?? null;
    if (!favlist) return NextResponse.json({ success: false, error: 'favlist_not_found', message: '没有这个收藏夹' }, { status: 404 });
    const captures = await listZhihuCaptures(auth.userId, { favlistUrlToken: urlToken });
    const themes = await themesForFavlist(auth.userId, urlToken, favlist.title, captures, { force: request.nextUrl.searchParams.get('force') === '1' });
    return NextResponse.json({ success: true, ...themes });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
