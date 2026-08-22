/**
 * 模型定价表 —— 积分机制 Phase 1（影子计量）的唯一数值真相源。
 *
 * 单位：毫元 / 每百万 token（1 元 = 1000 毫元）。
 * 例如 inputPerMillion: 1000 表示每百万输入 token 约 ¥1。
 *
 * ⚠️ 全部为估算值，上线前以各 provider 控制台价目校准；
 * 影子期的意义是收集「相对成本结构」，不是财务对账。
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('pricing');

export interface ModelPricing {
  /** 每百万输入 token 的毫元价 */
  inputPerMillion: number;
  /** 每百万输出 token 的毫元价 */
  outputPerMillion: number;
}

/** 已知模型定价（2026-08 官方刊例校准；缓存命中/峰谷/阶梯未细分，取缓存未命中平时价） */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // DeepSeek 官方/百炼同价 ¥1/¥2（缓存命中 ¥0.02；高峰 9-12/14-18 翻倍；官方已预告近期涨价，涨后需更新）
  'DeepSeek-V4-Flash': { inputPerMillion: 1000, outputPerMillion: 2000 },
  'DeepSeek-V4-Pro': { inputPerMillion: 3000, outputPerMillion: 6000 },
  // 通义千问（百炼官方：输入≤256k 档 ¥2/¥8；256k-1M 档 ¥6/¥24，缓存命中 ¥0.4）
  'qwen3.7-plus': { inputPerMillion: 2000, outputPerMillion: 8000 },
  'qwen-vl-ocr': { inputPerMillion: 500, outputPerMillion: 1200 },
  // 阶跃星辰（估算值）
  'step-3.7-flash': { inputPerMillion: 500, outputPerMillion: 1000 },
};

/** 未知模型的兜底价（偏保守取中位），命中时打 warn 提醒补表 */
const FALLBACK_PRICING: ModelPricing = { inputPerMillion: 2000, outputPerMillion: 4000 };

const warnedUnknownModels = new Set<string>();

/** 查模型定价；未知模型返回兜底价并打一次 warn（不刷屏） */
export function getModelPricing(modelId: string): ModelPricing {
  const exact = MODEL_PRICING[modelId];
  if (exact) return exact;
  // DeepSeek 官方 API 只接受小写模型名，日志里的 modelId 可能是小写形式
  const caseInsensitive = Object.keys(MODEL_PRICING).find(
    (key) => key.toLowerCase() === modelId.toLowerCase(),
  );
  if (caseInsensitive) return MODEL_PRICING[caseInsensitive];
  if (!warnedUnknownModels.has(modelId)) {
    warnedUnknownModels.add(modelId);
    log.warn('unknown model pricing, using fallback', { modelId });
  }
  return FALLBACK_PRICING;
}

/**
 * 按定价表计算一次调用的真实成本（毫元，四舍五入为整数）。
 * token 缺失按 0 计；负数按 0 计（防御上游异常值）。
 */
export function calcCostMilliYuan(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = getModelPricing(modelId);
  const prompt = Number.isFinite(promptTokens) && promptTokens > 0 ? promptTokens : 0;
  const completion = Number.isFinite(completionTokens) && completionTokens > 0 ? completionTokens : 0;
  return Math.round(
    (prompt * pricing.inputPerMillion + completion * pricing.outputPerMillion) / 1_000_000,
  );
}

// ==================== Phase 2：真扣费价目 ====================
// 以下数值是积分经济的唯一数值真相源；改价先改这里，再同步
// src/app/api/points/DOMAIN.md 的契约说明。

/**
 * 积分经济数值（2026-08 第二次校准）。
 * 校准依据：重度学生月成本 ≈ ¥26（ASR ¥1.12/小时 × 20h ≈ ¥22 是大头，
 * LLM 实测 ¥4/月）；对位 YouLearn Pro $10-20/月、TurboLearn $9.99-19.99/月，
 * 目标重度用户月付 ¥60-70、毛利 ~60%。发放额度必须显著低于典型月消耗，
 * 否则积分永远用不完、付费截断永远不触发。
 */
export const POINTS_CONFIG = {
  /** 首次访问积分体系的一次性欢迎积分（懒建账户时发放） */
  welcomeGrant: 200,
  /** 每月活跃发放（每月首次访问时补一笔） */
  monthlyGrant: 150,
  /** ASR 录课每月免费分钟数（≈4 节 90 分钟大课，够体验不够重度用） */
  asrFreeMinutesPerMonth: 300,
  /** 超出免费额度后的 ASR 单价（积分/分钟，向上取整计费；≈¥4/小时 vs 成本 ¥1.12/小时） */
  asrPricePerMinute: 3,
  /** 熔断：单用户当月真实成本上限（毫元，≈¥50），达到后所有扣费预检返回 402 */
  monthlyCostCapMilliYuan: 50_000,
  /** guest（未登录）每日 LLM 成本上限（毫元，≈¥0.3），超过后 402 guest_daily_cap 引导登录 */
  guestDailyCostCapMilliYuan: 300,
  /** guest 每日免费 ASR 分钟数（服务端 WS 强制，超了拒绝新连接） */
  guestDailyAsrMinutes: 20,
} as const;

/**
 * Tutor 按轮扣费价目：review 与 global deep 档 5 积分/轮；
 * in-class / word / goal / shared / global quick 档免费（课中陪伴是获客钩子，不收费）。
 */
export function getTutorModePrice(mode: string, globalDepth?: string | null): number {
  if (mode === 'review') return 5;
  if (mode === 'global' && globalDepth === 'deep') return 5;
  return 0;
}

/** 应用矩阵 /api/apps/execute 按次扣费价目（积分/次） */
const APP_EXEC_PRICES: Record<string, number> = {
  cheatsheet: 15,
  podcast: 20,
  'audio-overview': 20,
  infographic: 15,
  quiz: 8,
  flashcards: 8,
  mindmap: 5,
  'teach-back': 5,
  explainer: 8,
};

/** 查应用执行价；未列出的 appKey 兜底 5 积分/次。Max 档按 appDiscount 打折（向上取整，最低 1） */
export function getAppExecPrice(appKey: string, tier: MembershipTier = 'free'): number {
  const base = APP_EXEC_PRICES[appKey] ?? 5;
  const discount = getMembershipPlan(tier)?.appDiscount ?? 1;
  return Math.max(1, Math.ceil(base * discount));
}

// ==================== 积分充值包（微信 Native 扫码支付） ====================
// 充值面额与到账积分的唯一数值真相源；改价先改这里，再同步
// src/app/api/pay/DOMAIN.md 的契约说明。
// 定价锚点：1 积分 ≈ ¥0.017-0.025（大包更便宜）；对位 YouLearn Pro $10-20/月，
// 重度用户月消耗 ~3200 积分 ≈ 学霸包 ¥69.9/月（毛利 ~60%）。

export interface RechargePack {
  key: string;
  /** 应付金额（分） */
  amountFen: number;
  /** 到账积分 */
  points: number;
}

export const RECHARGE_PACKS: readonly RechargePack[] = [
  { key: 'starter', amountFen: 990, points: 400 },
  { key: 'standard', amountFen: 2990, points: 1400 },
  { key: 'scholar', amountFen: 6990, points: 4000 },
] as const;

/** 查充值包；非法 key 返回 undefined（调用方按 400 处理） */
export function getRechargePack(key: string): RechargePack | undefined {
  return RECHARGE_PACKS.find((pack) => pack.key === key);
}

// ==================== 订阅会员（复用 RechargeOrder 支付链路） ====================
// 会员档位的唯一数值真相源；改价先改这里，再同步 src/app/api/pay/DOMAIN.md。
// 定价锚点：对位 YouLearn Pro $12-20/月（¥85-140）、Max $35-60/月；
// Pro 满负荷真实成本 ≈ ¥45（ASR 2000 分钟 ≈ ¥37 + LLM），100% 利用率微亏，
// 典型 30-50% 利用率下毛利健康 —— 上线后按真实利用率校准。
// 权益原则：会员只改「配额与闸门」，不改扣费机制；超额度后仍走积分/充值包。

export type MembershipTier = 'free' | 'pro' | 'max';

export interface MembershipPlan {
  tier: Exclude<MembershipTier, 'free'>;
  /** 下单用 packKey（与积分包共用 RechargeOrder.packKey 命名空间） */
  packKey: string;
  /** 应付金额（分） */
  amountFen: number;
  /** 到账天数；续期从 max(now, 现有 expiresAt) 叠加 */
  days: number;
  /** 每月免费 ASR 分钟数（覆盖 POINTS_CONFIG.asrFreeMinutesPerMonth） */
  asrFreeMinutesPerMonth: number;
  /** 每月活跃发放积分（覆盖 POINTS_CONFIG.monthlyGrant） */
  monthlyGrant: number;
  /** 解锁 global deep 模式 */
  deepUnlock: boolean;
  /** 应用矩阵价格折扣系数（1 = 无折扣） */
  appDiscount: number;
}

export const MEMBERSHIP_PLANS: readonly MembershipPlan[] = [
  {
    tier: 'pro',
    packKey: 'pro-monthly',
    amountFen: 3900,
    days: 31,
    asrFreeMinutesPerMonth: 2000,
    monthlyGrant: 800,
    deepUnlock: true,
    appDiscount: 1,
  },
  {
    tier: 'max',
    packKey: 'max-monthly',
    amountFen: 7900,
    days: 31,
    asrFreeMinutesPerMonth: 6000,
    monthlyGrant: 2000,
    deepUnlock: true,
    appDiscount: 0.8,
  },
] as const;

/** 按 tier 查会员档；free 档没有计划（无记录即免费），返回 undefined */
export function getMembershipPlan(tier: MembershipTier): MembershipPlan | undefined {
  return MEMBERSHIP_PLANS.find((plan) => plan.tier === tier);
}

/** 按下单 packKey 查会员档；非会员 key 返回 undefined */
export function getMembershipPlanByPackKey(packKey: string): MembershipPlan | undefined {
  return MEMBERSHIP_PLANS.find((plan) => plan.packKey === packKey);
}

/** 可支付条目：积分包或会员档（/api/pay/recharge 的统一入参解析） */
export type PayableItem =
  | { kind: 'points'; pack: RechargePack }
  | { kind: 'membership'; plan: MembershipPlan };

/** 查可支付条目；非法 key 返回 undefined（调用方按 400 处理） */
export function getPayableItem(packKey: string): PayableItem | undefined {
  const pack = getRechargePack(packKey);
  if (pack) return { kind: 'points', pack };
  const plan = getMembershipPlanByPackKey(packKey);
  if (plan) return { kind: 'membership', plan };
  return undefined;
}
