/**
 * GET /api/points/asr-quota —— ASR 录课免费额度查询（Phase 2：真扣费）
 *
 * 契约：
 *   { asrFreeMinutesRemaining, balance, asrPricePerMinute }
 *
 * 需登录（Bearer）。录课前前端轮询此接口做提示；真正的结算在
 * WS 连接关闭后由 server.js 打 /api/points/settle-asr 完成。
 * 查询本身会懒建账户并落实发放（与 summary 同语义）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/utils/rate-limit';
import { getAsrFreeMinutesRemaining, getOrCreateWithGrants } from '@/lib/services/point-account-service';
import { POINTS_CONFIG } from '@/lib/config/pricing';
import { createLogger } from '@/lib/logger';

const log = createLogger('points/asr-quota');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const account = await getOrCreateWithGrants(userId);
    const asrFreeMinutesRemaining = await getAsrFreeMinutesRemaining(userId);
    return NextResponse.json({
      asrFreeMinutesRemaining,
      balance: account.balance,
      asrPricePerMinute: POINTS_CONFIG.asrPricePerMinute,
    });
  } catch (error) {
    log.error('asr-quota failed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
