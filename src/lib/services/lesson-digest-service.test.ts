import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { normalizeLessonDigestOutput } from './lesson-digest-service';

const segments: TranscriptSegment[] = [
  { id: 's1', text: '先讲概念。', startMs: 0, endMs: 10_000 },
  { id: 's2', text: '再讲例子。', startMs: 10_000, endMs: 20_000 },
];

describe('normalizeLessonDigestOutput', () => {
  it('用上一段的结束时间补齐缺失时间，不在初始化期反向引用 sections', () => {
    const digest = normalizeLessonDigestOutput({
      title: '测试课堂',
      overview: '从概念到例子。',
      sections: [
        { heading: '概念', text: '建立核心定义。', startMs: 0, endMs: 10_000 },
        { heading: '例子', text: '用例子验证。', endMs: 20_000 },
      ],
    }, segments, []);

    expect(digest.sections).toHaveLength(2);
    expect(digest.sections[1]).toMatchObject({ startMs: 10_000, endMs: 20_000 });
  });

  it('模型返回空分段时保留有根的转录降级笔记', () => {
    const digest = normalizeLessonDigestOutput({ sections: [] }, segments, [], '课程名');
    expect(digest.overview).toBe('');
    expect(digest.sections[0]?.text).toContain('先讲概念');
  });
});
