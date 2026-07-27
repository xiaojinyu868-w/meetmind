import { describe, expect, it } from 'vitest';
import {
  passesTopicQualityGate,
  composeLessonTitle,
  isGenericLessonTitle,
} from './lesson-title-service';

describe('passesTopicQualityGate', () => {
  it('接受具体内容词', () => {
    expect(passesTopicQualityGate('条件概率与贝叶斯公式')).toBe(true);
    expect(passesTopicQualityGate('HTTP 缓存协商')).toBe(true);
    expect(passesTopicQualityGate('闭包与原型链')).toBe(true);
  });

  it('拒绝零信息词', () => {
    expect(passesTopicQualityGate('录音')).toBe(false);
    expect(passesTopicQualityGate('课堂笔记')).toBe(false);
    expect(passesTopicQualityGate('内容总结')).toBe(false);
    expect(passesTopicQualityGate('学习')).toBe(false);
  });

  it('拒绝超长（12 字以上）', () => {
    expect(passesTopicQualityGate('条件概率与贝叶斯公式的深入探讨')).toBe(false);
    expect(passesTopicQualityGate('条件概率与贝叶斯公式推导')).toBe(true); // 恰好 12 字
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

describe('isGenericLessonTitle', () => {
  it('识别默认录音标题', () => {
    expect(isGenericLessonTitle('录音 14:32')).toBe(true);
    expect(isGenericLessonTitle('录音 09:05')).toBe(true);
  });

  it('识别截图默认标题', () => {
    expect(isGenericLessonTitle('屏幕截图 · 14:32')).toBe(true);
  });

  it('真实标题不误判', () => {
    expect(isGenericLessonTitle('条件概率与贝叶斯公式 · 概率论 · 7-28')).toBe(false);
  });

  it('空标题视为零信息', () => {
    expect(isGenericLessonTitle('  ')).toBe(true);
  });
});
