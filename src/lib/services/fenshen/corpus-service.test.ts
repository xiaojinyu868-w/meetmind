/**
 * corpus-service 单测：纯函数 + prepareCorpus 编排 + runPrivateCorpusPipeline
 * 状态兜底。B站下载 / ffmpeg 转码 / DashScope ASR / 蒸馏线程全部 mock，
 * 语料落盘指向临时目录（env 在模块加载时读取，用 vi.hoisted 提前注入）。
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmp = vi.hoisted(() => {
  const root = `${process.env.TMPDIR || '/tmp'}/fenshen-corpus-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  process.env.FENSHEN_CODEX_HOME = `${root}/codex`;
  process.env.FENSHEN_EVENT_LOG_DIR = `${root}/events`;
  process.env.FENSHEN_UPLOAD_AUDIO_DIR = `${root}/uploads`;
  process.env.DASHSCOPE_API_KEY = 'test-key';
  return {
    root,
    codex: `${root}/codex`,
    uploads: `${root}/uploads`,
  };
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

const subtitleState = vi.hoisted(() => ({
  usable: null as null | { language: string; segments: Array<{ text: string; startMs: number; endMs: number }> },
}));

vi.mock('../bilibili-import-service', () => ({
  BilibiliImportError: class BilibiliImportError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'BilibiliImportError';
    }
  },
  resolveBilibiliUrl: vi.fn(async (url: string) => ({
    originalUrl: url,
    resolvedUrl: 'https://www.bilibili.com/video/BV1xx411c7mD?p=1',
    bvid: 'BV1xx411c7mD',
    page: 1,
    embedUrl: '',
  })),
  fetchViewMeta: vi.fn(async () => ({
    bvid: 'BV1xx411c7mD',
    cid: 123,
    page: 1,
    title: '测试老师的课',
    durationSec: 600,
    resolvedUrl: 'https://www.bilibili.com/video/BV1xx411c7mD?p=1',
    embedUrl: '',
  })),
  fetchPlayerSubtitle: vi.fn(async () => subtitleState.usable),
  fetchPlayurlAudio: vi.fn(async () => ({
    audioUrl: 'https://upos.example/audio.m4s',
    mode: 'dash',
    ext: '.m4s',
  })),
  downloadBiliAudio: vi.fn(async (_url: string, outputPath: string) => {
    const { writeFile: wf, mkdir: md } = await import('node:fs/promises');
    await md(path.dirname(outputPath), { recursive: true });
    await wf(outputPath, Buffer.alloc(64 * 1024, 1));
    return { outputPath, ext: '.m4s' };
  }),
}));

vi.mock('../media-tooling', () => ({
  MediaToolError: class MediaToolError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'MediaToolError';
    }
  },
  resolvePublicBaseUrl: () => ({ ok: true, baseUrl: 'https://test.local' }),
  transcodeToMp3: vi.fn(async (_in: string, out: string) => {
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(out, 'mp3-bytes');
  }),
  safeUnlink: (p: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('node:fs').unlinkSync(p);
    } catch {
      // ignore
    }
  },
}));

const asrState = vi.hoisted(() => ({
  sentences: [
    { id: 'seg-0', text: '今天我们讲蒸馏。', beginTime: 0, endTime: 2500, confidence: 0.95 },
    { id: 'seg-1', text: '语料是第一位的。', beginTime: 2500, endTime: 5000, confidence: 0.95 },
  ],
  fail: null as string | null,
}));

vi.mock('../qwen-asr-tasks', () => ({
  submitAsyncTask: vi.fn(async () => ({ success: true, taskId: 'task-1' })),
  waitForTask: vi.fn(async () =>
    asrState.fail
      ? { success: false, sentences: [], totalDuration: 0, error: asrState.fail }
      : { success: true, sentences: asrState.sentences, totalDuration: 5000, text: '…' },
  ),
}));

vi.mock('./distill-service', () => ({
  startDistillation: vi.fn(async () => {}),
}));

import { submitAsyncTask } from '../qwen-asr-tasks';
import { startDistillation } from './distill-service';
import { createEgo } from './thread-store';
import {
  buildTranscriptFileName,
  buildTranscriptText,
  prepareCorpus,
  resolveUploadFileName,
  runPrivateCorpusPipeline,
  subtitleUsable,
} from './corpus-service';

beforeAll(async () => {
  await mkdir(tmp.uploads, { recursive: true });
});

afterAll(async () => {
  await rm(tmp.root, { recursive: true, force: true });
});

function transcriptDir(egoId: string): string {
  return path.join(tmp.codex, egoId, 'work', 'sources', 'transcripts');
}

describe('纯函数', () => {
  it('resolveUploadFileName：裸文件名 / URL 均可，遍历与空值拒绝', () => {
    expect(resolveUploadFileName('audio_1_abc.mp3')).toBe('audio_1_abc.mp3');
    expect(resolveUploadFileName('https://x.test/temp-audio/audio_1_abc.mp3')).toBe('audio_1_abc.mp3');
    expect(resolveUploadFileName('https://x.test/temp-audio/%E5%BD%95%E9%9F%B3.mp3')).toBe('录音.mp3');
    expect(() => resolveUploadFileName('../secret.mp3')).toThrow('上传文件名不合法');
    expect(() => resolveUploadFileName('a/b.mp3')).toThrow('上传文件名不合法');
    expect(() => resolveUploadFileName('')).toThrow('缺少上传文件引用');
  });

  it('subtitleUsable：段数与覆盖率双门槛', () => {
    const seg = (i: number) => ({ text: `第${i}句`, startMs: i * 10000, endMs: i * 10000 + 9000 });
    expect(subtitleUsable(null, 600)).toBe(false);
    expect(subtitleUsable({ subtitleUrl: '', segments: [] }, 600)).toBe(false);
    // 600s 视频：需 ≥33 段且覆盖率 ≥0.7
    const sparse = { subtitleUrl: '', segments: [seg(0), seg(1), seg(2), seg(3)] };
    expect(subtitleUsable(sparse, 600)).toBe(false);
    const dense = {
      subtitleUrl: '',
      segments: Array.from({ length: 40 }, (_, i) => ({
        text: `第${i}句`,
        startMs: i * 15000,
        endMs: i * 15000 + 9000,
      })),
    };
    expect(subtitleUsable(dense, 600)).toBe(true);
    // 时长未知：退化为最少 4 段
    expect(subtitleUsable(sparse, undefined)).toBe(true);
  });

  it('buildTranscriptFileName / buildTranscriptText 形状', () => {
    expect(buildTranscriptFileName('bilibili', 'BV1xx411c7mD-p1')).toBe('bilibili-BV1xx411c7mD-p1.txt');
    expect(buildTranscriptFileName('upload', '我的 录音')).toBe('upload-我的录音.txt');
    const text = buildTranscriptText(['来源：B站 测试'], [
      { text: ' 第一句。 ', beginTime: 0, endTime: 1 },
      { text: '   ', beginTime: 1, endTime: 2 },
      { text: '第二句。', beginTime: 2, endTime: 3 },
    ]);
    expect(text).toBe('# 来源：B站 测试\n\n第一句。\n第二句。\n');
  });
});

describe('prepareCorpus', () => {
  it('bilibili：官方字幕完整时直接用作语料，不走 ASR', async () => {
    subtitleState.usable = {
      language: 'zh-CN',
      segments: Array.from({ length: 40 }, (_, i) => ({
        text: `字幕第${i}句`,
        startMs: i * 15000,
        endMs: i * 15000 + 9000,
      })),
    };
    const ego = await createEgo({ name: '字幕老师', sourceType: 'bilibili', sourceRef: 'https://www.bilibili.com/video/BV1xx411c7mD', model: 'm1' });
    const files = await prepareCorpus(ego);
    expect(files).toEqual(['bilibili-BV1xx411c7mD-p1.txt']);
    expect(vi.mocked(submitAsyncTask)).not.toHaveBeenCalled();
    const text = await readFile(path.join(transcriptDir(ego.id), files[0]), 'utf8');
    expect(text).toContain('字幕：zh-CN');
    expect(text).toContain('字幕第39句');
    subtitleState.usable = null;
  });

  it('bilibili：无字幕时走 音频下载 → 转码 → ASR，中间产物清理', async () => {
    const ego = await createEgo({ name: '音频老师', sourceType: 'bilibili', sourceRef: 'https://b23.tv/abc', model: 'm1' });
    const files = await prepareCorpus(ego);
    expect(files).toEqual(['bilibili-BV1xx411c7mD-p1.txt']);
    expect(vi.mocked(submitAsyncTask)).toHaveBeenCalledTimes(1);
    const fileUrl = vi.mocked(submitAsyncTask).mock.calls[0][0] as string;
    expect(fileUrl.startsWith('https://test.local/temp-audio/fenshen_')).toBe(true);
    const text = await readFile(path.join(transcriptDir(ego.id), files[0]), 'utf8');
    expect(text).toContain('ASR 转写');
    expect(text).toContain('今天我们讲蒸馏。\n语料是第一位的。');
    // raw / mp3 中间产物已删除
    await expect(stat(fileUrl.replace('https://test.local/temp-audio/', `${tmp.uploads}/`))).rejects.toThrow();
  });

  it('upload：复用上传产物转写，原始文件保留', async () => {
    const uploadName = 'audio_1_abc.webm';
    await writeFile(path.join(tmp.uploads, uploadName), Buffer.alloc(4096, 1));
    const ego = await createEgo({ name: '录音老师', sourceType: 'upload', sourceRef: `https://x.test/temp-audio/${uploadName}`, model: 'm1' });
    const files = await prepareCorpus(ego);
    expect(files).toEqual([`upload-${uploadName.replace('.webm', '')}.txt`]);
    const text = await readFile(path.join(transcriptDir(ego.id), files[0]), 'utf8');
    expect(text).toContain(`来源：上传录音 ${uploadName}`);
    // 原始上传文件保留，转码 mp3 已删
    await expect(stat(path.join(tmp.uploads, uploadName))).resolves.toBeTruthy();
    const leftovers = (await readdir(tmp.uploads)).filter((f) => f.startsWith(`fenshen_${ego.id}_`));
    expect(leftovers).toEqual([]);
  });

  it('upload：文件不存在 → 人可读错误', async () => {
    const ego = await createEgo({ name: '不存在', sourceType: 'upload', sourceRef: 'ghost.mp3', model: 'm1' });
    await expect(prepareCorpus(ego)).rejects.toThrow('录音文件不存在或已过期');
  });

  it('bilibili：ASR 失败 → 人可读错误', async () => {
    asrState.fail = '转录超时';
    const ego = await createEgo({ name: '超时老师', sourceType: 'bilibili', sourceRef: 'https://www.bilibili.com/video/BV1xx411c7mD', model: 'm1' });
    await expect(prepareCorpus(ego)).rejects.toThrow('转写失败：转录超时');
    asrState.fail = null;
  });
});

describe('runPrivateCorpusPipeline', () => {
  it('语料成功 → 起蒸馏线程，ego 保持 learning', async () => {
    const ego = await createEgo({ name: '管线老师', sourceType: 'bilibili', sourceRef: 'https://www.bilibili.com/video/BV1xx411c7mD', model: 'm1' });
    await runPrivateCorpusPipeline(ego.id);
    expect(vi.mocked(startDistillation)).toHaveBeenCalledWith(ego.id);
    expect(rows.get(ego.id)?.status).toBe('learning');
  });

  it('语料失败 → ego failed + failReason，不起蒸馏', async () => {
    vi.mocked(startDistillation).mockClear();
    const ego = await createEgo({ name: '坏录音', sourceType: 'upload', sourceRef: 'missing.mp3', model: 'm1' });
    await runPrivateCorpusPipeline(ego.id);
    expect(vi.mocked(startDistillation)).not.toHaveBeenCalled();
    expect(rows.get(ego.id)?.status).toBe('failed');
    expect(rows.get(ego.id)?.failReason).toContain('录音文件不存在或已过期');
  });
});
