/**
 * GET /api/pay/packs —— 充值套餐 + 会员档公开展示（无鉴权，数值来自 pricing.ts 唯一真相源）
 *
 * 前端 PaywallDialog 拉取：避免把 pricing.ts（含服务端 logger 依赖）打进浏览器 bundle。
 * 契约：{ packs: RechargePack[], membershipPlans: MembershipPlan[] }
 */

import { NextResponse } from 'next/server';
import { MEMBERSHIP_PLANS, RECHARGE_PACKS } from '@/lib/config/pricing';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ packs: RECHARGE_PACKS, membershipPlans: MEMBERSHIP_PLANS });
}
