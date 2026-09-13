/**
 * GET /api/zhihu/favlists/[urlToken]?refresh=1 —— 收藏夹页的数据：这个收藏夹 + 里面每一条（标题 / 作者 / 类型 / 赞同 / 收藏时间 / 一行摘要 / 正文状态）+ 每条开过的课。
 * 第一次打开（本地一条都没有）或 ?refresh=1 时先把收藏夹收进来（用户数据额度 1000 / 天，翻页拉全 ≤100 条）。
 * 分线（同学读出来的几条线）走单独的 /themes，慢（一次模型调用），页面先出列表再出线。
 */
import { NextRequest, NextResponse } from 'next/server';
import { importFavlist, listFavlistsForUser, listZhihuCaptures } from '@/lib/services/zhihu/zhihu-import-service';
import { listLessonsForUser } from '@/lib/services/zhihu/zhihu-lesson-service';
import { requireUser, zhihuErrorResponse } from '../../zhihu-route-utils';

export const dynamic = 'force-dynamic';

/** 物化过全文的条目，previewText 是 Markdown 开头（图片 / 标题 / 加粗）——列表里要的是一行人话 */
function plainSummary(text: string | null | undefined, max = 160): string {
  const plain = (text ?? '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export async function GET(request: NextRequest, { params }: { params: { urlToken: string } }) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const urlToken = String(params.urlToken || '').trim();
  if (!/^\d+$/.test(urlToken)) return NextResponse.json({ success: false, error: 'bad_request', message: '收藏夹标识不对' }, { status: 400 });
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  try {
    const { favlists, mode } = await listFavlistsForUser(auth.userId);
    const favlist = favlists.find((f) => f.urlToken === urlToken) ?? null;
    if (!favlist) return NextResponse.json({ success: false, error: 'favlist_not_found', message: '没有这个收藏夹' }, { status: 404 });

    let captures = await listZhihuCaptures(auth.userId, { favlistUrlToken: urlToken });
    let imported = 0;
    if (refresh || captures.length === 0) {
      const result = await importFavlist(auth.userId, urlToken);
      imported = result.imported;
      captures = await listZhihuCaptures(auth.userId, { favlistUrlToken: urlToken });
    }
    const lessons = await listLessonsForUser(auth.userId, 100);
    const items = captures
      .sort((a, b) => (b.zhihu.favTime || 0) - (a.zhihu.favTime || 0))
      .map((c) => ({
        id: c.id,
        title: c.title,
        summary: plainSummary(c.previewText),
        url: c.zhihu.url,
        kind: c.zhihu.kind,
        author: c.zhihu.author,
        voteUpCount: c.zhihu.voteUpCount,
        commentCount: c.zhihu.commentCount,
        favTime: c.zhihu.favTime,
        body: c.zhihu.body,
        bodyChars: c.normalizedText?.length ?? 0,
        lessons: lessons.filter((l) => l.sourceIds.includes(c.id)).map((l) => ({ threadId: l.threadId, title: l.title, mode: l.mode, updatedAt: l.updatedAt })),
      }));
    return NextResponse.json({ success: true, mode, favlist, imported, items });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
