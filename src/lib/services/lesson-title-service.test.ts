import { describe, expect, it } from 'vitest';
import {
  passesTopicQualityGate,
  composeLessonTitle,
  displayWidth,
  isGenericLessonTitle,
  sampleTranscriptForTopic,
} from './lesson-title-service';

describe('passesTopicQualityGate', () => {
  it('接受具体内容词', () => {
    expect(passesTopicQualityGate('条件概率与贝叶斯公式')).toBe(true);
    expect(passesTopicQualityGate('HTTP 缓存协商')).toBe(true);
    expect(passesTopicQualityGate('闭包与原型链')).toBe(true);
  });

  it('含泛词但有具体所指的主题必须放行（机器学习不是"学习"）', () => {
    expect(passesTopicQualityGate('机器学习入门')).toBe(true);
    expect(passesTopicQualityGate('深度学习')).toBe(true);
    expect(passesTopicQualityGate('课程设计答辩')).toBe(true);
    expect(passesTopicQualityGate('内容分发网络')).toBe(true);
    expect(passesTopicQualityGate('个性化学习的上下文')).toBe(true);
    expect(passesTopicQualityGate('期末复习：微积分')).toBe(true);
  });

  it('拒绝完全由零信息词和虚词拼成的主题', () => {
    expect(passesTopicQualityGate('录音')).toBe(false);
    expect(passesTopicQualityGate('课堂笔记')).toBe(false);
    expect(passesTopicQualityGate('内容总结')).toBe(false);
    expect(passesTopicQualityGate('学习')).toBe(false);
    expect(passesTopicQualityGate('这节课的学习内容')).toBe(false);
    expect(passesTopicQualityGate('课堂录音')).toBe(false);
    expect(passesTopicQualityGate('知识点整理与复习')).toBe(false);
  });

  it('拒绝超宽（16 显示宽度以上）；提示词要 12 字，门槛留余量，具体主题多几个字比退回占位好', () => {
    expect(passesTopicQualityGate('条件概率与贝叶斯公式的深入探讨与应用举例')).toBe(false); // 19 字
    expect(passesTopicQualityGate('罗马尼亚女巫的商业化与跨境市场')).toBe(true); // 14 字，线上真实被误杀的例子
    expect(passesTopicQualityGate('条件概率与贝叶斯公式推导')).toBe(true);
  });

  it('中英混排按显示宽度算，不按字符数（线上真实被误杀的例子）', () => {
    expect(displayWidth('AI for AI与Auto Research')).toBe(12); // 22 个 ASCII × 0.5 + 1 个汉字
    expect(passesTopicQualityGate('AI for AI与Auto Research')).toBe(true);
    expect(passesTopicQualityGate('OpenReview 筛选搜索与隐私设置')).toBe(true);
    expect(passesTopicQualityGate('Transformer 自注意力机制')).toBe(true);
  });

  it('拒绝空串、纯标点、纯数字', () => {
    expect(passesTopicQualityGate('')).toBe(false);
    expect(passesTopicQualityGate('。。。')).toBe(false);
    expect(passesTopicQualityGate('12345')).toBe(false);
  });

  it('容忍模型带出的标点（先剥离再判定）', () => {
    expect(passesTopicQualityGate('条件概率与贝叶斯公式。')).toBe(true);
    expect(passesTopicQualityGate('《HTTP 缓存协商》')).toBe(true);
  });
});

describe('composeLessonTitle', () => {
  const date = new Date('2026-07-28T14:32:00');

  it('主题 + 课程 + 日期', () => {
    expect(composeLessonTitle({ topic: '条件概率与贝叶斯公式', courseTitle: '概率论', date }))
      .toBe('条件概率与贝叶斯公式 · 概率论 · 7-28');
  });

  it('没有课程名时省略', () => {
    expect(composeLessonTitle({ topic: 'HTTP 缓存协商', date }))
      .toBe('HTTP 缓存协商 · 7-28');
  });

  it('课程名空白字符串视为没有', () => {
    expect(composeLessonTitle({ topic: '闭包与原型链', courseTitle: '  ', date }))
      .toBe('闭包与原型链 · 7-28');
  });
});

describe('sampleTranscriptForTopic', () => {
  it('短文本原样返回', () => {
    expect(sampleTranscriptForTopic('  短文本  ')).toBe('短文本');
  });

  it('长文本取头 / 中 / 尾三段，不再只看开场白', () => {
    const head = 'A'.repeat(500);
    const middle = 'B'.repeat(500);
    const tail = 'C'.repeat(500);
    const sample = sampleTranscriptForTopic(head + middle + tail, 300);
    expect(sample.startsWith('A')).toBe(true);
    expect(sample).toContain('B');
    expect(sample.endsWith('C')).toBe(true);
    expect(sample).toContain('[…]');
    expect(sample.replace(/\n\[…\]\n/g, '').length).toBe(300);
  });
});

describe('isGenericLessonTitle', () => {
  it('识别产品自己写下的默认标题（线上卡死 152 条的那一个）', () => {
    expect(isGenericLessonTitle('课堂录音')).toBe(true);
    expect(isGenericLessonTitle('图片材料')).toBe(true);
    expect(isGenericLessonTitle('微信随手记')).toBe(true);
  });

  it('识别默认录音标题', () => {
    expect(isGenericLessonTitle('录音 14:32')).toBe(true);
    expect(isGenericLessonTitle('录音 09:05')).toBe(true);
  });

  it('识别截图默认标题', () => {
    expect(isGenericLessonTitle('屏幕截图 · 14:32')).toBe(true);
  });

  it('识别纯数字时间戳/ID 标题', () => {
    expect(isGenericLessonTitle('1785177988742')).toBe(true);
    expect(isGenericLessonTitle('20260726')).toBe(true);
  });

  it('含文字的数字标题不误判', () => {
    expect(isGenericLessonTitle('第 3 讲')).toBe(false);
    expect(isGenericLessonTitle('条件概率与贝叶斯公式 · 概率论 · 7-28')).toBe(false);
  });

  it('真实标题不误判', () => {
    expect(isGenericLessonTitle('条件概率与贝叶斯公式 · 概率论 · 7-28')).toBe(false);
  });

  it('空标题视为零信息', () => {
    expect(isGenericLessonTitle('  ')).toBe(true);
  });
});
