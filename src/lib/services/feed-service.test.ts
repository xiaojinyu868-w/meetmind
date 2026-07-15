import { describe, expect, it } from 'vitest';
import {
  filterValidCaptureIds,
  filterValidGoalLabel,
  containsUnsupportedPsychology,
  isAcceptableExternalResult,
  scoreExternalResult,
  buildCrossCoursePrompt,
} from './feed-service';

describe('feed recommendation quality guardrails', () => {
  it('rejects malformed URLs and known low-quality aggregators', () => {
    expect(isAcceptableExternalResult('not-a-url')).toBe(false);
    expect(isAcceptableExternalResult('https://baijiahao.baidu.com/s?id=1')).toBe(false);
    expect(isAcceptableExternalResult('https://blog.csdn.net/example/article/details/1')).toBe(false);
    expect(isAcceptableExternalResult('https://arxiv.org/abs/2401.00001')).toBe(true);
  });

  it('ranks authoritative sources above an unrecognized commercial domain', () => {
    expect(scoreExternalResult('https://arxiv.org/abs/2401.00001'))
      .toBeGreaterThan(scoreExternalResult('https://example.com/post'));
    expect(scoreExternalResult('https://history.example.edu/archive'))
      .toBeGreaterThan(scoreExternalResult('https://example.com/post'));
  });

  it('keeps only real source capture ids and removes duplicates', () => {
    const captures = [
      { id: 'capture-a', title: 'A' },
      { id: 'capture-b', title: 'B' },
    ];
    expect(filterValidCaptureIds(['capture-a', 'made-up', 'capture-a', 'capture-b'], captures))
      .toEqual(['capture-a', 'capture-b']);
  });

  it('never displays a goal label that is absent from the learner context', () => {
    const goals = [{ title: '完成毕业论文' }];
    expect(filterValidGoalLabel('完成毕业论文', goals)).toBe('完成毕业论文');
    expect(filterValidGoalLabel('成为物理学家', goals)).toBeUndefined();
  });

  it('blocks unsupported psychological interpretations', () => {
    expect(containsUnsupportedPsychology('这反映了你对知识盲区的零容忍心态')).toBe(true);
    expect(containsUnsupportedPsychology('你收藏了三篇关于快速排序的文章')).toBe(false);
  });

  it('tells the model not to invent claims from link-only captures', () => {
    const prompt = buildCrossCoursePrompt([
      {
        id: 'capture-link',
        title: '一篇待读文章',
        source: { platformLabel: '微信公众号', contentState: 'link-only' },
      },
    ], {});
    expect(prompt).toContain('微信公众号；只有原链接');
    expect(prompt).toContain('不能推断文章观点');
  });

  it('builds a retrieval plan with real content kinds and a counterpoint lane', () => {
    const prompt = buildCrossCoursePrompt([
      { id: 'capture-a', title: '生成式 AI 与教育评价', normalizedText: '课堂讨论了生成式 AI 对形成性评价的影响。' },
    ], { learnerProfile: { goals: [{ title: '完成教育技术论文' }] } });
    expect(prompt).toContain('至少 1 个 counterpoint');
    expect(prompt).toContain('"academicQuery"');
    expect(prompt).toContain('"bookQuery"');
    expect(prompt).toContain('"contentKinds"');
  });

  it('can build a real external discovery plan from an explicit active learning thread without captures', () => {
    const prompt = buildCrossCoursePrompt([], {
      learningContext: {
        activeThread: {
          title: '为阅读经济学因果推断论文补齐统计基础',
          intent: '一个月内读懂目标论文的方法和识别假设',
          nextStep: '先补混淆变量与反事实框架',
        },
      },
    });

    expect(prompt).toContain('正在继续：为阅读经济学因果推断论文补齐统计基础');
    expect(prompt).toContain('目标：一个月内读懂目标论文的方法和识别假设');
    expect(prompt).toContain('即使暂时没有新收藏');
    expect(prompt).toContain('sourceCaptureIds 允许为空');
  });
});
