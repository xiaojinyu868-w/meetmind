/**
 * point-account-service 单测 —— 积分机制 Phase 2：真扣费
 *
 * 覆盖：
 * - 懒建账户 + 欢迎积分（一次性幂等，面额见 POINTS_CONFIG.welcomeGrant）
 * - 每月活跃发放（按月幂等，YYYY-MM 本地时区）
 * - spendPoints 原子扣费：余额不足整体回滚、幂等键防重、balanceAfter 留痕
 * - 月成本熔断（≥ monthlyCostCapMilliYuan 毫元 → monthly_cost_cap）
 * - ASR 免费额度计算与结算（先吃当月免费分钟，超出按 asrPricePerMinute 积分/分钟）
 * - adjustPoints 管理端调账（不允许调成负余额）
 *
 * 实现：内存版 prisma fake（账户表 + 流水表 + idempotencyKey 唯一约束），
 * $transaction 直接同步执行回调 —— 单测只验证服务层编排逻辑，不验证 prisma 本身。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getMembershipPlan, POINTS_CONFIG } from '@/lib/config/pricing';

interface FakeAccount {
  userId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
}

interface FakeTransaction {
  userId: string;
  delta: number;
  kind: string;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  points: number;
  costMilliYuan: number;
  quantity: number | null;
  balanceAfter: number | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

function p2002(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function createFakePrisma() {
  const accounts = new Map<string, FakeAccount>();
  const transactions: FakeTransaction[] = [];
  const memberships = new Map<string, { userId: string; tier: string; expiresAt: Date }>();
  // 同毫秒创建的多条流水保持插入顺序（真实库 createdAt 精度足够，fake 用计数器模拟）
  let tick = 0;

  const pointAccount = {
    upsert: vi.fn(async ({ where, create }: { where: { userId: string }; create: { userId: string } }) => {
      const existing = accounts.get(where.userId);
      if (existing) return existing;
      const account: FakeAccount = { userId: create.userId, balance: 0, totalEarned: 0, totalSpent: 0 };
      accounts.set(account.userId, account);
      return account;
    }),
    findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => accounts.get(where.userId) ?? null),
    update: vi.fn(async ({ where, data }: {
      where: { userId: string };
      data: {
        balance?: number;
        totalEarned?: { increment: number };
        totalSpent?: { increment: number };
      };
    }) => {
      const account = accounts.get(where.userId);
      if (!account) throw new Error('account not found');
      if (typeof data.balance === 'number') account.balance = data.balance;
      if (data.totalEarned) account.totalEarned += data.totalEarned.increment;
      if (data.totalSpent) account.totalSpent += data.totalSpent.increment;
      return account;
    }),
  };

  const pointTransaction = {
    create: vi.fn(async ({ data }: { data: Omit<FakeTransaction, 'createdAt'> & { createdAt?: Date } }) => {
      if (data.idempotencyKey && transactions.some((tx) => tx.idempotencyKey === data.idempotencyKey)) {
        throw p2002();
      }
      const tx: FakeTransaction = {
        reason: null,
        refType: null,
        refId: null,
        points: 0,
        costMilliYuan: 0,
        quantity: null,
        balanceAfter: null,
        idempotencyKey: null,
        ...data,
        createdAt: data.createdAt ?? new Date(Date.now() + tick++),
      };
      transactions.push(tx);
      return tx;
    }),
    findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
      transactions.find((tx) => tx.idempotencyKey === where.idempotencyKey) ?? null),
    aggregate: vi.fn(async ({ _sum, where }: {
      _sum: Record<string, boolean>;
      where: { userId: string; kind?: string; refType?: string; createdAt?: { gte: Date } };
    }) => {
      const matched = transactions.filter((tx) =>
        tx.userId === where.userId
        && (!where.kind || tx.kind === where.kind)
        && (!where.refType || tx.refType === where.refType)
        && (!where.createdAt || tx.createdAt >= where.createdAt.gte));
      const result: Record<string, number | null> = {};
      if (_sum.costMilliYuan) result.costMilliYuan = matched.reduce((sum, tx) => sum + tx.costMilliYuan, 0);
      if (_sum.quantity) result.quantity = matched.reduce((sum, tx) => sum + (tx.quantity ?? 0), 0);
      return { _sum: result };
    }),
    findMany: vi.fn(async ({ where, take }: { where: { userId: string }; take: number }) =>
      transactions
        .filter((tx) => tx.userId === where.userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, take)),
  };

  const prisma = {
    pointAccount,
    pointTransaction,
    membership: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
        memberships.get(where.userId) ?? null),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ pointAccount, pointTransaction })),
  };

  return { prisma, accounts, transactions, memberships };
}

const fake = vi.hoisted(() => {
  // hoisted 占位，真正的 fake 在 beforeEach 里重建并赋值
  return { current: null as unknown as ReturnType<typeof createFakePrisma> };
});

vi.mock('@/lib/prisma', () => ({
  default: new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      return (fake.current.prisma as Record<string | symbol, unknown>)[prop];
    },
  }),
}));

import {
  adjustPoints,
  checkCanSpend,
  checkGuestDailyCost,
  currentMonthKey,
  currentMonthStart,
  getAsrFreeMinutesRemaining,
  getMonthlyCostMilliYuan,
  getOrCreateWithGrants,
  getSummary,
  settleAsrMinutes,
  spendPoints,
} from '@/lib/services/point-account-service';

beforeEach(() => {
  fake.current = createFakePrisma();
});

describe('getOrCreateWithGrants', () => {
  it('首次访问懒建账户：欢迎 + 当月发放，余额为两者之和', async () => {
    const view = await getOrCreateWithGrants('user_a');
    expect(view.balance).toBe(POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant);
    expect(view.totalEarned).toBe(POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant);

    const kinds = fake.current.transactions.map((tx) => `${tx.kind}:${tx.reason}`);
    expect(kinds).toEqual(['earn:welcome', 'earn:monthly']);
    const keys = fake.current.transactions.map((tx) => tx.idempotencyKey);
    expect(keys).toContain('grant:welcome:user_a');
    expect(keys).toContain(`grant:monthly:user_a:free:${currentMonthKey()}`);
    // 每笔发放都留 balanceAfter
    expect(fake.current.transactions[0].balanceAfter).toBe(POINTS_CONFIG.welcomeGrant);
    expect(fake.current.transactions[1].balanceAfter).toBe(
      POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant,
    );
  });

  it('幂等：重复访问不重复发放（欢迎与月度都只发一次）', async () => {
    await getOrCreateWithGrants('user_a');
    const view = await getOrCreateWithGrants('user_a');
    expect(view.balance).toBe(POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant);
    expect(fake.current.transactions).toHaveLength(2);
  });

  it('两个用户互不干扰', async () => {
    await getOrCreateWithGrants('user_a');
    const viewB = await getOrCreateWithGrants('user_b');
    expect(viewB.balance).toBe(POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant);
    expect(fake.current.transactions).toHaveLength(4);
  });
});

describe('spendPoints 原子扣费', () => {
  it('扣减余额并写流水（含 balanceAfter）', async () => {
    await getOrCreateWithGrants('user_a');
    const result = await spendPoints({
      userId: 'user_a',
      points: 2,
      reason: 'tutor:review',
      refType: 'tutor',
      refId: 'session_1',
      idempotencyKey: 'tutor-charge:session_1:m1:0',
    });
    expect(result).toMatchObject({
      ok: true,
      balanceAfter: POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant - 2,
    });
    const account = fake.current.accounts.get('user_a');
    expect(account?.balance).toBe(POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant - 2);
    expect(account?.totalSpent).toBe(2);
  });

  it('余额不足整体回滚：不写流水、不动余额', async () => {
    await getOrCreateWithGrants('user_a');
    // 把余额扣到 1
    fake.current.accounts.get('user_a')!.balance = 1;

    const txCountBefore = fake.current.transactions.length;
    const result = await spendPoints({
      userId: 'user_a',
      points: 2,
      reason: 'tutor:review',
      refType: 'tutor',
      idempotencyKey: 'tutor-charge:session_1:m2:0',
    });
    expect(result).toEqual({ ok: false, error: 'insufficient_points', balance: 1, required: 2 });
    expect(fake.current.transactions).toHaveLength(txCountBefore);
    expect(fake.current.accounts.get('user_a')?.balance).toBe(1);
  });

  it('幂等键防重：同一键重复扣费返回 duplicate，不二次扣减', async () => {
    await getOrCreateWithGrants('user_a');
    const input = {
      userId: 'user_a',
      points: 2,
      reason: 'tutor:review',
      refType: 'tutor',
      idempotencyKey: 'tutor-charge:session_1:m1:0',
    };
    const first = await spendPoints(input);
    const second = await spendPoints(input);
    const grants = POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant;
    expect(first).toMatchObject({ ok: true, balanceAfter: grants - 2 });
    expect(second).toMatchObject({ ok: true, duplicate: true, balanceAfter: grants - 2 });
    expect(fake.current.accounts.get('user_a')?.balance).toBe(grants - 2);
  });
});

describe('checkCanSpend 预检 + 熔断', () => {
  it('余额充足 → ok', async () => {
    const check = await checkCanSpend('user_a', 2);
    expect(check).toEqual({
      ok: true,
      balance: POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant,
    });
  });

  it('余额不足 → insufficient_points，带 balance/required', async () => {
    await getOrCreateWithGrants('user_a');
    fake.current.accounts.get('user_a')!.balance = 1;
    const check = await checkCanSpend('user_a', 2);
    expect(check).toEqual({ ok: false, error: 'insufficient_points', balance: 1, required: 2 });
  });

  it('当月真实成本 ≥ monthlyCostCapMilliYuan 毫元 → monthly_cost_cap（熔断优先于余额校验）', async () => {
    await getOrCreateWithGrants('user_a');
    fake.current.accounts.get('user_a')!.balance = 0; // 余额也不足，验证熔断优先
    await fake.current.prisma.pointTransaction.create({
      data: {
        userId: 'user_a',
        delta: 0,
        kind: 'spend',
        reason: 'tutor:review',
        refType: 'tutor',
        refId: null,
        points: 0,
        costMilliYuan: POINTS_CONFIG.monthlyCostCapMilliYuan,
        quantity: null,
        balanceAfter: null,
        idempotencyKey: 'shadow:big-cost',
      },
    });
    const check = await checkCanSpend('user_a', 2);
    expect(check).toEqual({ ok: false, error: 'monthly_cost_cap', balance: 0, required: 0 });
  });

  it('上月成本不计入当月熔断窗口', async () => {
    await getOrCreateWithGrants('user_a');
    const lastMonth = new Date(currentMonthStart().getTime() - 60_000);
    await fake.current.prisma.pointTransaction.create({
      data: {
        userId: 'user_a',
        delta: 0,
        kind: 'spend',
        reason: 'old',
        refType: 'tutor',
        refId: null,
        points: 0,
        costMilliYuan: 999_999,
        quantity: null,
        balanceAfter: null,
        idempotencyKey: 'shadow:old-cost',
        createdAt: lastMonth,
      },
    });
    expect(await getMonthlyCostMilliYuan('user_a')).toBe(0);
    const check = await checkCanSpend('user_a', 2);
    expect(check.ok).toBe(true);
  });
});

describe('ASR 免费额度与分钟结算', () => {
  it('免费额度：未用时等于当月免费分钟数', async () => {
    await getOrCreateWithGrants('user_a');
    expect(await getAsrFreeMinutesRemaining('user_a')).toBe(POINTS_CONFIG.asrFreeMinutesPerMonth);
  });

  it('免费额度内结算：quantity 记分钟、delta=0、不扣分', async () => {
    const grants = POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant;
    await getOrCreateWithGrants('user_a');
    const result = await settleAsrMinutes('user_a', 'conn_1', 5.2);
    expect(result).toMatchObject({
      settled: true,
      minutes: 6, // 向上取整
      freeMinutesApplied: 6,
      paidMinutes: 0,
      pointsCharged: 0,
      balanceAfter: grants,
    });
    expect(await getAsrFreeMinutesRemaining('user_a')).toBe(
      POINTS_CONFIG.asrFreeMinutesPerMonth - 6,
    );
    expect(fake.current.accounts.get('user_a')?.balance).toBe(grants);
  });

  it('超出免费额度：超出部分按 asrPricePerMinute 积分/分钟扣分', async () => {
    const grants = POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant;
    await getOrCreateWithGrants('user_a');
    await settleAsrMinutes('user_a', 'conn_1', POINTS_CONFIG.asrFreeMinutesPerMonth - 2);
    const result = await settleAsrMinutes('user_a', 'conn_2', 5);
    expect(result).toMatchObject({
      minutes: 5,
      freeMinutesApplied: 2,
      paidMinutes: 3,
      pointsCharged: 3 * POINTS_CONFIG.asrPricePerMinute,
      balanceAfter: grants - 3 * POINTS_CONFIG.asrPricePerMinute,
    });
    expect(await getAsrFreeMinutesRemaining('user_a')).toBe(0);
  });

  it('同一连接重复结算幂等（idempotencyKey asr:{userId}:{connectionId}）', async () => {
    await getOrCreateWithGrants('user_a');
    await settleAsrMinutes('user_a', 'conn_1', 10);
    const dup = await settleAsrMinutes('user_a', 'conn_1', 10);
    expect(dup.duplicate).toBe(true);
    expect(await getAsrFreeMinutesRemaining('user_a')).toBe(
      POINTS_CONFIG.asrFreeMinutesPerMonth - 10,
    );
  });

  it('付费分钟余额不足时按可用余额截断，不扣成负数', async () => {
    await getOrCreateWithGrants('user_a');
    fake.current.accounts.get('user_a')!.balance = 4;
    await settleAsrMinutes('user_a', 'conn_1', POINTS_CONFIG.asrFreeMinutesPerMonth); // 吃光免费额度
    const result = await settleAsrMinutes('user_a', 'conn_2', 10); // 10 分钟付费，需 10×单价 积分
    expect(result.pointsCharged).toBe(4);
    expect(fake.current.accounts.get('user_a')?.balance).toBe(0);
  });

  it('0 分钟不结算', async () => {
    await getOrCreateWithGrants('user_a');
    const result = await settleAsrMinutes('user_a', 'conn_1', 0);
    expect(result.settled).toBe(false);
    expect(fake.current.transactions.filter((tx) => tx.refType === 'asr')).toHaveLength(0);
  });
});

describe('adjustPoints 管理端调账', () => {
  it('正调：加余额并 kind=adjust 留痕', async () => {
    const grants = POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant;
    const result = await adjustPoints('user_a', 100, '补偿');
    expect(result).toMatchObject({ ok: true, balanceAfter: grants + 100 });
    const tx = fake.current.transactions.at(-1);
    expect(tx).toMatchObject({ kind: 'adjust', delta: 100, reason: '补偿', balanceAfter: grants + 100 });
  });

  it('负调不允许把余额调成负数', async () => {
    const grants = POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant;
    await getOrCreateWithGrants('user_a');
    const result = await adjustPoints('user_a', -9999, '误发回收');
    expect(result).toEqual({ ok: false, error: 'negative_balance', balance: grants });
    expect(fake.current.accounts.get('user_a')?.balance).toBe(grants);
  });
});

describe('getSummary 契约视图', () => {
  it('返回余额 / 累计 / 免费额度 / 熔断进度 / 最近 20 条流水', async () => {
    const grants = POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant;
    await getOrCreateWithGrants('user_a');
    await spendPoints({
      userId: 'user_a',
      points: 2,
      reason: 'tutor:review',
      refType: 'tutor',
      idempotencyKey: 'k1',
    });
    const summary = await getSummary('user_a');
    expect(summary.balance).toBe(grants - 2);
    expect(summary.totalEarned).toBe(grants);
    expect(summary.totalSpent).toBe(2);
    expect(summary.asrFreeMinutesRemaining).toBe(POINTS_CONFIG.asrFreeMinutesPerMonth);
    expect(summary.asrPricePerMinute).toBe(POINTS_CONFIG.asrPricePerMinute);
    expect(summary.monthCostCapMilliYuan).toBe(POINTS_CONFIG.monthlyCostCapMilliYuan);
    expect(summary.recentTransactions.length).toBeLessThanOrEqual(20);
    expect(summary.recentTransactions[0]).toMatchObject({ delta: -2, kind: 'spend', balanceAfter: grants - 2 });
  });
});

describe('checkGuestDailyCost（guest 日闸门）', () => {
  async function seedGuestCost(guestKey: string, costMilliYuan: number, createdAt?: Date) {
    await fake.current.prisma.pointTransaction.create({
      data: {
        userId: guestKey,
        delta: 0,
        kind: 'spend',
        reason: 'tutor:review',
        refType: 'tutor',
        refId: null,
        points: 0,
        costMilliYuan,
        quantity: null,
        balanceAfter: null,
        idempotencyKey: null,
        createdAt,
      },
    });
  }

  it('当日成本未到上限 → ok', async () => {
    await seedGuestCost('guest_1.2.3.4', 100);
    const result = await checkGuestDailyCost('guest_1.2.3.4');
    expect(result).toEqual({ ok: true, usedMilliYuan: 100 });
  });

  it('当日成本达到上限 → guest_daily_cap', async () => {
    await seedGuestCost('guest_1.2.3.4', POINTS_CONFIG.guestDailyCostCapMilliYuan);
    const result = await checkGuestDailyCost('guest_1.2.3.4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('guest_daily_cap');
  });

  it('昨天的成本不计入当日窗口；别的 guest 互不影响', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await seedGuestCost('guest_1.2.3.4', 999_999, yesterday);
    await seedGuestCost('guest_5.6.7.8', 999_999);
    const result = await checkGuestDailyCost('guest_1.2.3.4');
    expect(result).toEqual({ ok: true, usedMilliYuan: 0 });
  });
});

describe('会员档位配额（PR-B 权益接入）', () => {
  function seedMembership(userId: string, tier: string, expiresAt: Date) {
    fake.current.memberships.set(userId, { userId, tier, expiresAt });
  }

  it('pro 档月发放按档位面额；免费档不变', async () => {
    seedMembership('user_pro', 'pro', new Date(Date.now() + 86_400_000));
    const pro = await getOrCreateWithGrants('user_pro');
    expect(pro.balance).toBe(POINTS_CONFIG.welcomeGrant + getMembershipPlan('pro')!.monthlyGrant);

    const free = await getOrCreateWithGrants('user_free');
    expect(free.balance).toBe(POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant);
  });

  it('月中升档：幂等键带 tier 段，按新档全额再发一笔', async () => {
    await getOrCreateWithGrants('user_a'); // free 档已发
    seedMembership('user_a', 'max', new Date(Date.now() + 86_400_000));
    const view = await getOrCreateWithGrants('user_a');
    expect(view.balance).toBe(
      POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant + getMembershipPlan('max')!.monthlyGrant,
    );
  });

  it('过期会员按免费档发放与计额度', async () => {
    seedMembership('user_a', 'pro', new Date(Date.now() - 1000));
    const view = await getOrCreateWithGrants('user_a');
    expect(view.balance).toBe(POINTS_CONFIG.welcomeGrant + POINTS_CONFIG.monthlyGrant);
    expect(await getAsrFreeMinutesRemaining('user_a')).toBe(POINTS_CONFIG.asrFreeMinutesPerMonth);
  });

  it('max 档免费 ASR 分钟按档位计；summary 带 membership 字段', async () => {
    seedMembership('user_a', 'max', new Date(Date.now() + 86_400_000));
    await getOrCreateWithGrants('user_a');
    expect(await getAsrFreeMinutesRemaining('user_a')).toBe(
      getMembershipPlan('max')!.asrFreeMinutesPerMonth,
    );
    const summary = await getSummary('user_a');
    expect(summary.membership.tier).toBe('max');
    expect(typeof summary.membership.expiresAt).toBe('string');
  });
});
