import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeachLogEvent } from './event-bus';

const generateMock = vi.fn();
const enabledMock = vi.fn(() => true);
vi.mock('@/lib/services/dashscope-image-service', () => ({
  generateDashscopeImage: (...args: unknown[]) => generateMock(...args),
  isDashscopeImageEnabled: () => enabledMock(),
}));

const publishMock = vi.fn();
vi.mock('./event-bus', async (importOriginal) => {
  const original = await importOriginal<typeof import('./event-bus')>();
  return { ...original, publishTeachEvent: (...args: unknown[]) => publishMock(...args) };
});

const appendMock = vi.fn(async () => {});
vi.mock('./thread-store', () => ({
  appendThreadEvent: (...args: unknown[]) => appendMock(...args),
  readThreadEvents: vi.fn(async () => []),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

import { collectMissingImageJobs, scheduleTeachImageBackfill } from './image-backfill';

function imageCall(id: string, prompt = '几何拼接图示'): TeachLogEvent {
  return { type: 'tool-call', id, name: 'image', args: { prompt, caption: '图示' } };
}

beforeEach(() => {
  vi.clearAllMocks();
  enabledMock.mockReturnValue(true);
  generateMock.mockResolvedValue({ base64: 'aGk=', mimeType: 'image/png', requestId: 'r', model: 'm' });
});

describe('collectMissingImageJobs（事件日志 → 缺配图的 image 调用）', () => {
  it('挑无 image-ready 的 image tool-call；已回填/失败调用/空 prompt 跳过', () => {
    const events: TeachLogEvent[] = [
      imageCall('tc_a'),
      { type: 'tool-call', id: 'tc_b', name: 'image', args: { prompt: 'p2' } },
      { type: 'image-ready', id: 'tc_b', url: '/uploads/teach/x.png' },
      { type: 'tool-call', id: 'tc_c', name: 'image', args: { prompt: 'p3' } },
      { type: 'tool-result', id: 'tc_c', result: { ok: false, error: 'bad' } },
      { type: 'tool-call', id: 'tc_d', name: 'image', args: {} },
      { type: 'tool-call', id: 'tc_e', name: 'write', args: { text: 'x', role: 'step' } },
    ];
    const jobs = collectMissingImageJobs(events);
    expect(jobs.map((j) => j.id)).toEqual(['tc_a']);
    expect(jobs[0]).toEqual({ id: 'tc_a', prompt: '几何拼接图示', caption: '图示' });
  });
});

describe('scheduleTeachImageBackfill（后台生图回填）', () => {
  it('成功：落盘 + publish/append image-ready（id = tool-call id）', async () => {
    await scheduleTeachImageBackfill('t1', [imageCall('tc_a')]);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0][0]).toMatchObject({ prompt: '几何拼接图示', stylePreset: 'chalkboard' });
    const ready = { type: 'image-ready', id: 'tc_a', url: expect.stringMatching(/^\/uploads\/teach\/[0-9a-f]{16}\.png$/) };
    expect(publishMock).toHaveBeenCalledWith('t1', ready);
    expect(appendMock).toHaveBeenCalledWith('t1', ready);
  });

  it('已有 image-ready 的调用不再生成（历史回放自愈的幂等）', async () => {
    await scheduleTeachImageBackfill('t1', [
      imageCall('tc_a'),
      { type: 'image-ready', id: 'tc_a', url: '/uploads/teach/x.png' },
    ]);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('并发触发同一张图只生成一次（inflight 去重）', async () => {
    let release!: () => void;
    generateMock.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ base64: 'aGk=', mimeType: 'image/png', requestId: 'r', model: 'm' }); }),
    );
    const first = scheduleTeachImageBackfill('t1', [imageCall('tc_a')]);
    await scheduleTeachImageBackfill('t1', [imageCall('tc_a')]); // 第二个触发立即返回
    release();
    await first;
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('失败：只记日志不发事件、不抛异常；冷却期内不重试', async () => {
    generateMock.mockRejectedValue(new Error('dashscope down'));
    await expect(scheduleTeachImageBackfill('t1', [imageCall('tc_a')])).resolves.toBeUndefined();
    expect(publishMock).not.toHaveBeenCalled();
    expect(appendMock).not.toHaveBeenCalled();
    // 冷却期：紧接着的第二次触发不再调生图
    await scheduleTeachImageBackfill('t1', [imageCall('tc_a')]);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('未配置 DASHSCOPE_API_KEY 时直接不动（不读日志不生图）', async () => {
    enabledMock.mockReturnValue(false);
    await scheduleTeachImageBackfill('t1', [imageCall('tc_a')]);
    expect(generateMock).not.toHaveBeenCalled();
  });
});
