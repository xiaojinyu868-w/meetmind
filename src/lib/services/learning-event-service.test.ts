/**
 * learning-event-service 单测 —— 学习记忆事件管道（P0）
 *
 * 覆盖：
 * - appendLearningEvent：zod 校验拒绝、idempotencyKey 撞 unique 静默返回已有
 * - processLearningEvent：activity 事件合并进 recentLearningActivities、
 *   对话事件经蒸馏合并进 memories（含 replaceId 更新）、同事件重放不双写
 * - 蒸馏失败降级：distill 返回 [] 时画像不动，事件仍在表内
 * - triggerLearningEventProcessing：同一用户串行处理、处理失败不炸队列
 *
 * 实现：内存版 prisma fake（learningEvent 表 + user 表 + idempotencyKey 唯一约束），
 * 蒸馏服务整体 mock —— 单测只验证服务层编排逻辑，不验证 prisma / LLM 本身。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEvent {
  id: string;
  userId: string;
  appId: string;
  type: string;
  payloadJson: string;
  sourceId: string | null;
  idempotencyKey: string | null;
  occurredAt: Date;
  createdAt: Date;
}

interface FakeUser {
  id: string;
  learnerProfileJson: string | null;
}

function p2002(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

const fake = vi.hoisted(() => {
  const events: FakeEvent[] = [];
  const users = new Map<string, FakeUser>();
  let tick = 0;

  const learningEvent = {
    create: vi.fn(async ({ data }: { data: Omit<FakeEvent, 'id' | 'createdAt'> }) => {
      if (data.idempotencyKey && events.some((event) => event.idempotencyKey === data.idempotencyKey)) {
        throw p2002();
      }
      tick += 1;
      const event: FakeEvent = { ...data, id: `evt-${tick}`, createdAt: new Date() };
      events.push(event);
      return event;
    }),
    findUnique: vi.fn(async ({ where }: { where: { idempotencyKey?: string } }) => (
      events.find((event) => event.idempotencyKey === where.idempotencyKey) ?? null
    )),
  };

  const user = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { learnerProfileJson: string } }) => {
      const existing = users.get(where.id);
      if (!existing) throw new Error('user not found');
      existing.learnerProfileJson = data.learnerProfileJson;
      return existing;
    }),
  };

  return {
    prisma: { learningEvent, user },
    events,
    users,
    reset() {
      events.length = 0;
      users.clear();
      tick = 0;
      learningEvent.create.mockClear();
      learningEvent.findUnique.mockClear();
      user.findUnique.mockClear();
      user.update.mockClear();
    },
    profileOf(userId: string) {
      const json = users.get(userId)?.learnerProfileJson;
      return json ? JSON.parse(json) as {
        memories?: Array<{ id: string; title: string; sourceId?: string }>;
        recentLearningActivities?: Array<{ id: string; title: string; sourceId?: string }>;
      } : null;
    },
  };
});

const distillMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ default: fake.prisma }));
vi.mock('@/lib/services/learning-memory-distillation-service', () => ({
  distillLearningMemories: distillMock,
}));

import {
  appendLearningEvent,
  processLearningEvent,
  triggerLearningEventProcessing,
} from './learning-event-service';

const USER_ID = 'user-1';

function seedUser(profile?: Record<string, unknown>) {
  fake.users.set(USER_ID, {
    id: USER_ID,
    learnerProfileJson: JSON.stringify(profile ?? { stage: 'university' }),
  });
}

function activityInput(idempotencyKey?: string) {
  return {
    appId: 'classroom',
    type: 'activity' as const,
    payload: { v: 1 as const, kind: 'lesson' as const, title: '贝叶斯定理入门', sessionId: 'sess-1', appKey: 'classroom' },
    sourceId: 'lesson-understanding:cap-1',
    idempotencyKey,
  };
}

function conversationInput(idempotencyKey?: string) {
  return {
    appId: 'global-ask',
    type: 'confusion' as const,
    payload: { v: 1 as const, userText: '我还是不懂机会成本', assistantText: '机会成本是……' },
    sourceId: 'conv-1',
    idempotencyKey,
  };
}

beforeEach(() => {
  fake.reset();
  distillMock.mockReset();
  seedUser();
});

describe('appendLearningEvent', () => {
  it('落事件并返回记录', async () => {
    const event = await appendLearningEvent(USER_ID, conversationInput('global-understanding:conv-1'));

    expect(event?.userId).toBe(USER_ID);
    expect(event?.type).toBe('confusion');
    expect(fake.events).toHaveLength(1);
  });

  it('幂等键冲突静默返回已有事件，不重复落库', async () => {
    const first = await appendLearningEvent(USER_ID, conversationInput('global-understanding:conv-1'));
    const second = await appendLearningEvent(USER_ID, conversationInput('global-understanding:conv-1'));

    expect(second?.id).toBe(first?.id);
    expect(fake.events).toHaveLength(1);
    expect(fake.prisma.learningEvent.create).toHaveBeenCalledTimes(2);
  });

  it('载荷非法时拒绝落库', async () => {
    const event = await appendLearningEvent(USER_ID, {
      ...conversationInput(),
      payload: { v: 1, userText: '', assistantText: '' },
    });

    expect(event).toBeNull();
    expect(fake.events).toHaveLength(0);
  });
});

describe('processLearningEvent', () => {
  it('activity 事件合并进最近学习活动，重放不双写', async () => {
    const event = (await appendLearningEvent(USER_ID, activityInput('lesson-understanding:cap-1')))!;

    await processLearningEvent(event);
    await processLearningEvent(event); // 重放同一事件

    const profile = fake.profileOf(USER_ID);
    expect(profile?.recentLearningActivities).toHaveLength(1);
    expect(profile?.recentLearningActivities?.[0].title).toBe('贝叶斯定理入门');
    expect(profile?.recentLearningActivities?.[0].sourceId).toBe('lesson-understanding:cap-1');
  });

  it('对话事件经蒸馏新增长期记忆，sourceId 幂等', async () => {
    distillMock.mockResolvedValue([{ kind: 'challenge', title: '机会成本概念不清', detail: '混淆隐性成本' }]);
    const event = (await appendLearningEvent(USER_ID, conversationInput()))!;

    await processLearningEvent(event);
    await processLearningEvent(event);

    const profile = fake.profileOf(USER_ID);
    expect(profile?.memories).toHaveLength(1);
    expect(profile?.memories?.[0].title).toBe('机会成本概念不清');
    expect(distillMock).toHaveBeenCalledTimes(2);
  });

  it('蒸馏返回 replaceId 时更新既有记忆', async () => {
    seedUser({
      stage: 'university',
      memories: [{
        id: 'mem-old',
        kind: 'challenge',
        title: '概率基础薄弱',
        status: 'active',
        source: 'ai',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }],
    });
    distillMock.mockResolvedValue([{ kind: 'challenge', title: '条件概率理解偏差', replaceId: 'mem-old' }]);
    const event = (await appendLearningEvent(USER_ID, conversationInput()))!;

    await processLearningEvent(event);

    const profile = fake.profileOf(USER_ID);
    expect(profile?.memories).toHaveLength(1);
    expect(profile?.memories?.[0].id).toBe('mem-old');
    expect(profile?.memories?.[0].title).toBe('条件概率理解偏差');
  });

  it('蒸馏失败（空结果）时画像不动，事件仍在表内', async () => {
    distillMock.mockResolvedValue([]);
    const event = (await appendLearningEvent(USER_ID, conversationInput()))!;

    await processLearningEvent(event);

    expect(fake.profileOf(USER_ID)?.memories ?? []).toHaveLength(0);
    expect(fake.events).toHaveLength(1);
    expect(fake.prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('用户不存在只记日志不抛错', async () => {
    const event = (await appendLearningEvent(USER_ID, activityInput()))!;
    fake.users.clear();

    await expect(processLearningEvent(event)).resolves.toBeUndefined();
  });
});

describe('triggerLearningEventProcessing', () => {
  it('同一用户的事件按顺序串行处理', async () => {
    const first = (await appendLearningEvent(USER_ID, {
      ...activityInput(),
      payload: { v: 1, kind: 'lesson', title: '第一节课' },
      sourceId: 'lesson-understanding:cap-1',
    }))!;
    const second = (await appendLearningEvent(USER_ID, {
      ...activityInput(),
      payload: { v: 1, kind: 'lesson', title: '第二节课' },
      sourceId: 'lesson-understanding:cap-2',
    }))!;

    await Promise.all([
      triggerLearningEventProcessing(first),
      triggerLearningEventProcessing(second),
    ]);

    const profile = fake.profileOf(USER_ID);
    expect(profile?.recentLearningActivities?.map((item) => item.title)).toEqual(['第一节课', '第二节课']);
  });

  it('处理失败不炸掉后续队列', async () => {
    const bad = (await appendLearningEvent(USER_ID, activityInput()))!;
    const good = (await appendLearningEvent(USER_ID, {
      ...activityInput(),
      sourceId: 'lesson-understanding:cap-2',
      payload: { v: 1, kind: 'lesson', title: '后续事件' },
    }))!;
    // bad 的画像写回失败一次：trigger 内部 catch 记日志，good 仍正常处理
    fake.prisma.user.update.mockRejectedValueOnce(new Error('db down'));

    await triggerLearningEventProcessing(bad);
    await triggerLearningEventProcessing(good);

    const profile = fake.profileOf(USER_ID);
    expect(profile?.recentLearningActivities?.map((item) => item.title)).toEqual(['后续事件']);
  });
});
