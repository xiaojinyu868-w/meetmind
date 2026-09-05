import { describe, expect, it } from 'vitest';
import { LLMConfig } from '@/lib/config/app.config';
import {
  AI_CONTROL_DEFINITIONS,
  applyAiControlPromptOverride,
  buildAiControlComparisonPlan,
  summarizeAiControlContext,
} from './ai-control-service';

describe('ai-control-service contracts', () => {
  it('registers every governed AI surface exactly once', () => {
    expect(AI_CONTROL_DEFINITIONS.map((item) => item.key)).toEqual([
      'tutor:in-class', 'tutor:review', 'tutor:shared', 'tutor:goal', 'tutor:word', 'tutor:global',
      'understanding:intent', 'understanding:memory',
      'app:flashcards', 'app:quiz', 'app:mindmap', 'app:cheatsheet', 'app:infographic', 'app:audio-overview', 'app:teach-back',
    ]);
    expect(new Set(AI_CONTROL_DEFINITIONS.map((item) => item.key)).size).toBe(AI_CONTROL_DEFINITIONS.length);
  });

  it('puts locked product contracts after an enabled admin instruction', () => {
    const prompt = applyAiControlPromptOverride('BASE', {
      enabled: true,
      additionalInstructions: '优先用一个生活例子解释。',
    }, ['分享态不得读取私人画像。']);
    expect(prompt.indexOf('管理员当前实验指令')).toBeGreaterThan(prompt.indexOf('BASE'));
    expect(prompt.indexOf('不可覆盖的产品合同')).toBeGreaterThan(prompt.indexOf('管理员当前实验指令'));
  });

  it('does not change the default prompt when the override is disabled', () => {
    expect(applyAiControlPromptOverride('BASE', {
      enabled: false,
      additionalInstructions: '不会生效',
    }, ['合同'])).toBe('BASE');
  });

  it('summarizes context shape without expanding arrays into a long report', () => {
    const rows = summarizeAiControlContext({ global: { depth: 'deep', memories: [{ title: '偏好例子' }, { title: '在学统计' }] } });
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'global.depth', preview: 'deep' }),
      expect.objectContaining({ path: 'global.memories', valueType: 'array', size: 2 }),
    ]));
  });

  it('keeps online and candidate instructions isolated in a comparison plan', () => {
    const registeredModel = LLMConfig.models[0].id;
    const plan = buildAiControlComparisonPlan(
      'tutor:review',
      { fullTranscript: '老师正在解释机会成本。' },
      { returnTimestamps: true },
      { enabled: true, additionalInstructions: '线上指令', modelId: registeredModel },
      { enabled: true, additionalInstructions: '候选指令', modelId: registeredModel },
    );
    expect(plan.onlinePrompt).toContain('线上指令');
    expect(plan.onlinePrompt).not.toContain('候选指令');
    expect(plan.candidatePrompt).toContain('候选指令');
    expect(plan.candidatePrompt).not.toContain('线上指令');
    expect(plan.onlineModelId).toBe(registeredModel);
    expect(plan.candidateModelId).toBe(registeredModel);
  });

  it('builds the real structured user input for an intent comparison', () => {
    const plan = buildAiControlComparisonPlan(
      'understanding:intent',
      { query: '继续上次的因果推断', recentContext: '刚学完混淆变量。' },
      { isFinalizing: false },
      { enabled: false, additionalInstructions: '' },
      { enabled: true, additionalInstructions: '候选版只在真实歧义时提问' },
    );
    expect(plan.trialPrompt).toContain('最近学习现场');
    expect(plan.trialPrompt).toContain('继续上次的因果推断');
    expect(plan.candidatePrompt).toContain('候选版只在真实歧义时提问');
  });

  it('keeps user evidence and assistant text distinct in a memory comparison', () => {
    const plan = buildAiControlComparisonPlan(
      'understanding:memory',
      { userText: '我能解释混淆变量了。', assistantText: '这里补充一个新例子。', existingMemories: [] },
      {},
      { enabled: false, additionalInstructions: '' },
      { enabled: false, additionalInstructions: '' },
    );
    expect(plan.trialPrompt).toContain('学习者这一轮说：\n我能解释混淆变量了。');
    expect(plan.trialPrompt).toContain('助手随后回答：\n这里补充一个新例子。');
  });

  it('uses the actual app user contract when comparing flashcards', () => {
    const plan = buildAiControlComparisonPlan(
      'app:flashcards',
      { goalIntent: '区分两个概念', transcriptContext: '[00:10] 真实课堂原文', anchorContext: '[00:12] 这里没懂' },
      {},
      { enabled: false, additionalInstructions: '' },
      { enabled: true, additionalInstructions: '题面必须能独立理解' },
    );
    expect(plan.trialPrompt).toContain('真实课堂原文');
    expect(plan.trialPrompt).toContain('困惑点');
    expect(plan.trialPrompt).toContain('输出 JSON');
    expect(plan.candidatePrompt).toContain('题面必须能独立理解');
  });

  it('keeps mindmap trials as a light Markdown structure task', () => {
    const plan = buildAiControlComparisonPlan(
      'app:mindmap',
      { goalIntent: '看清课堂主线', transcriptContext: '真实课堂原文', anchorContext: '这里没懂' },
      {},
      { enabled: false, additionalInstructions: '' },
      { enabled: true, additionalInstructions: '主干标签优先沿用课堂术语' },
    );
    expect(plan.onlinePrompt).toContain('不是详尽的课后笔记');
    expect(plan.onlinePrompt).toContain('Markdown 大纲');
    expect(plan.trialPrompt).toContain('这些主题值得在主干层出现');
    expect(plan.candidatePrompt).toContain('主干标签优先沿用课堂术语');
  });

  it('preserves cross-lesson scope and print constraints in cheatsheet trials', () => {
    const plan = buildAiControlComparisonPlan(
      'app:cheatsheet',
      {
        goalIntent: '准备开卷考试',
        contextTier: 'exam',
        lessonCount: 2,
        sourceSummary: '1. 成本理论（sourceId=lesson-1）',
        examScope: '考试大纲 sourceId=exam-syllabus：成本理论',
        transcriptContext: '跨课真实原文',
      },
      {},
      { enabled: false, additionalInstructions: '' },
      { enabled: true, additionalInstructions: '定义与公式之间建立交叉索引' },
    );
    expect(plan.onlinePrompt).toContain('不是考题预测器');
    expect(plan.trialPrompt).toContain('课堂来源（共 2 节）');
    expect(plan.trialPrompt).toContain('打印或导出 PDF');
    expect(plan.trialPrompt).toContain('sourceId=exam-syllabus');
    expect(plan.candidatePrompt).toContain('定义与公式之间建立交叉索引');
  });

  it('uses the vendored skill preset contract in infographic trials', () => {
    const plan = buildAiControlComparisonPlan(
      'app:infographic',
      { goalIntent: '一张图带走这节课', transcriptContext: '真实课堂原文', anchorContext: '这里最容易混淆' },
      {},
      { enabled: false, additionalInstructions: '' },
      { enabled: true, additionalInstructions: '优先用对比关系表达' },
    );
    // 线上提示词 = 宝玉手册版式/画风原文;试跑契约 = 横版 + 文字保真
    expect(plan.onlinePrompt).toContain('bento-grid');
    expect(plan.onlinePrompt).toContain('hand-drawn-edu');
    expect(plan.trialPrompt).toContain('横版 16:9');
    expect(plan.trialPrompt).toContain('不允许出现任何其他文字');
    expect(plan.candidatePrompt).toContain('优先用对比关系表达');
  });

  it('keeps audio narration and timestamp evidence separated in trials', () => {
    const plan = buildAiControlComparisonPlan(
      'app:audio-overview',
      {
        goalIntent: '通勤时重新理解这节课',
        narrationCorpus: '无时间戳的课堂内容',
        chapterEvidenceContext: '[03:18] 带时间戳的章节证据',
        anchorContext: '这里没懂',
      },
      {},
      { enabled: false, additionalInstructions: '' },
      { enabled: true, additionalInstructions: '每章用一个反例检验边界' },
    );
    expect(plan.onlinePrompt).toContain('不朗读课堂摘要');
    expect(plan.trialPrompt).toContain('无时间戳的课堂内容');
    expect(plan.trialPrompt).toContain('[03:18] 带时间戳的章节证据');
    expect(plan.trialPrompt).toContain('不得读进 script');
    expect(plan.candidatePrompt).toContain('每章用一个反例检验边界');
  });
});
