import { describe, expect, it } from 'vitest';
import { normalizeLessonDigestOutput } from './lesson-digest-service';

describe('normalizeLessonDigestOutput', () => {
  it('用上一段的结束时间补齐缺失时间，不在初始化期反向引用 sections', () => {
    const digest = normalizeLessonDigestOutput({
      title: '测试课堂',
      overview: '从概念到例子。',
      sections: [
        { heading: '概念', text: '建立核心定义。', startMs: 0, endMs: 10_000 },
        { heading: '例子', text: '用例子验证。', endMs: 20_000 },
      ],
    }, []);

    expect(digest).not.toBeNull();
    expect(digest!.sections).toHaveLength(2);
    expect(digest!.sections[1]).toMatchObject({ startMs: 10_000, endMs: 20_000 });
  });

  it('模型返回空分段时返回 null，不再用 5 分钟切片拼「第 N 段」假笔记', () => {
    expect(normalizeLessonDigestOutput({ sections: [] }, [], '课程名')).toBeNull();
    expect(normalizeLessonDigestOutput({ sections: [{ heading: '空', text: '   ' }] }, [], '课程名')).toBeNull();
  });

  it('课中照片没被任何分段引用时进 extras，不丢', () => {
    const digest = normalizeLessonDigestOutput({
      sections: [{ heading: '概念', text: '建立核心定义。', startMs: 0, endMs: 10_000 }],
    }, [{ imageId: 'img-1', capturedAtMs: 500_000, title: '板书照片' }]);
    expect(digest!.extras.map((extra) => extra.imageId)).toContain('img-1');
  });
});
