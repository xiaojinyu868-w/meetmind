/**
 * recharge-order-service 单测 —— 积分充值（微信 Native 扫码支付）
 *
 * 覆盖：
 * - createRechargeOrder：非法 packKey 拒绝 / 微信支付未配置 503 / 正常下单落 pending（+30min 过期）
 *   / 微信下单失败订单置 failed
 * - markOrderPaidAndGrant：正常到账（订单 paid + 余额 + 流水）、重复回调幂等（duplicate 不重复加余额）、
 *   金额不一致拒绝（防伪造）、微信确认的本地过期单放行到账、failed 终态拒绝、订单不存在拒绝
 * - getOrderForUser：只能查自己的订单、超期 pending 惰性置 expired
 *
 * 实现：内存版 prisma fake（订单表 + 账户表 + 流水表 + 唯一约束），$transaction 同步执行回调；
 * 微信下单/客服推送整体 mock 掉——单测只验证订单编排与到账幂等逻辑。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MEMBERSHIP_PLANS, RECHARGE_PACKS } from '@/lib/config/pricing';

interface FakeOrder {
  id: string;
  outTradeNo: string;
  userId: string;
  packKey: string;
  amountFen: number;
  points: number;
  status: string;
  wxTransactionId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  expiredAt: Date;
}

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
  balanceAfter: number | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

interface FakeMembership {
  userId: string;
  tier: string;
  expiresAt: Date;
  sourceOutTradeNo: string | null;
}

function p2002(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function createFakePrisma() {
  const orders = new Map<string, FakeOrder>();
  const accounts = new Map<string, FakeAccount>();
  const transactions: FakeTransaction[] = [];
  const memberships = new Map<string, FakeMembership>();
  let tick = 0;

  const rechargeOrder = {
    create: vi.fn(async ({ data }: { data: Omit<FakeOrder, 'id' | 'createdAt' | 'wxTransactionId' | 'paidAt'> & Partial<FakeOrder> }) => {
      if (orders.has(data.outTradeNo)) throw p2002();
      const order: FakeOrder = {
        id: `order_${orders.size + 1}`,
        wxTransactionId: null,
        paidAt: null,
        createdAt: new Date(),
        ...data,
      };
      orders.set(order.outTradeNo, order);
      return order;
    }),
    findUnique: vi.fn(async ({ where }: { where: { outTradeNo: string } }) =>
      orders.get(where.outTradeNo) ?? null),
    update: vi.fn(async ({ where, data }: { where: { outTradeNo: string }; data: Partial<FakeOrder> }) => {
      const order = orders.get(where.outTradeNo);
      if (!order) throw new Error('order not found');
      Object.assign(order, data);
      return order;
    }),
    updateMany: vi.fn(async ({ where, data }: {
      where: { outTradeNo: string; status?: string | { in: string[] } };
      data: Partial<FakeOrder>;
    }) => {
      const order = orders.get(where.outTradeNo);
      const statusMatch = !where.status
        || (typeof where.status === 'string'
          ? order?.status === where.status
          : where.status.in.includes(order?.status ?? ''));
      if (!order || !statusMatch) return { count: 0 };
      Object.assign(order, data);
      return { count: 1 };
    }),
  };

  const membership = {
    findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
      memberships.get(where.userId) ?? null),
    upsert: vi.fn(async ({ where, create, update }: {
      where: { userId: string };
      create: FakeMembership;
      update: Partial<FakeMembership>;
    }) => {
      const existing = memberships.get(where.userId);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      memberships.set(where.userId, { sourceOutTradeNo: null, ...create });
      return memberships.get(where.userId);
    }),
  };

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
      data: { balance?: number; totalEarned?: { increment: number }; totalSpent?: { increment: number } };
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
  };

  const authProvider = {
    findFirst: vi.fn(async () => null),
  };

  const prisma = {
    rechargeOrder,
    pointAccount,
    pointTransaction,
    authProvider,
    membership,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ rechargeOrder, pointAccount, pointTransaction, authProvider, membership })),
  };

  return { prisma, orders, accounts, transactions, memberships };
}

const fake = vi.hoisted(() => {
  // hoisted 占位，真正的 fake 在 beforeEach 里重建并赋值
  return { current: null as unknown as ReturnType<typeof createFakePrisma> };
});

// 微信支付 mock：configured 控制 isWechatPayConfigured，failOrder 模拟下单失败，
// queryResult 控制主动查单（queryNativeOrder）返回
const wxpay = vi.hoisted(() => ({
  configured: true,
  failOrder: null as Error | null,
  queryResult: null as null | {
    tradeState: string;
    transactionId: string;
    amountFen: number;
    mchid: string;
    successTime?: string;
  },
}));

vi.mock('@/lib/prisma', () => ({
  default: new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      return (fake.current.prisma as Record<string | symbol, unknown>)[prop];
    },
  }),
}));

vi.mock('@/lib/services/wechat-pay-service', () => ({
  isWechatPayConfigured: () => wxpay.configured,
  createNativeOrder: vi.fn(async () => {
    if (wxpay.failOrder) throw wxpay.failOrder;
    return { codeUrl: 'weixin://wxpay/bizpayurl?pr=mock' };
  }),
  queryNativeOrder: vi.fn(async () => wxpay.queryResult),
}));

vi.mock('@/lib/services/wechat-agent-service', () => ({
  pushWechatCustomerText: vi.fn(async () => true),
}));

import {
  AmountMismatchError,
  createRechargeOrder,
  getOrderForUser,
  InvalidRechargePackError,
  markOrderPaidAndGrant,
  OrderNotFoundError,
  OrderNotPayableError,
  PayUnavailableError,
  syncOrderFromWeChat,
} from '@/lib/services/recharge-order-service';

const PACK = RECHARGE_PACKS[1]; // standard 档（面额以 pricing.ts 为准）

beforeEach(() => {
  fake.current = createFakePrisma();
  wxpay.configured = true;
  wxpay.failOrder = null;
  wxpay.queryResult = null;
  process.env.WECHAT_PAY_NOTIFY_URL = 'https://capture.example.com/api/wechat/pay-notify';
  process.env.WECHAT_PAY_MCHID = 'mch_test';
});

describe('createRechargeOrder', () => {
  it('非法 packKey → InvalidRechargePackError（路由归一 400）', async () => {
    await expect(createRechargeOrder('user_a', 'nonexistent')).rejects.toBeInstanceOf(InvalidRechargePackError);
    expect(fake.current.orders.size).toBe(0);
  });

  it('微信支付未配置 → PayUnavailableError（路由归一 503），不落订单', async () => {
    wxpay.configured = false;
    await expect(createRechargeOrder('user_a', PACK.key)).rejects.toBeInstanceOf(PayUnavailableError);
    expect(fake.current.orders.size).toBe(0);
  });

  it('正常下单：返回 codeUrl/金额/积分快照，订单 pending 且 +30min 过期', async () => {
    const before = Date.now();
    const result = await createRechargeOrder('user_a', PACK.key);
    expect(result.codeUrl).toContain('weixin://');
    expect(result.amountFen).toBe(PACK.amountFen);
    expect(result.points).toBe(PACK.points);
    expect(result.outTradeNo.length).toBeLessThanOrEqual(32);

    const order = fake.current.orders.get(result.outTradeNo);
    expect(order).toMatchObject({ userId: 'user_a', packKey: PACK.key, status: 'pending' });
    const ttlMs = order!.expiredAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(29 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(31 * 60_000);
  });

  it('微信下单失败 → PayUnavailableError，订单置 failed 留痕', async () => {
    wxpay.failOrder = new Error('wx boom');
    await expect(createRechargeOrder('user_a', PACK.key)).rejects.toBeInstanceOf(PayUnavailableError);
    const order = [...fake.current.orders.values()][0];
    expect(order.status).toBe('failed');
  });
});

describe('markOrderPaidAndGrant', () => {
  async function seedOrder(userId = 'user_a') {
    const { outTradeNo } = await createRechargeOrder(userId, PACK.key);
    return outTradeNo;
  }

  it('正常到账：订单 paid + 写 earn 流水（balanceAfter）+ 余额/累计增加', async () => {
    const outTradeNo = await seedOrder();
    const result = await markOrderPaidAndGrant({
      outTradeNo,
      wxTransactionId: 'wx_txn_1',
      amountFen: PACK.amountFen,
      transactionTime: '2026-08-15T07:00:00.000Z',
    });
    expect(result).toMatchObject({ ok: true, userId: 'user_a', points: PACK.points, balanceAfter: PACK.points });
    expect(result.duplicate).toBeUndefined();

    const order = fake.current.orders.get(outTradeNo);
    expect(order).toMatchObject({ status: 'paid', wxTransactionId: 'wx_txn_1' });
    expect(order!.paidAt).toEqual(new Date('2026-08-15T07:00:00.000Z'));

    const account = fake.current.accounts.get('user_a');
    expect(account).toMatchObject({ balance: PACK.points, totalEarned: PACK.points });

    const tx = fake.current.transactions.at(-1);
    expect(tx).toMatchObject({
      userId: 'user_a',
      delta: PACK.points,
      kind: 'earn',
      reason: 'recharge',
      refType: 'recharge',
      refId: outTradeNo,
      points: PACK.points,
      balanceAfter: PACK.points,
      idempotencyKey: `recharge:${outTradeNo}`,
    });
  });

  it('重复回调幂等：duplicate 成功，余额不重复加', async () => {
    const outTradeNo = await seedOrder();
    const input = { outTradeNo, wxTransactionId: 'wx_txn_1', amountFen: PACK.amountFen };
    const first = await markOrderPaidAndGrant(input);
    const second = await markOrderPaidAndGrant(input);
    expect(first.duplicate).toBeUndefined();
    expect(second).toMatchObject({ ok: true, duplicate: true });
    expect(fake.current.accounts.get('user_a')?.balance).toBe(PACK.points);
    expect(fake.current.transactions.filter((tx) => tx.refType === 'recharge')).toHaveLength(1);
  });

  it('金额与快照不一致 → AmountMismatchError 拒绝，订单仍 pending、无流水', async () => {
    const outTradeNo = await seedOrder();
    await expect(
      markOrderPaidAndGrant({ outTradeNo, wxTransactionId: 'wx_txn_x', amountFen: 1 }),
    ).rejects.toBeInstanceOf(AmountMismatchError);
    expect(fake.current.orders.get(outTradeNo)?.status).toBe('pending');
    expect(fake.current.transactions).toHaveLength(0);
    expect(fake.current.accounts.size).toBe(0);
  });

  it('本地已过期但微信确认 SUCCESS → 正常到账（expired 只是二维码有效期，用户的钱不能丢）', async () => {
    const outTradeNo = await seedOrder();
    fake.current.orders.get(outTradeNo)!.expiredAt = new Date(Date.now() - 1000);
    fake.current.orders.get(outTradeNo)!.status = 'expired';
    const result = await markOrderPaidAndGrant({
      outTradeNo,
      wxTransactionId: 'wx_txn_1',
      amountFen: PACK.amountFen,
    });
    expect(result).toMatchObject({ ok: true, userId: 'user_a', points: PACK.points });
    expect(fake.current.orders.get(outTradeNo)?.status).toBe('paid');
    expect(fake.current.accounts.get('user_a')?.balance).toBe(PACK.points);
  });

  it('failed 终态（下单失败）→ OrderNotPayableError 拒绝，不到账', async () => {
    const outTradeNo = await seedOrder();
    fake.current.orders.get(outTradeNo)!.status = 'failed';
    await expect(
      markOrderPaidAndGrant({ outTradeNo, wxTransactionId: 'wx_txn_1', amountFen: PACK.amountFen }),
    ).rejects.toBeInstanceOf(OrderNotPayableError);
    expect(fake.current.accounts.size).toBe(0);
  });

  it('P2002 并发兜底：流水查不到时回查订单拿 userId（会员档无流水，通知不能丢）', async () => {
    const outTradeNo = await seedOrder();
    // 模拟并发重推：流水写入撞幂等键 P2002，但流水表查不到（极端可见性竞态）
    fake.current.prisma.pointTransaction.create = vi.fn(async () => {
      throw p2002();
    });
    const result = await markOrderPaidAndGrant({
      outTradeNo,
      wxTransactionId: 'wx_txn_1',
      amountFen: PACK.amountFen,
    });
    expect(result).toMatchObject({ ok: true, duplicate: true, userId: 'user_a' });
  });

  it('订单不存在 → OrderNotFoundError（路由 404，微信继续重试）', async () => {
    await expect(
      markOrderPaidAndGrant({ outTradeNo: 'R_missing', wxTransactionId: 'wx_txn_1', amountFen: 100 }),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it('用户首次接触积分体系就是充值：事务内 upsert 兜底建账户', async () => {
    const outTradeNo = await seedOrder('user_new');
    const result = await markOrderPaidAndGrant({
      outTradeNo,
      wxTransactionId: 'wx_txn_1',
      amountFen: PACK.amountFen,
    });
    expect(result.ok).toBe(true);
    expect(fake.current.accounts.get('user_new')?.balance).toBe(PACK.points);
  });
});

describe('会员档订单（pro-monthly / max-monthly）', () => {
  const PLAN = MEMBERSHIP_PLANS[0]; // pro 档（面额以 pricing.ts 为准）

  it('创建会员档订单：points 快照为 0，返回 membership 信息', async () => {
    const result = await createRechargeOrder('user_a', PLAN.packKey);
    expect(result).toMatchObject({
      amountFen: PLAN.amountFen,
      points: 0,
      membership: { tier: PLAN.tier, days: PLAN.days },
    });
    expect(fake.current.orders.get(result.outTradeNo)).toMatchObject({
      packKey: PLAN.packKey,
      points: 0,
      status: 'pending',
    });
  });

  it('会员到账：写 Membership（≈now+31 天），不动积分余额、不写流水', async () => {
    const { outTradeNo } = await createRechargeOrder('user_a', PLAN.packKey);
    const before = Date.now();
    const result = await markOrderPaidAndGrant({
      outTradeNo,
      wxTransactionId: 'wx_txn_1',
      amountFen: PLAN.amountFen,
    });
    expect(result.ok).toBe(true);
    expect(result.membership?.tier).toBe(PLAN.tier);
    const expiresAt = result.membership!.expiresAt.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + PLAN.days * 86_400_000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + PLAN.days * 86_400_000 + 1000);
    expect(fake.current.orders.get(outTradeNo)?.status).toBe('paid');
    expect(fake.current.accounts.size).toBe(0);
    expect(fake.current.transactions).toHaveLength(0);
  });

  it('续期叠加：现有未到期时长不吞，从现有 expiresAt 起加天数', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000);
    fake.current.memberships.set('user_a', {
      userId: 'user_a',
      tier: 'pro',
      expiresAt: future,
      sourceOutTradeNo: null,
    });
    const { outTradeNo } = await createRechargeOrder('user_a', PLAN.packKey);
    const result = await markOrderPaidAndGrant({
      outTradeNo,
      wxTransactionId: 'wx_txn_1',
      amountFen: PLAN.amountFen,
    });
    expect(result.membership!.expiresAt.getTime()).toBe(
      future.getTime() + PLAN.days * 86_400_000,
    );
  });

  it('重复回调幂等：duplicate 成功，expiresAt 不重复叠加', async () => {
    const { outTradeNo } = await createRechargeOrder('user_a', PLAN.packKey);
    const input = { outTradeNo, wxTransactionId: 'wx_txn_1', amountFen: PLAN.amountFen };
    const first = await markOrderPaidAndGrant(input);
    const second = await markOrderPaidAndGrant(input);
    expect(first.duplicate).toBeUndefined();
    expect(second).toMatchObject({ ok: true, duplicate: true });
    expect(fake.current.memberships.get('user_a')!.expiresAt.getTime()).toBe(
      first.membership!.expiresAt.getTime(),
    );
  });
});

describe('syncOrderFromWeChat（主动查单兑账，回调的第二通道）', () => {
  function mockWechatQuery(tradeState: string, amountFen = PACK.amountFen, mchid = 'mch_test') {
    wxpay.queryResult = {
      tradeState,
      transactionId: 'wx_txn_q1',
      amountFen,
      mchid,
      successTime: '2026-08-15T23:56:38+08:00',
    };
  }

  it('pending 订单 + 微信 SUCCESS → 兑账到账（积分 + 流水 + paid）', async () => {
    const { outTradeNo } = await createRechargeOrder('user_a', PACK.key);
    mockWechatQuery('SUCCESS');
    const result = await syncOrderFromWeChat(outTradeNo);
    expect(result).toMatchObject({ ok: true, userId: 'user_a', points: PACK.points });
    expect(fake.current.orders.get(outTradeNo)).toMatchObject({
      status: 'paid',
      wxTransactionId: 'wx_txn_q1',
    });
    expect(fake.current.accounts.get('user_a')?.balance).toBe(PACK.points);
    expect(fake.current.transactions.at(-1)).toMatchObject({
      kind: 'earn',
      reason: 'recharge',
      idempotencyKey: `recharge:${outTradeNo}`,
    });
  });

  it('本地已 expired 但微信 SUCCESS → 仍然兑账（用户的钱不能丢）', async () => {
    const { outTradeNo } = await createRechargeOrder('user_a', PACK.key);
    fake.current.orders.get(outTradeNo)!.status = 'expired';
    mockWechatQuery('SUCCESS');
    const result = await syncOrderFromWeChat(outTradeNo);
    expect(result?.ok).toBe(true);
    expect(fake.current.accounts.get('user_a')?.balance).toBe(PACK.points);
  });

  it('微信侧未支付（NOTPAY）→ null，订单与余额不动', async () => {
    const { outTradeNo } = await createRechargeOrder('user_a', PACK.key);
    mockWechatQuery('NOTPAY');
    expect(await syncOrderFromWeChat(outTradeNo)).toBeNull();
    expect(fake.current.orders.get(outTradeNo)?.status).toBe('pending');
    expect(fake.current.accounts.size).toBe(0);
  });

  it('金额/mchid 与快照不一致 → null 拒绝兑账并留痕', async () => {
    const { outTradeNo } = await createRechargeOrder('user_a', PACK.key);
    mockWechatQuery('SUCCESS', PACK.amountFen + 100);
    expect(await syncOrderFromWeChat(outTradeNo)).toBeNull();
    mockWechatQuery('SUCCESS', PACK.amountFen, 'other_mch');
    expect(await syncOrderFromWeChat(outTradeNo)).toBeNull();
    expect(fake.current.accounts.size).toBe(0);
    expect(fake.current.orders.get(outTradeNo)?.status).toBe('pending');
  });

  it('已 paid → duplicate 幂等；微信侧查无此单（query null）→ null', async () => {
    const { outTradeNo } = await createRechargeOrder('user_a', PACK.key);
    mockWechatQuery('SUCCESS');
    await syncOrderFromWeChat(outTradeNo);
    const dup = await syncOrderFromWeChat(outTradeNo);
    expect(dup).toMatchObject({ ok: true, duplicate: true });
    expect(fake.current.accounts.get('user_a')?.balance).toBe(PACK.points);

    const other = await createRechargeOrder('user_a', PACK.key);
    wxpay.queryResult = null;
    expect(await syncOrderFromWeChat(other.outTradeNo)).toBeNull();
  });
});

describe('getOrderForUser', () => {
  it('只能查自己的订单；他人订单按 not_found 处理', async () => {
    const { outTradeNo } = await createRechargeOrder('user_a', PACK.key);
    const mine = await getOrderForUser(outTradeNo, 'user_a');
    expect(mine).toMatchObject({ status: 'pending', points: PACK.points, amountFen: PACK.amountFen, packKey: PACK.key });
    expect(await getOrderForUser(outTradeNo, 'user_b')).toBeNull();
    expect(await getOrderForUser('R_missing', 'user_a')).toBeNull();
  });

  it('超期 pending 惰性置 expired', async () => {
    const { outTradeNo } = await createRechargeOrder('user_a', PACK.key);
    fake.current.orders.get(outTradeNo)!.expiredAt = new Date(Date.now() - 1000);
    const view = await getOrderForUser(outTradeNo, 'user_a');
    expect(view?.status).toBe('expired');
    expect(fake.current.orders.get(outTradeNo)?.status).toBe('expired');
  });
});
