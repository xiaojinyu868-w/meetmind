import { describe, expect, it } from 'vitest';
import {
  buildFlashcardsSystemPrompt,
  buildFlashcardsUserPrompt,
  buildCheatsheetSystemPrompt,
  buildCheatsheetScopePromptContext,
  buildCheatsheetUserPrompt,
  buildAudioOverviewChapterEvidence,
  buildAudioOverviewNarrationCorpus,
  buildAudioOverviewSystemPrompt,
  buildAudioOverviewUserPrompt,
  buildInfographicSystemPrompt,
  buildInfographicUserPrompt,
  buildMindmapSystemPrompt,
  buildMindmapUserPrompt,
  buildQuizSystemPrompt,
  buildQuizUserPrompt,
} from './app-prompts';

describe('structured app prompt contracts', () => {
  it('keeps flashcards grounded, atomic, and answer-safe', () => {
    const system = buildFlashcardsSystemPrompt();
    const user = buildFlashcardsUserPrompt({
      goalIntent: '区分机会成本和沉没成本',
      transcriptContext: '[00:10] 真实课堂原文',
      anchorContext: '[00:12] 学生困惑',
      terminologyHint: '机会成本',
    });
    expect(system).toContain('主动回忆');
    expect(user).toContain('一张卡只检验一个认知动作');
    expect(user).toContain('hint 只能给思考方向');
    expect(user).toContain('没有课堂证据的内容宁可不出');
    expect(user).toContain('[00:10] 真实课堂原文');
    expect(user).toContain('输出 JSON');
  });

  it('makes quiz distractors meaningful and keeps narrow-column reading light', () => {
    const system = buildQuizSystemPrompt();
    const user = buildQuizUserPrompt({
      transcriptContext: '[00:10] 真实课堂原文',
      terminologyHint: '混淆变量',
    });
    expect(system).toContain('干扰项都必须来自课堂内容');
    expect(system).toContain('就把它出成简答题');
    expect(system).toContain('中文题干尽量不超过 32 字');
    expect(system).toContain('不要反复写“根据上下文”');
    expect(user).toContain('[00:10] 真实课堂原文');
    expect(user).toContain('输出 JSON');
    expect(user).toContain('混淆变量');
  });

  it('keeps a one-class mindmap light, structural, and out of note-writing territory', () => {
    const system = buildMindmapSystemPrompt();
    const user = buildMindmapUserPrompt({
      goalIntent: '看清独立功效高底散布局的论证结构',
      transcriptContext: '经营现状诊断，随后进入产品差异化重构。',
      anchorContext: '不理解经营诊断如何连接到产品策略。',
      terminologyHint: '独立功效；高底散',
    });
    expect(system).toContain('不是详尽的课后笔记');
    expect(system).toContain('每个节点要像地图标签');
    expect(system).toContain('Markdown 大纲');
    expect(system).toContain('不要 JSON');
    expect(user).toContain('这些主题值得在主干层出现');
    expect(user).toContain('课堂原文');
  });

  it('keeps cheatsheets cross-lesson, printable, and evidence-bound', () => {
    const system = buildCheatsheetSystemPrompt();
    const user = buildCheatsheetUserPrompt({
      goalIntent: '准备微观经济学开卷考试',
      contextTier: 'exam',
      lessonCount: 3,
      sourceSummary: '1. 成本理论（sourceId=lesson-1）',
      examScope: '考试大纲 sourceId=exam-syllabus：成本与市场结构',
      transcriptContext: '[03:18] 沉没成本已经发生，不应影响当前决策。',
      anchorContext: '机会成本与沉没成本容易混淆。',
      terminologyHint: '机会成本；沉没成本',
    });
    expect(system).toContain('不是考题预测器');
    expect(system).toContain('没有大纲、真题或老师明确措辞');
    expect(user).toContain('课堂来源（共 3 节）');
    expect(user).toContain('打印或导出 PDF');
    expect(user).toContain('不要把每节课摘要简单拼接');
    expect(user).toContain('sourceId 必须从上面的课堂 / 大纲 / 真题来源中选择');
    expect(user).toContain('只有在文字更难扫读时');
  });

  it('keeps cheatsheet source ids and exam evidence identical across product and admin previews', () => {
    const scope = buildCheatsheetScopePromptContext({
      contextTier: 'exam',
      lessonSources: [
        { sessionId: 'lesson-1', title: '成本理论' },
        { sessionId: 'lesson-2', title: '市场结构' },
      ],
      exam: {
        name: '期末考试',
        mode: 'open-book',
        syllabus: '成本、市场结构',
        pastPapers: [{ title: '2025 真题', content: '比较机会成本与沉没成本。' }],
      },
    });
    expect(scope.lessonCount).toBe(2);
    expect(scope.sourceSummary).toContain('sourceId=lesson-1');
    expect(scope.examScope).toContain('开卷，可携带纸面资料');
    expect(scope.examScope).toContain('sourceId=exam-syllabus');
    expect(scope.examScope).toContain('sourceId=past-paper:0');
  });

  it('keeps infographic output sparse, evidence-bound, and mobile-readable', () => {
    const system = buildInfographicSystemPrompt();
    const user = buildInfographicUserPrompt({
      goalIntent: '一张图带走机会成本与沉没成本',
      transcriptContext: '机会成本是放弃的最佳替代方案。',
      anchorContext: '两者容易混淆。',
    });
    expect(system).toContain('不是缩小版课堂笔记');
    expect(user).toContain('手机上必须无需放大就能看懂');
    expect(user).toContain('3-5 个真正支撑它的视觉模块');
    expect(user).toContain('禁止新增文字、禁止伪造数字、禁止密集小字');
    expect(user).toContain('禁止高饱和渐变');
  });

  it('separates podcast narration from timestamp evidence', () => {
    const transcript = [
      { id: 's1', text: '08:25 机会成本是放弃的最佳替代方案', startMs: 505_000, endMs: 520_000, confidence: 1, isFinal: true },
      { id: 's2', text: '沉没成本已经发生', startMs: 520_000, endMs: 535_000, confidence: 1, isFinal: true },
    ];
    const narration = buildAudioOverviewNarrationCorpus(transcript);
    const chapterEvidence = buildAudioOverviewChapterEvidence(transcript);
    const system = buildAudioOverviewSystemPrompt();
    const user = buildAudioOverviewUserPrompt({ narrationCorpus: narration, chapterEvidenceContext: chapterEvidence });
    expect(narration).not.toContain('08:25');
    expect(chapterEvidence).toMatch(/08:2[05]/);
    expect(system).toContain('不朗读课堂摘要');
    expect(user).toContain('不得读进 script');
    expect(user).toContain('不能从无时间的朗读语料猜测');
  });
});
