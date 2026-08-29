/**
 * thread-store 单测：prisma 用内存 mock，事件日志写到临时目录
 * （FENSHEN_EVENT_LOG_DIR 在模块加载时读取，用 vi.hoisted 提前注入）。
 */

import { rm } from 'node:fs/promises';
import { afterAll, describe, expect, it, vi } from 'vitest';

const tmpRoot = vi.hoisted(() => {
  // 事件日志目录在模块加载时读取（FenshenConfig），必须在 import 前注入
  // （hoisted 块先于 import 求值，不能用 import 来的 path）
  const dir = `${process.env.TMPDIR || '/tmp'}/fenshen-store-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  process.env.FENSHEN_EVENT_LOG_DIR = dir;
  return dir;
});

interface EgoRecord {
  id: string;
  name: string;
  sourceType: string;
  sourceRef: string;
  status: string;
  skillPath: string | null;
  distillThreadId: string | null;
  chatThreadId: string | null;
  model: string;
  failReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const rows = new Map<string, EgoRecord>();
let seq = 0;

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fenshenEgo: {
      create: async ({ data }: { data: Partial<EgoRecord> }) => {
        const now = new Date();
        const row: EgoRecord = {
          id: `ego_${++seq}`,
          name: '',
          sourceType: 'hall',
          sourceRef: '',
          status: 'learning',
          skillPath: null,
          distillThreadId: null,
          chatThreadId: null,
          model: '',
          failReason: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        } as EgoRecord;
        rows.set(row.id, row);
        return row;
      },
      findMany: async () =>
        [...rows.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
      findUnique: async ({ where: { id } }: { where: { id: string } }) => rows.get(id) ?? null,
      update: async ({ where: { id }, data }: { where: { id: string }; data: Partial<EgoRecord> }) => {
        const row = rows.get(id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
  },
}));

import {
  appendEgoEvent,
  createEgo,
  getEgo,
  listEgos,
  readEgoEvents,
  setChatThreadId,
  setDistillThreadId,
  setEgoStatus,
} from './thread-store';

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('fenshen thread-store', () => {
  it('createEgo / getEgo / listEgos 基本流转', async () => {
    const ego = await createEgo({ name: ' 孔子 ', sourceType: 'hall', model: 'm1' });
    expect(ego.name).toBe('孔子');
    expect(ego.status).toBe('learning');
    expect(ego.skillPath).toBeNull();

    expect((await getEgo(ego.id))?.name).toBe('孔子');
    expect(await getEgo('missing')).toBeNull();

    await createEgo({ name: '费曼', sourceType: 'hall', model: 'm1' });
    const list = await listEgos();
    expect(list.map((e) => e.name).sort()).toEqual(['孔子', '费曼']);
  });

  it('线程 id 回填与状态流转（ready 清 failReason，failed 记原因）', async () => {
    const ego = await createEgo({ name: '苏格拉底', sourceType: 'hall', model: 'm1' });
    await setDistillThreadId(ego.id, 'dt-1');
    await setChatThreadId(ego.id, 'ct-1');
    expect((await getEgo(ego.id))?.distillThreadId).toBe('dt-1');
    expect((await getEgo(ego.id))?.chatThreadId).toBe('ct-1');

    await setEgoStatus(ego.id, 'failed', { failReason: '上游超时' });
    expect((await getEgo(ego.id))?.status).toBe('failed');
    expect((await getEgo(ego.id))?.failReason).toBe('上游超时');

    await setEgoStatus(ego.id, 'ready', { skillPath: 'skills/socrates-perspective' });
    const ready = await getEgo(ego.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.skillPath).toBe('skills/socrates-perspective');
    expect(ready?.failReason).toBeNull();
  });

  it('事件日志 append-only 落盘并可读回（畸形行跳过）', async () => {
    const ego = await createEgo({ name: '日志', sourceType: 'hall', model: 'm1' });
    await appendEgoEvent(ego.id, { type: 'text-delta', text: '你好' });
    await appendEgoEvent(ego.id, { type: 'user-message', text: '讲讲这节课' });
    await appendEgoEvent(ego.id, { type: 'ego-ready', skillPath: 'skills/x-perspective' });

    const events = await readEgoEvents(ego.id);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: 'text-delta', text: '你好' });
    expect(events[1]).toMatchObject({ type: 'user-message' });
    expect(events[2]).toMatchObject({ type: 'ego-ready' });

    expect(await readEgoEvents('no-such-ego')).toEqual([]);
  });
});
