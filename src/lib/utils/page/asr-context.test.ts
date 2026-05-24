import { describe, expect, it } from 'vitest';
import { buildASRContextHint } from './context-and-format';

describe('buildASRContextHint', () => {
  it('includes baseline AI tool terms even when the user has not provided a topic', () => {
    const hint = buildASRContextHint({
      manualHint: '',
      recentSegments: [],
      importedReferences: [],
    });

    expect(hint).toContain('Cursor');
    expect(hint).toContain('Claude Code');
    expect(hint).toContain('Codex');
    expect(hint).toContain('Copilot');
    expect(hint).toContain('Midjourney');
    expect(hint).toContain('Kimi');
    expect(hint).toContain('Kimi Cloud');
    expect(hint).toContain('Manus');
    expect(hint).toContain('Genspark');
    expect(hint).toContain('ChatGPT');
    expect(hint).toContain('DeepSeek');
    expect(hint).toContain('Qwen');
    expect(hint).toContain('豆包');
    expect(hint).toContain('Perplexity');
    expect(hint).toContain('Mistral');
    expect(hint).toContain('百模大战');
    expect(hint).toContain('Scaling Law');
    expect(hint).toContain('Jan Spark / Gen Spark 多数情况下应识别为 Genspark');
  });

  it('keeps user-provided topic before generic tool terms', () => {
    const hint = buildASRContextHint({
      manualHint: 'AI 编程工具课：Cursor、Copilot、Claude Code 的产品差异',
      recentSegments: [],
      importedReferences: [],
    });

    expect(hint.indexOf('AI 编程工具课')).toBeLessThan(hint.indexOf('常见中英混合术语'));
  });

  // M2 T2.5 测试：飞书妙记级 contextual biasing
  it('injects course metadata (title + subject)', () => {
    const hint = buildASRContextHint({
      manualHint: '',
      recentSegments: [],
      courseTitle: '高等数学（下）',
      courseSubject: '数学',
    });
    expect(hint).toContain('课程：高等数学（下）');
    expect(hint).toContain('学科：数学');
  });

  it('injects participant names', () => {
    const hint = buildASRContextHint({
      manualHint: '',
      recentSegments: [],
      participants: ['王老师', '张三', '李四'],
    });
    expect(hint).toContain('王老师');
    expect(hint).toContain('张三');
    expect(hint).toContain('参与者姓名');
  });

  it('caps participants to 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => `学生${i}`);
    const hint = buildASRContextHint({ manualHint: '', recentSegments: [], participants: many });
    expect(hint).toContain('学生0');
    expect(hint).toContain('学生19');
    expect(hint).not.toContain('学生20');
  });

  it('injects lesson vocabulary and user hotwords', () => {
    const hint = buildASRContextHint({
      manualHint: '',
      recentSegments: [],
      lessonVocabulary: ['微分', '积分', '极限'],
      userHotwords: ['Kubernetes', 'Istio'],
    });
    expect(hint).toContain('本节课预期术语');
    expect(hint).toContain('微分、积分、极限');
    expect(hint).toContain('个人常用术语');
    expect(hint).toContain('Kubernetes');
  });

  it('injects previous lesson topics', () => {
    const hint = buildASRContextHint({
      manualHint: '',
      recentSegments: [],
      previousLessonTopics: ['反向传播', '梯度下降'],
    });
    expect(hint).toContain('上节课主题');
    expect(hint).toContain('反向传播');
  });

  it('orders course meta before participants before manual hint', () => {
    const hint = buildASRContextHint({
      manualHint: '本节课重点',
      recentSegments: [],
      courseTitle: '语文课',
      participants: ['老师 A'],
    });
    expect(hint.indexOf('课程：语文课')).toBeLessThan(hint.indexOf('老师 A'));
    expect(hint.indexOf('老师 A')).toBeLessThan(hint.indexOf('本节课重点'));
  });
});

