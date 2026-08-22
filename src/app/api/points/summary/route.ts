/**
 * GET /api/points/summary —— 积分账户总览（Phase 2：真扣费）
 *
 * 契约（前端按此开发，不得偏离）：
 *   { balance, totalEarned, totalSpent,
 *     asrFreeMinutesRemaining, asrPricePerMinute,
 *     monthCostMilliYuan, monthCostCapMilliYuan,
 *     recentTransactions: [{ delta, kind, reason, createdAt, balanceAfter }] // 最近 20 条 }
 *
 * 需登录（Bearer）；middleware 已挡未授权请求，这里再 verify 一次拿 userId。
 * 首次访问会懒建账户并发放欢迎积分 + 当月活跃积分（幂等）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/utils/rate-limit';
import { getSummary } from '@/lib/services/point-account-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('points/summary');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await getSummary(userId);
    return NextResponse.json(summary);
  } catch (error) {
    log.error('summary failed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
