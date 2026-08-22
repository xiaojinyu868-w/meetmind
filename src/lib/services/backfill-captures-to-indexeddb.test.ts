import { describe, it, expect } from 'vitest';
import { extractBackfillCandidate, pickBackfillable } from './backfill-captures-to-indexeddb';
import type { WorkspaceCaptureMessage } from '@/types/page-types';

function cap(partial: Partial<WorkspaceCaptureMessage>): WorkspaceCaptureMessage {
  return {
    id: 'c1',
    sourceKey: 'live:1',
    sourceType: 'live-audio',
    role: 'primary',
    contentType: 'audio',
    title: '会议录音',
    previewText: '',
    createdAt: '2026-06-03T19:06:00.000Z',
    status: 'active',
    ...partial,
  };
}

const segs = [
  { id: 's1', text: '第一句', startMs: 0, endMs: 2000 },
  { id: 's2', text: '第二句', startMs: 2000, endMs: 4000 },
];

describe('extractBackfillCandidate', () => {
  it('音频 capture + sessionId + transcriptSegments → 可回填', () => {
    const c = cap({ metadata: { sessionId: 'sess-1', transcriptSegments: segs, duration: 4000 } });
    const r = extractBackfillCandidate(c);
    expect(r).not.toBeNull();
    expect(r!.sessionId).toBe('sess-1');
    expect(r!.segments).toHaveLength(2);
    expect(r!.durationMs).toBe(4000);
  });

  it('保留说话人、困惑点、摘要、精选片段和个人笔记', () => {
    const c = cap({
      metadata: {
        sessionId: 'sess-full',
        transcriptSegments: [{ ...segs[0], speakerId: 'teacher', confidence: 0.88, isFinal: true }],
        anchors: [{ timestamp: 1200, type: 'question', status: 'resolved', note: '这里没懂' }],
        classSummary: {
          summaryId: 'summary-1',
          overview: '从概念到例子。',
          takeaways: [{ label: '概念', insight: '先定义再应用', timestamps: ['00:01'] }],
          keyDifficulties: ['边界条件'],
          structure: ['定义', '例子'],
        },
        highlightTopics: [{
          topicId: 'topic-1',
          title: '关键定义',
          importance: 'high',
          duration: 1200,
          segments: [{ start: 0, end: 1200, text: '第一句' }],
        }],
        notes: [{ noteId: 'note-1', source: 'custom', text: '课后再看一遍' }],
      },
    });

    const result = extractBackfillCandidate(c);
    expect(result?.segments[0]).toMatchObject({ speakerId: 'teacher', confidence: 0.88, isFinal: true });
    expect(result?.anchors[0]).toMatchObject({ timestamp: 1200, type: 'question', status: 'resolved' });
    expect(result?.summary?.summaryId).toBe('summary-1');
    expect(result?.highlights[0]?.topicId).toBe('topic-1');
    expect(result?.notes[0]?.noteId).toBe('note-1');
  });

  it('没有 sessionId → null', () => {
    const c = cap({ metadata: { transcriptSegments: segs } });
    expect(extractBackfillCandidate(c)).toBeNull();
  });

  it('没有 transcriptSegments → null', () => {
    const c = cap({ metadata: { sessionId: 'sess-1' } });
    expect(extractBackfillCandidate(c)).toBeNull();
  });

  it('evidenceAvailable 时绝不用列表截断的 normalizedText 造单段兜底', () => {
    // 列表 API 会把 normalizedText 截到 3200 字符加省略号；固化成 1 段后
    // 路径 A 永远命中降级数据，真实分段（evidence 懒拉）永远回不来。
    const c = cap({
      contentType: 'video',
      sourceUrl: 'https://www.xiaoyuzhoufm.com/episode/abc',
      normalizedText: '这是一段被列表 API 截断的转录…',
      metadata: {
        sessionId: 'podcast-session',
        evidenceAvailable: true,
        durationSec: 6000,
        audioUrl: 'https://example.com/temp-audio/video_import_x.mp3',
        videoProvider: 'xiaoyuzhou',
      },
    });
    const r = extractBackfillCandidate(c);
    expect(r).not.toBeNull();
    expect(r!.segments).toHaveLength(0);
    expect(r!.mediaUrl).toBe('https://example.com/temp-audio/video_import_x.mp3');
  });

  it('mediaUrl 缺失时回退到 metadata.audioUrl（播客音频副本）', () => {
    const c = cap({
      metadata: {
        sessionId: 'sess-audio',
        transcriptSegments: segs,
        audioUrl: 'https://example.com/temp-audio/video_import_y.mp3',
      },
    });
    expect(extractBackfillCandidate(c)!.mediaUrl).toBe('https://example.com/temp-audio/video_import_y.mp3');
  });

  it('兼容旧 migration-v1 的 localSessionId 与汇总转录', () => {
    const c = cap({
      normalizedText: '旧设备只留下了汇总转录。',
      metadata: { localSessionId: 'legacy-session', duration: 5000 },
    });
    const result = extractBackfillCandidate(c);
    expect(result?.sessionId).toBe('legacy-session');
    expect(result?.segments).toEqual([expect.objectContaining({
      text: '旧设备只留下了汇总转录。',
      startMs: 0,
      endMs: 5000,
    })]);
  });

  it('archived/deleted → null（不回填非活跃）', () => {
    const c = cap({ status: 'archived', metadata: { sessionId: 'sess-1', transcriptSegments: segs } });
    expect(extractBackfillCandidate(c)).toBeNull();
  });

  it('过滤空文本段', () => {
    const c = cap({
      metadata: {
        sessionId: 'sess-1',
        transcriptSegments: [{ text: '  ', startMs: 0, endMs: 1 }, { text: '有效', startMs: 1, endMs: 2 }],
      },
    });
    const r = extractBackfillCandidate(c);
    expect(r!.segments).toHaveLength(1);
    expect(r!.segments[0].text).toBe('有效');
  });

  it('durationSec 回退换算成 ms', () => {
    const c = cap({ metadata: { sessionId: 'sess-1', transcriptSegments: segs, durationSec: 90 } });
    expect(extractBackfillCandidate(c)!.durationMs).toBe(90000);
  });

  it('无 duration 时用末段 endMs 兜底', () => {
    const c = cap({ metadata: { sessionId: 'sess-1', transcriptSegments: segs } });
    expect(extractBackfillCandidate(c)!.durationMs).toBe(4000);
  });

  it('跨设备视频保留视频会话身份与播放元数据', () => {
    const c = cap({
      contentType: 'video',
      sourceUrl: 'https://www.bilibili.com/video/BV1example',
      mediaUrl: 'https://cdn.example.com/audio.m4a',
      metadata: {
        sessionId: 'video-session',
        transcriptSegments: segs,
        embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1example',
        videoProvider: 'bilibili',
        thumbnailUrl: 'https://img.example.com/cover.jpg',
        sourceMode: 'bili-native',
      },
    });

    expect(extractBackfillCandidate(c)).toMatchObject({
      sourceType: 'video-link',
      mimeType: 'video/link',
      videoUrl: c.sourceUrl,
      videoEmbedUrl: 'https://player.bilibili.com/player.html?bvid=BV1example',
      videoProvider: 'bilibili',
      thumbnailUrl: 'https://img.example.com/cover.jpg',
      importSourceMode: 'bili-native',
    });
  });
});

describe('pickBackfillable', () => {
  it('从混合 capture 中挑出可回填项', () => {
    const list = [
      cap({ id: 'a', metadata: { sessionId: 's-a', transcriptSegments: segs } }),
      cap({ id: 'b', contentType: 'text', metadata: { foo: 'bar' } }),
      cap({ id: 'c', metadata: { sessionId: 's-c', transcriptSegments: segs } }),
    ];
    const r = pickBackfillable(list);
    expect(r.map((x) => x.sessionId)).toEqual(['s-a', 's-c']);
  });
});
