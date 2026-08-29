/**
 * 上下文物化单测：buildContextFiles 纯函数 + materializeLessonContext
 * 用内存 mock prisma + 临时目录落盘验证。
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface CaptureRow {
  id: string;
  title: string;
  previewText: string | null;
  normalizedText: string | null;
  status: string;
  updatedAt: Date;
}

const capture: CaptureRow = {
  id: 'cap_1',
  title: '机会成本入门',
  previewText: '从选课讲起的机会成本',
  normalizedText: null,
  status: 'active',
  updatedAt: new Date(),
};

const segmentRows = [
  { captureId: 'cap_1', startMs: 0, endMs: 5000, text: '今天我们讲机会成本', speakerId: 'T', position: 0, createdAt: new Date() },
  { captureId: 'cap_1', startMs: 65000, endMs: 70000, text: '放弃的最高价值', speakerId: null, position: 1, createdAt: new Date() },
];

const anchorRows = [
  { captureId: 'cap_1', kind: 'anchor', payloadJson: JSON.stringify({ type: 'confusion', timestamp: 65000, text: '沉没成本没跟上' }) },
  { captureId: 'cap_1', kind: 'anchor', payloadJson: JSON.stringify({ type: 'important', timestamp: 5000 }) },
  { captureId: 'cap_1', kind: 'highlight', payloadJson: JSON.stringify({ type: 'confusion', timestamp: 1000 }) },
  { captureId: 'cap_1', kind: 'anchor', payloadJson: '{bad json' },
];

const profileJson = JSON.stringify({
  bio: { headline: '大二 · 经济学', detail: '偏好例子驱动讲解' },
  goals: [
    { title: '期末过线', summary: '微观经济学', status: 'active' },
    { title: '', summary: '空标题应被过滤' },
  ],
  memories: [{ title: '不该进 profile.md' }],
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workspaceTranscriptSegment: {
      findFirst: async () => ({ captureId: 'cap_1' }),
      findMany: async ({ where }: { where: { captureId: string } }) =>
        segmentRows.filter((s) => s.captureId === where.captureId),
    },
    workspaceCapture: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        id === capture.id ? capture : null,
      findFirst: async () => capture,
    },
    workspaceCaptureArtifact: {
      findMany: async ({ where }: { where: { captureId: string; kind: string } }) =>
        anchorRows.filter((a) => a.captureId === where.captureId && a.kind === where.kind),
    },
    user: {
      findFirst: async () => ({ learnerProfileJson: profileJson }),
    },
  },
}));

import {
  buildContextFiles,
  emptyTurnAction,
  materializeLessonContext,
} from './fenshen-session-service';

describe('emptyTurnAction（空轮静默重试判定）', () => {
  const fresh = { text: '问', codexThreadId: 'th_1', gotDelta: false, retried: false };

  it('completed 且零 delta 且未补过 → retry', () => {
    expect(emptyTurnAction(fresh, 'completed')).toBe('retry');
    expect(emptyTurnAction(fresh, undefined)).toBe('retry');
  });

  it('已收到 delta → complete（正常轮）', () => {
    expect(emptyTurnAction({ ...fresh, gotDelta: true }, 'completed')).toBe('complete');
  });

  it('已补过一枪 → complete（不无限重试）', () => {
    expect(emptyTurnAction({ ...fresh, retried: true }, 'completed')).toBe('complete');
  });

  it('interrupted 优先于重试（用户打断的空轮不补枪）', () => {
    expect(emptyTurnAction(fresh, 'interrupted')).toBe('interrupted');
  });

  it('无 pending（非对话轮）→ complete', () => {
    expect(emptyTurnAction(undefined, 'completed')).toBe('complete');
  });
});

describe('buildContextFiles（纯函数）', () => {
  it('产出 4 个固定文件，转录带时间戳与说话人', () => {
    const files = buildContextFiles({
      captureTitle: '机会成本入门',
      capturePreview: '从选课讲起',
      segments: [
        { startMs: 0, endMs: 5000, text: '今天我们讲机会成本', speakerId: 'T' },
        { startMs: 65000, endMs: 70000, text: '放弃的最高价值' },
      ],
      confusions: [{ timestampMs: 65000, text: '沉没成本没跟上' }],
      profile: {
        bio: { headline: '大二 · 经济学', detail: '偏好例子' },
        goals: [{ title: '期末过线', summary: '微观' }],
      },
    });
    expect(files.map((f) => f.relPath)).toEqual([
      path.join('lesson', 'transcript.txt'),
      path.join('lesson', 'outline.md'),
      path.join('lesson', 'confusions.md'),
      path.join('learner', 'profile.md'),
    ]);
    const transcript = files[0].content;
    expect(transcript).toContain('[00:00] T 今天我们讲机会成本');
    expect(transcript).toContain('[01:05] 放弃的最高价值');
    expect(files[1].content).toContain('# 机会成本入门');
    expect(files[2].content).toContain('[01:05] 沉没成本没跟上');
    expect(files[3].content).toContain('大二 · 经济学');
    expect(files[3].content).toContain('期末过线：微观');
  });

  it('空数据兜底：占位文案 + normalizedText 回退', () => {
    const files = buildContextFiles({
      normalizedText: '整段兜底文本',
      segments: [],
      confusions: [],
      profile: null,
    });
    expect(files[0].content).toContain('整段兜底文本');
    expect(files[2].content).toContain('没有留下困惑标记');
    expect(files[3].content).toContain('暂无学生画像');

    const empty = buildContextFiles({ segments: [], confusions: [] });
    expect(empty[0].content).toContain('暂无课堂转录');
  });
});

describe('materializeLessonContext（mock prisma + 临时目录）', () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'fenshen-ctx-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('从 prisma 读出并写进 workspace；只收 type=confusion 的 anchor', async () => {
    const result = await materializeLessonContext(workDir);
    expect(result.files).toBe(4);

    const transcript = await readFile(path.join(workDir, 'lesson', 'transcript.txt'), 'utf8');
    expect(transcript).toContain('机会成本入门');
    expect(transcript).toContain('[01:05] 放弃的最高价值');

    const confusions = await readFile(path.join(workDir, 'lesson', 'confusions.md'), 'utf8');
    expect(confusions).toContain('[01:05] 沉没成本没跟上');
    expect(confusions).not.toContain('important');
    // kind=highlight 与畸形 payload 都不进困惑文件
    expect(confusions.match(/-/g)?.length).toBe(1);

    const profile = await readFile(path.join(workDir, 'learner', 'profile.md'), 'utf8');
    expect(profile).toContain('大二 · 经济学');
    expect(profile).toContain('期末过线：微观经济学');
    expect(profile).not.toContain('空标题');
    expect(profile).not.toContain('不该进');
  });
});
