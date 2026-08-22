/**
 * GET /api/admin/costs — 积分影子计量的成本视图（Phase 1 只读）
 *
 * 鉴权与 /api/analytics/stats 同款（Bearer token + admin role）。
 * ?days=7|30（1-90），返回：
 *   - total：窗口内合计
 *   - byFeature：feature（PointTransaction.reason）× modelId 聚合
 *   - daily：每日趋势
 * 数据量按内测规模设计，内存聚合，不引 raw SQL。
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import authService from '@/lib/services/auth-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('admin/costs');

export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

interface CostBucket {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  costMilliYuan: number;
}

function emptyBucket(): CostBucket {
  return { requests: 0, promptTokens: 0, completionTokens: 0, costMilliYuan: 0 };
}

function addTo(bucket: CostBucket, row: { promptTokens: number; completionTokens: number; costMilliYuan: number }) {
  bucket.requests += 1;
  bucket.promptTokens += row.promptTokens;
  bucket.completionTokens += row.completionTokens;
  bucket.costMilliYuan += row.costMilliYuan;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = authService.verifyToken(token);
    if (!payload) {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
    }

    const user = await authService.getUserById(payload.sub);
    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Admin role required' },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const rawDays = Number.parseInt(searchParams.get('days') || `${DEFAULT_DAYS}`, 10);
    const days = Number.isFinite(rawDays)
      ? Math.min(Math.max(rawDays, 1), MAX_DAYS)
      : DEFAULT_DAYS;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await prisma.pointTransaction.findMany({
      where: { kind: 'spend', createdAt: { gte: since } },
      select: {
        reason: true,
        modelId: true,
        promptTokens: true,
        completionTokens: true,
        costMilliYuan: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const total = emptyBucket();
    const byFeatureMap = new Map<string, CostBucket>();
    const dailyMap = new Map<string, CostBucket>();

    for (const row of rows) {
      addTo(total, row);

      const groupKey = `${row.reason || 'other'}|||${row.modelId || 'unknown'}`;
      const featureBucket = byFeatureMap.get(groupKey) ?? emptyBucket();
      addTo(featureBucket, row);
      byFeatureMap.set(groupKey, featureBucket);

      const dateKey = row.createdAt.toISOString().slice(0, 10);
      const dailyBucket = dailyMap.get(dateKey) ?? emptyBucket();
      addTo(dailyBucket, row);
      dailyMap.set(dateKey, dailyBucket);
    }

    const byFeature = Array.from(byFeatureMap.entries())
      .map(([key, bucket]) => {
        const [feature, modelId] = key.split('|||');
        return { feature, modelId, ...bucket };
      })
      .sort((a, b) => b.costMilliYuan - a.costMilliYuan);

    const daily = Array.from(dailyMap.entries())
      .map(([date, bucket]) => ({ date, ...bucket }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      success: true,
      data: {
        days,
        since: since.toISOString(),
        total,
        byFeature,
        daily,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('[Admin Costs API] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
