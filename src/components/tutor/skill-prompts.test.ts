import { describe, expect, it } from 'vitest';
import { SKILL_PROMPTS } from './skill-prompts';

describe('SKILL_PROMPTS catalog', () => {
  // 这六个 skill 是产品层的"原语"——Hyperknow 的 tell 是把它们放在一眼看得见的位置。
  // 产品里但凡出现 skill chip 的地方（TutorAgentPanel / ClassroomCompanionPanel / 未来的 mobile）
  // 都必须用这同一份目录，避免"考试速查表"在 A 处叫这个名、B 处叫那个名的碎片化。
  //
  // 这个测试钉住目录契约：
  //   1. 个数
  //   2. 每条都有 icon/label/prompt
  //   3. 没有重复标签
  //   4. 核心 5 个 skill 必须走 appKey（结构化插件路径），不能退回 prompt-only
  //      这是 M7-fix10 的架构承诺：结构化技能 = 真实 plugin，不是 /api/tutor 下的纯 markdown
  // 以后要添加新的 skill 只要更新这个测试的预期数量即可。
  it('has the expected six core skills', () => {
    expect(SKILL_PROMPTS).toHaveLength(6);
  });

  it('每个 skill 都有 icon / label / prompt / utterance', () => {
    for (const s of SKILL_PROMPTS) {
      expect(typeof s.icon).toBe('string');
      expect(s.icon.length).toBeGreaterThan(0);
      expect(typeof s.label).toBe('string');
      expect(s.label.length).toBeGreaterThan(1);
      expect(typeof s.prompt).toBe('string');
      // prompt 至少 10 个字——不能是占位文案
      expect(s.prompt.length).toBeGreaterThanOrEqual(10);
      expect(typeof s.utterance).toBe('string');
      // utterance 必须是自然的一句话——至少 6 个字
      expect(s.utterance.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('label 不重复', () => {
    const labels = SKILL_PROMPTS.map((s) => s.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });

  it('核心 4 个结构化 skill 在目录里（防重构时手滑漏掉）', () => {
    const labels = SKILL_PROMPTS.map((s) => s.label);
    expect(labels).toContain('考试速查表');
    expect(labels).toContain('做闪卡');
    expect(labels).toContain('出测验');
    expect(labels).toContain('画思维导图');
  });

  it('结构化 skill 都挂 appKey（走 /api/apps/execute 真实 plugin，不走 /api/tutor markdown）', () => {
    const expectedApp: Record<string, string> = {
      '考试速查表': 'cheatsheet',
      '做闪卡': 'flashcards',
      '出测验': 'quiz',
      '画思维导图': 'mindmap',
      '学习报告': 'study-report',
    };
    for (const [label, appKey] of Object.entries(expectedApp)) {
      const skill = SKILL_PROMPTS.find((s) => s.label === label);
      expect(skill, `expected ${label} in catalog`).toBeDefined();
      expect(skill?.appKey).toBe(appKey);
    }
  });

  it('对话式 skill 故意不挂 appKey（保留 prompt 路径）', () => {
    const chatOnly = SKILL_PROMPTS.find((s) => s.label === '再讲一遍');
    expect(chatOnly).toBeDefined();
    expect(chatOnly?.appKey).toBeUndefined();
  });
});

