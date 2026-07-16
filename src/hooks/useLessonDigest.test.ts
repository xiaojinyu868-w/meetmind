import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { buildLessonDigestPreview } from './useLessonDigest';

const segments: TranscriptSegment[] = [
  { id: 's1', text: '今天先区分相关性与因果关系。', startMs: 0, endMs: 12_000 },
  { id: 's2', text: '潜在结果框架用两个可能结果描述处理效应。', startMs: 12_000, endMs: 28_000 },
];

describe('buildLessonDigestPreview', () => {
  it('用真实转录立即形成带时间范围的可读笔记', () => {
    const digest = buildLessonDigestPreview(segments, [], '因果推断');

    expect(digest).toMatchObject({
      title: '因果推断',
      sections: [{
        heading: '今天先区分相关性与因果关系',
        startMs: 0,
        endMs: 28_000,
      }],
    });
    expect(digest?.overview).toContain('潜在结果框架');
    expect(digest?.sections[0]?.text).toContain('处理效应');
  });

  it('只把有时间锚点的照片放入对应段落', () => {
    const digest = buildLessonDigestPreview(segments, [
      { imageId: 'during', capturedAtMs: 15_000, title: '板书' },
      { imageId: 'after', capturedAtMs: null, title: '课后补充' },
    ]);

    expect(digest?.sections[0]?.imageId).toBe('during');
    expect(digest?.extras).toEqual([{ text: '课后补充', imageId: 'after' }]);
  });

  it('没有可用转录时不制造笔记', () => {
    expect(buildLessonDigestPreview([
      { id: 'empty', text: '   ', startMs: 0, endMs: 1_000 },
    ])).toBeNull();
  });
});
