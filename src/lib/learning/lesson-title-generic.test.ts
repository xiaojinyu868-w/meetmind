import { describe, expect, it } from 'vitest';
import { isPlaceholderLessonTitle } from './lesson-title-generic';

describe('isPlaceholderLessonTitle', () => {
  it('flags every default title the product writes on its own', () => {
    for (const title of ['课堂录音', '课堂回顾', '未命名课堂', '新课堂', '视频复习', '图片材料', '微信随手记', '微信图片', '微信语音', '微信服务号消息', '课堂学习']) {
      expect(isPlaceholderLessonTitle(title), title).toBe(true);
    }
  });

  it('flags timestamped defaults and bare time / date / id / url labels', () => {
    expect(isPlaceholderLessonTitle('录音 14:32')).toBe(true);
    expect(isPlaceholderLessonTitle('屏幕截图 · 14:32')).toBe(true);
    expect(isPlaceholderLessonTitle('图片材料 · 09:05')).toBe(true);
    expect(isPlaceholderLessonTitle('1785177988742')).toBe(true);
    expect(isPlaceholderLessonTitle('20260726')).toBe(true);
    expect(isPlaceholderLessonTitle('14:32')).toBe(true);
    expect(isPlaceholderLessonTitle('2026-07-28 14:32 的课')).toBe(true);
    expect(isPlaceholderLessonTitle('7 月 28 日')).toBe(true);
    expect(isPlaceholderLessonTitle('周三的课')).toBe(true);
    expect(isPlaceholderLessonTitle('https://www.bilibili.com/video/BV1xx')).toBe(true);
    expect(isPlaceholderLessonTitle('   ')).toBe(true);
    expect(isPlaceholderLessonTitle(null)).toBe(true);
  });

  it('keeps real titles, including ones that contain generic words', () => {
    for (const title of [
      '条件概率与贝叶斯公式 · 概率论 · 7-28',
      '机器学习入门',
      '深度学习中的注意力机制',
      '课程设计答辩要点',
      '内容分发网络 CDN',
      '第 3 讲',
      '澳洲搬家听力练习',
      '小白也能学会的AI工作流',
    ]) {
      expect(isPlaceholderLessonTitle(title), title).toBe(false);
    }
  });
});
