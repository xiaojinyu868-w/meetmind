import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authService } from '@/lib/services/auth-service';
import workspaceService from '@/lib/services/workspace-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('workspace/captures/stats');


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  return authService.verifyToken(token);
}

interface PlatformStat {
  platform: string;
  count: number;
}

interface ContentTypeStat {
  contentType: string;
  count: number;
}

/**
 * GET /api/workspace/captures/stats
 *
 * 返回当前用户默认 workspace 的收集统计信息：
 * - byContentType: 按内容类型（text/link/video/audio/image）分组计数
 * - byPlatform: 按来源平台（小红书/知乎/B站/...）分组计数
 * - total: 总收集条数
 */
export async function GET(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const workspace = await workspaceService.getDefaultWorkspace(payload.sub);
    if (!workspace) {
      return NextResponse.json({
        success: true,
        total: 0,
        byContentType: [],
        byPlatform: [],
      });
    }

    // 按 contentType 分组统计
    const contentTypeGroups = await prisma.workspaceCapture.groupBy({
      by: ['contentType'],
      where: {
        workspaceId: workspace.id,
        status: 'active',
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    const byContentType: ContentTypeStat[] = contentTypeGroups.map((group) => ({
      contentType: group.contentType,
      count: group._count.id,
    }));

    // 取出所有带 metadataJson 的记录，提取平台标签
    // 注：对于大数据量可考虑添加 platform 字段避免全表扫描，当前阶段数据量小可行
    const captures = await prisma.workspaceCapture.findMany({
      where: {
        workspaceId: workspace.id,
        status: 'active',
        metadataJson: { not: null },
      },
      select: {
        metadataJson: true,
        contentType: true,
      },
    });

    const platformCounts = new Map<string, number>();

    for (const capture of captures) {
      if (!capture.metadataJson) continue;

      try {
        const metadata = JSON.parse(capture.metadataJson) as Record<string, unknown>;
        const providerLabel = typeof metadata.providerLabel === 'string'
          ? metadata.providerLabel
          : null;

        if (providerLabel && providerLabel !== '网页') {
          platformCounts.set(providerLabel, (platformCounts.get(providerLabel) || 0) + 1);
        } else if (capture.contentType === 'link') {
          platformCounts.set('其他网页', (platformCounts.get('其他网页') || 0) + 1);
        }
      } catch {
        // metadataJson 解析失败，跳过
      }
    }

    const byPlatform: PlatformStat[] = Array.from(platformCounts.entries())
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count);

    const total = contentTypeGroups.reduce((sum, group) => sum + group._count.id, 0);

    return NextResponse.json({
      success: true,
      total,
      byContentType,
      byPlatform,
    });
  } catch (error) {
    log.error('capture stats error:', error);
    return NextResponse.json(
      { success: false, error: '获取统计信息失败' },
      { status: 500 }
    );
  }
}
