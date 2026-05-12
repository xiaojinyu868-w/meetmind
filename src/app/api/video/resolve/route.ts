import { NextRequest, NextResponse } from 'next/server';
import { resolveLegacyVideoUrl } from '@/lib/utils/video-resolve-url';

export const runtime = 'nodejs';

/**
 * GET /api/video/resolve?url=...
 *
 * 兼容旧前端 bundle 的视频 URL 解析入口。这个接口不抓取远程媒体，
 * 只做 URL 归一化并返回 200，避免旧页面在视频复习页持续打出 403/404 控制台噪音。
 */
export async function GET(request: NextRequest) {
  const result = resolveLegacyVideoUrl(request.nextUrl.searchParams.get('url'));
  if (!result.ok) {
    return NextResponse.json(result, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  });
}
