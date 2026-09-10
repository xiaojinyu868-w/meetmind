import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: { workspaceCapture: { findMany: vi.fn() } } }));

import {
  collapseDuplicateSessionCaptures,
  readCaptureSessionId,
  resolveCaptureTitle,
} from './workspace-capture-guards';

describe('capture 标题护栏', () => {
  it('零信息标题不覆盖已有的具体标题（迁移 / 检查点 / 原声回写带占位进来）', () => {
    expect(resolveCaptureTitle({ incomingTitle: '课堂录音', existingTitle: '算法定义与时间复杂度 · 9-9', existingMetadata: {} }))
      .toBe('算法定义与时间复杂度 · 9-9');
    expect(resolveCaptureTitle({ incomingTitle: '录音 20:31', existingTitle: 'AI 同桌与课中互动', existingMetadata: null }))
      .toBe('AI 同桌与课中互动');
  });

  it('用户手改过的标题永不被覆盖，哪怕新标题很具体', () => {
    expect(resolveCaptureTitle({ incomingTitle: '模型起的新名字', existingTitle: '我的名字', existingMetadata: { titleSource: 'user' } }))
      .toBe('我的名字');
  });

  it('具体标题可以替换占位，也可以替换旧的具体标题（重导入补全 / AI 改名）', () => {
    expect(resolveCaptureTitle({ incomingTitle: '播客名 - 单集名', existingTitle: '课堂录音', existingMetadata: {} })).toBe('播客名 - 单集名');
    expect(resolveCaptureTitle({ incomingTitle: '新主题 · 9-10', existingTitle: '旧主题 · 9-10', existingMetadata: { titleSource: 'auto' } })).toBe('新主题 · 9-10');
    expect(resolveCaptureTitle({ incomingTitle: '首次写入', existingTitle: null, existingMetadata: null })).toBe('首次写入');
  });
});

describe('readCaptureSessionId', () => {
  it('sessionId 优先，旧迁移只有 localSessionId 也认', () => {
    expect(readCaptureSessionId({ sessionId: ' s1 ' })).toBe('s1');
    expect(readCaptureSessionId({ localSessionId: 's2' })).toBe('s2');
    expect(readCaptureSessionId({})).toBeNull();
    expect(readCaptureSessionId(null)).toBeNull();
  });
});

describe('列表读取时折叠同一节课的双行', () => {
  const base = { contentType: 'audio', status: 'active', createdAt: '2026-09-05T08:04:00.000Z' };

  it('live-audio + local-session 同 sessionId 只留一行，优先有证据的那行', () => {
    const rows = [
      { ...base, id: 'local', sourceType: 'local-session', metadata: { sessionId: 's1', evidenceAvailable: true }, updatedAt: '2026-09-05T09:00:00.000Z' },
      { ...base, id: 'live', sourceType: 'live-audio', metadata: { sessionId: 's1' }, updatedAt: '2026-09-05T08:05:00.000Z' },
    ];
    expect(collapseDuplicateSessionCaptures(rows).map((row) => row.id)).toEqual(['local']);
  });

  it('证据相同时优先现场录音行，再看更新时间；不同 session 与非课堂内容原样保留', () => {
    const rows = [
      { ...base, id: 'local', sourceType: 'local-session', metadata: { sessionId: 's1', evidenceAvailable: true }, updatedAt: '2026-09-05T09:00:00.000Z' },
      { ...base, id: 'live', sourceType: 'live-audio', metadata: { sessionId: 's1', evidenceAvailable: true }, updatedAt: '2026-09-05T08:05:00.000Z' },
      { ...base, id: 'other', sourceType: 'live-audio', metadata: { sessionId: 's2', evidenceAvailable: true }, updatedAt: '2026-09-05T08:05:00.000Z' },
      { ...base, id: 'article', contentType: 'link', sourceType: 'import', metadata: { sessionId: 's1' }, updatedAt: '2026-09-05T08:05:00.000Z' },
      { ...base, id: 'no-session', sourceType: 'live-audio', metadata: null, updatedAt: '2026-09-05T08:05:00.000Z' },
    ];
    expect(collapseDuplicateSessionCaptures(rows).map((row) => row.id)).toEqual(['live', 'other', 'article', 'no-session']);
  });

  it('两行都没证据时取更新时间更晚的', () => {
    const rows = [
      { ...base, id: 'a', sourceType: 'local-session', metadata: { sessionId: 's1' }, updatedAt: '2026-09-05T09:00:00.000Z' },
      { ...base, id: 'b', sourceType: 'local-session', metadata: { sessionId: 's1' }, updatedAt: '2026-09-05T08:00:00.000Z' },
    ];
    expect(collapseDuplicateSessionCaptures(rows).map((row) => row.id)).toEqual(['a']);
  });
});
