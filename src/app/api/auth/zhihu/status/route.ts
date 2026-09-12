/**
 * GET /api/auth/zhihu/status —— 公开、无用户态：{ enabled, oauthReady }。
 * 第一屏据此决定未登录时给哪个按钮：OAuth 三件套齐了才显示「用知乎登录」，否则只给「用 MeetMind 账号登录」并说明知乎登录还没开放。
 * 不暴露任何凭证内容，只有两个布尔值。
 */
import { NextResponse } from 'next/server';
import { getZhihuConfig, isZhihuOAuthReady } from '@/lib/config/zhihu.config';

export async function GET() {
  const config = getZhihuConfig();
  return NextResponse.json(
    { success: true, enabled: config.enabled, oauthReady: config.enabled && isZhihuOAuthReady(config) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
