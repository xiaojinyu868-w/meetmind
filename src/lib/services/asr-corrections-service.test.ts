// Corrections service 单测（stub Prisma）
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 必须在 import service 前 mock prisma
vi.mock('@/lib/prisma', () => {
  const createMock = vi.fn(async ({ data }: { data: unknown }) => ({ id: 'stub-id', ...(data as object) }));
  const correctionFindMany = vi.fn(async () => []);
  const hotwordFindMany = vi.fn(async () => []);
  const findUnique = vi.fn(async () => null);
  const update = vi.fn(async () => ({}));
  const updateMany = vi.fn(async () => ({ count: 0 }));
  return {
    prisma: {
      asrCorrection: { create: createMock, findMany: correctionFindMany, updateMany },
      asrHotword: { create: createMock, findUnique, update, findMany: hotwordFindMany },
    },
  };
});

// Get references to the mocks by re-importing
import { prisma } from '@/lib/prisma';
import {
  recordCorrection,
  aggregateHotwords,
  getHotwords,
} from './asr-corrections-service';

const mockAsr = prisma as unknown as {
  asrCorrection: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  asrHotword: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  mockAsr.asrCorrection.create.mockReset().mockImplementation(async ({ data }: { data: object }) => ({ id: 'cid-1', ...data }));
  mockAsr.asrCorrection.findMany.mockReset().mockResolvedValue([]);
  mockAsr.asrCorrection.updateMany.mockReset().mockResolvedValue({ count: 0 });
  mockAsr.asrHotword.create.mockReset().mockResolvedValue({ id: 'hid-1' });
  mockAsr.asrHotword.findUnique.mockReset().mockResolvedValue(null);
  mockAsr.asrHotword.update.mockReset().mockResolvedValue({});
  mockAsr.asrHotword.findMany.mockReset().mockResolvedValue([]);
});

describe('recordCorrection', () => {
  it('returns id for valid input', async () => {
    mockAsr.asrCorrection.create.mockResolvedValue({ id: 'cid-1' });
    const r = await recordCorrection({
      sessionId: 's1',
      userId: 'u1',
      wrongText: '梯度下将',
      correctedText: '梯度下降',
    });
    expect(r?.id).toBe('cid-1');
    expect(mockAsr.asrCorrection.create).toHaveBeenCalledOnce();
  });

  it('drops when wrongText === correctedText', async () => {
    const r = await recordCorrection({
      sessionId: 's1',
      wrongText: '一样',
      correctedText: '一样',
    });
    expect(r).toBeNull();
    expect(mockAsr.asrCorrection.create).not.toHaveBeenCalled();
  });

  it('drops empty input', async () => {
    const r = await recordCorrection({
      sessionId: 's1',
      wrongText: '   ',
      correctedText: 'x',
    });
    expect(r).toBeNull();
  });

  it('drops overly long input', async () => {
    const r = await recordCorrection({
      sessionId: 's1',
      wrongText: 'a'.repeat(200),
      correctedText: 'b'.repeat(200),
    });
    expect(r).toBeNull();
  });
});

describe('aggregateHotwords', () => {
  it('returns zero counts when no pending corrections', async () => {
    mockAsr.asrCorrection.findMany.mockResolvedValue([]);
    const r = await aggregateHotwords({ scope: 'user', id: 'u1' });
    expect(r).toEqual({ newlyCreated: 0, updated: 0, totalMarked: 0 });
  });

  it('creates new hotword when same correction appears >= min frequency', async () => {
    mockAsr.asrCorrection.findMany.mockResolvedValue([
      { id: 'c1', correctedText: '梯度下降', wrongText: '梯度下将' },
      { id: 'c2', correctedText: '梯度下降', wrongText: '梯度下讲' },
      { id: 'c3', correctedText: '其他', wrongText: '单次' }, // 单次不升级
    ]);
    mockAsr.asrHotword.findUnique.mockResolvedValue(null);

    const r = await aggregateHotwords({ scope: 'user', id: 'u1', minFrequency: 2 });
    expect(r.newlyCreated).toBe(1); // 只有"梯度下降"升级
    expect(r.updated).toBe(0);
    expect(r.totalMarked).toBe(2); // c1 + c2

    expect(mockAsr.asrHotword.create).toHaveBeenCalledOnce();
    const createArg = mockAsr.asrHotword.create.mock.calls[0][0];
    expect(createArg.data.term).toBe('梯度下降');
    expect(createArg.data.userId).toBe('u1');
    expect(createArg.data.weight).toBe(2);
  });

  it('updates existing hotword weight', async () => {
    mockAsr.asrCorrection.findMany.mockResolvedValue([
      { id: 'c1', correctedText: 'Kubernetes', wrongText: 'coober' },
      { id: 'c2', correctedText: 'Kubernetes', wrongText: 'kube' },
    ]);
    // findMany on asrHotword returns existing rows in batch (N+1 avoidance)
    mockAsr.asrHotword.findMany.mockResolvedValue([
      { id: 'h1', term: 'Kubernetes', weight: 3, aliases: null },
    ]);

    const r = await aggregateHotwords({ scope: 'user', id: 'u1', minFrequency: 2 });
    expect(r.updated).toBe(1);
    expect(mockAsr.asrHotword.update).toHaveBeenCalledOnce();
    const updateArg = mockAsr.asrHotword.update.mock.calls[0][0];
    expect(updateArg.data.weight).toBe(5); // 3 + 2
  });
});

describe('getHotwords', () => {
  it('returns empty for no owner', async () => {
    const r = await getHotwords({});
    expect(r).toEqual([]);
    expect(mockAsr.asrHotword.findMany).not.toHaveBeenCalled();
  });

  it('queries by userId with default limit', async () => {
    mockAsr.asrHotword.findMany.mockResolvedValue([
      { term: 'Kubernetes' },
      { term: 'Istio' },
    ]);
    const r = await getHotwords({ userId: 'u1' });
    expect(r).toEqual(['Kubernetes', 'Istio']);
    expect(mockAsr.asrHotword.findMany).toHaveBeenCalledOnce();
    const arg = mockAsr.asrHotword.findMany.mock.calls[0][0];
    expect(arg.where.userId).toBe('u1');
    expect(arg.take).toBe(20);
  });

  it('uses workspaceId when provided', async () => {
    mockAsr.asrHotword.findMany.mockResolvedValue([]);
    await getHotwords({ workspaceId: 'w1', limit: 5 });
    const arg = mockAsr.asrHotword.findMany.mock.calls[0][0];
    expect(arg.where.workspaceId).toBe('w1');
    expect(arg.take).toBe(5);
  });
});
