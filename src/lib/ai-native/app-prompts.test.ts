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
  buildMindmapSystemPrompt,
  buildMindmapUserPrompt,
  buildQuizSystemPrompt,
  buildQuizUserPrompt,
} from './app-prompts';
import {
  INFOGRAPHIC_PRESET,
  assembleInfographicImagePrompt,
  buildInfographicSkillSystemPrompt,
  buildInfographicSkillUserPrompt,
} from '@/lib/services/infographic-skill-service';

describe('structured app prompt contracts', () => {
  it('keeps flashcards grounded, atomic, and answer-safe（v2：正面是提示不是标题、背面两行内、掌握轨迹决定哪些点该有卡）', () => {
    const system = buildFlashcardsSystemPrompt();
    const user = buildFlashcardsUserPrompt({
      goalIntent: '区分机会成本和沉没成本',
      transcriptContext: '[00:10] 真实课堂原文',
      anchorContext: '[00:12] 学生困惑',
      terminologyHint: '机会成本',
      learnerContext: '还没稳：「本课」机会成本指的是什么？（quiz✕）',
      material: { minutes: 42, chars: 12_340 },
    });
    expect(system).toContain('主动回忆');
    expect(system).toContain('一张卡只装一个可回忆的点');
    expect(system).toContain('正面是提示，不是标题');
    expect(system).toContain('答案里的关键词不出现在正面');
    expect(system).toContain('两行以内');
    expect(system).toContain('还没稳的概念必须有卡');
    expect(system).toContain('已经稳的不再做卡');
    expect(system).toContain('卡数随材料决定');
    expect(user).toContain('没有课堂证据的内容宁可不出');
    expect(user).toContain('关于这个学习者');
    expect(user).toContain('「本课」机会成本');
    expect(user).toContain('约 42 分钟、12300 字');
    expect(user).toContain('[00:10] 真实课堂原文');
    expect(user).toContain('输出 JSON');
  });

  it('makes quiz personal, explained and light to read（v2：掌握轨迹进 prompt、题型含多选、每题先对后错的解析、不出"以下哪个不是"）', () => {
    const system = buildQuizSystemPrompt();
    const user = buildQuizUserPrompt({
      transcriptContext: '[00:10] 真实课堂原文',
      terminologyHint: '混淆变量',
    });
    expect(system).toContain('这套题只为他一个人出');
    expect(system).toContain('干扰项必须是课里真实出现过的误解');
    expect(system).toContain('multiple');
    expect(system).toContain('不出"以下哪个不是');
    expect(system).toContain('每题必须有 explanation');
    expect(system).toContain('先说这个答案为什么对，再说其他选项');
    expect(system).toContain('先确认基本概念，后面拉伸');
    expect(system).toContain('题量随材料决定');
    expect(system).toContain('中文题干尽量 32 字内');
    expect(system).toContain('还没稳的概念多出、换角度出');
    expect(system).toContain('刚记住的出一道迁移题');
    expect(system).toContain('已经稳的少出或只出一道稍难的确认题');
    expect(user).toContain('"multiple"');
    expect(user).toContain('如 "A、C"');
    expect(user).toContain('[00:10] 真实课堂原文');
    expect(user).toContain('输出 JSON');
    expect(user).toContain('混淆变量');
    // 没给学习者事实与材料体量时，两段都不出现（不给模型空段落）
    expect(user).not.toContain('关于这个学习者');
    expect(user).not.toContain('这节课的材料');
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

  it('builds infographic prompt from the vendored baoyu skill with preset style and landscape layout', () => {
    const system = buildInfographicSkillSystemPrompt();
    const user = buildInfographicSkillUserPrompt({
      goalIntent: '一张图带走机会成本与沉没成本',
      transcriptContext: '机会成本是放弃的最佳替代方案。',
      anchorContext: '两者容易混淆。',
    });
    // 手册材料原文进 system:预设版式 + 预设画风
    expect(system).toContain(INFOGRAPHIC_PRESET.layout);
    expect(system).toContain(INFOGRAPHIC_PRESET.style);
    // 预设写进任务契约:横版、LLM 只出内容(占位符拼装由代码完成)
    expect(user).toContain('"suggestedOrientation": "landscape"');
    expect(user).toContain('textLabels');
    expect(user).toContain('机会成本是放弃的最佳替代方案。');

    const prompt = assembleInfographicImagePrompt({
      title: '认识分数',
      subtitle: '三大重点',
      keyPoints: ['分母是总份数', '分子是取的份数'],
      contentOutline: 'hero 格放标题,其余格各放一个重点',
      textLabels: ['认识分数', '分母是总份数'],
    });
    expect(prompt).not.toContain('{{');
    expect(prompt).toContain('认识分数');
    expect(prompt).toContain('分母是总份数');
    expect(prompt).toContain('禁止新增任何文字');
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

  it('keeps head and tail of the narration corpus when over budget', () => {
    // 40 段 × ~80 字 ≈ 3200 字：在内层预算（maxChars*2）之内不被逐段压缩，只触发外层头尾取舍
    const transcript = Array.from({ length: 40 }, (_, index) => ({
      id: `s${index}`,
      text: `开头第${index}段`.padEnd(80, '内容'),
      startMs: index * 30_000,
      endMs: index * 30_000 + 25_000,
      confidence: 1,
      isFinal: true,
    }));
    // 结尾放一段可识别的“高潮”内容
    transcript[39] = { ...transcript[39], id: 's-tail', text: '结尾高潮：全场最重要的结论' };

    const corpus = buildAudioOverviewNarrationCorpus(transcript, 2_000);

    expect(corpus.length).toBeLessThanOrEqual(2_000);
    expect(corpus).toContain('开头第0段');
    expect(corpus).toContain('结尾高潮');
    expect(corpus).toContain('...');
  });
});
