/**
 * GET /api/workspace/pocket?limit=60&sinceHours=48 — 口袋流
 *
 * 最近收进口袋的条目（桌面剪藏 / 截图 / 拖放 / 随手记），按发生时间倒序。
 * 口袋窗用它渲染"今天的流"；服务端只列，不分组——分组键在每条的 metadata.pocket.groupKey，
 * 由客户端按时间顺序合并（相邻同 groupKey 归一组）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import workspaceContextService from '@/lib/services/workspace-context-service';
import { POCKET_SOURCE_TYPES } from '@/lib/services/pocket-clip-service';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('workspace/pocket');

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const payload = authHeader?.startsWith('Bearer ') ? authService.verifyToken(authHeader.slice(7)) : null;
    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 60));
    const sinceHours = Number(request.nextUrl.searchParams.get('sinceHours'));
    const since = Number.isFinite(sinceHours) && sinceHours > 0
      ? new Date(Date.now() - sinceHours * 60 * 60 * 1000)
      : undefined;

    const items = await workspaceContextService.listRecentCapturesForUser(payload.sub, {
      limit,
      sourceTypes: POCKET_SOURCE_TYPES,
      since,
    });

    return NextResponse.json({
      success: true,
      items: items.map((item) => ({
        id: item.id,
        sourceKey: item.sourceKey,
        sourceType: item.sourceType,
        contentType: item.contentType,
        title: item.title,
        previewText: item.previewText,
        normalizedText: item.normalizedText ?? null,
        mediaUrl: item.mediaUrl ?? null,
        occurredAt: item.occurredAt ?? item.createdAt,
        pocket: (item.metadata as { pocket?: unknown } | null)?.pocket ?? null,
      })),
    });
  } catch (error) {
    log.error('pocket list failed', error);
    return NextResponse.json({ success: false, error: '读取口袋失败' }, { status: 500 });
  }
}
