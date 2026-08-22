/**
 * POST /api/admin/points/adjust —— 管理端积分调账（Phase 2：真扣费）
 *
 * 鉴权与 /api/analytics/stats 同款：Bearer JWT + user.role === 'admin'。
 * 请求体：{ userId: string, delta: number, reason: string }
 * - 正负皆可，但不允许把余额调成负数（400 negative_balance）
 * - 全部经 PointTransaction kind='adjust' 留痕（含 balanceAfter）
 */

import { NextRequest, NextResponse } from 'next/server';
import authService from '@/lib/services/auth-service';
import { adjustPoints } from '@/lib/services/point-account-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('admin/points/adjust');

export const dynamic = 'force-dynamic';

interface AdjustBody {
  userId?: unknown;
  delta?: unknown;
  reason?: unknown;
}

export async function POST(request: NextRequest) {
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
    return NextResponse.json({ success: false, error: 'Forbidden: Admin role required' }, { status: 403 });
  }

  let body: AdjustBody;
  try {
    body = (await request.json()) as AdjustBody;
  } catch {
    return NextResponse.json({ success: false, error: 'bad request' }, { status: 400 });
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const delta = typeof body.delta === 'number' && Number.isFinite(body.delta) ? Math.round(body.delta) : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!userId || delta === null || !reason) {
    return NextResponse.json(
      { success: false, error: 'missing userId / delta / reason' },
      { status: 400 },
    );
  }

  try {
    const result = await adjustPoints(userId, delta, reason);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, balance: result.balance },
        { status: 400 },
      );
    }
    log.info('points adjusted', { adminId: payload.sub, userId, delta, reason });
    return NextResponse.json({ success: true, balanceAfter: result.balanceAfter });
  } catch (error) {
    log.error('adjust failed', {
      userId,
      delta,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ success: false, error: 'internal server error' }, { status: 500 });
  }
}
