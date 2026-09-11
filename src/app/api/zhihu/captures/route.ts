/**
 * GET /api/zhihu/captures?favlist=<urlToken> —— 已收进收集流的知乎收藏（带 metadata.zhihu：正文状态 / 作者 / 赞同 / 所在收藏夹）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { listZhihuCaptures } from '@/lib/services/zhihu/zhihu-import-service';
import { requireUser, zhihuErrorResponse } from '../zhihu-route-utils';

export async function GET(request: NextRequest) {
  const auth = requireUser(request);
  if ('response' in auth) return auth.response;
  const favlist = request.nextUrl.searchParams.get('favlist')?.trim() || undefined;
  try {
    const captures = await listZhihuCaptures(auth.userId, { favlistUrlToken: favlist });
    return NextResponse.json({
      success: true,
      captures: captures.map((c) => ({
        id: c.id,
        title: c.title,
        previewText: c.previewText,
        sourceUrl: c.sourceUrl,
        occurredAt: c.occurredAt?.toISOString() ?? null,
        bodyChars: c.normalizedText?.length ?? 0,
        zhihu: c.zhihu,
      })),
    });
  } catch (error) {
    return zhihuErrorResponse(error);
  }
}
