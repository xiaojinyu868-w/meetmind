import { describe, it, expect } from 'vitest';
import { resolveSkillAction } from './skill-chip-action';
import type { SkillPrompt } from './skill-prompts';

/**
 * M14.6 chip 路由合同：
 *   有 appKey + onOpenApp → 'app'（直接开 WorkshopWindow，结构化产物不走对话）
 *   仅当无 appKey 或无 onOpenApp 时，才走 onSay（把 utterance 当消息发给同学）
 *   最兜底是 onPick(prompt)。
 */
describe('resolveSkillAction (M14.6 parity)', () => {
  const skill: SkillPrompt = {
    label: '考试速查表',
    appKey: 'cheatsheet',
    utterance: '帮我把这节课整理成一页考试速查表。',
    prompt: '把这节课整理成一页"考试速查表"。',
  };

  it('appKey + onOpenApp 存在 → 返回 app，哪怕同时有 onSay', () => {
    const onSay = () => undefined;
    const onOpenApp = () => undefined;
    const action = resolveSkillAction(skill, { onSay, onOpenApp });
    expect(action.kind).toBe('app');
    if (action.kind === 'app') {
      expect(action.appKey).toBe('cheatsheet');
    }
  });

  it('只有 onOpenApp + appKey → 返回 app（加速路径给黄页用）', () => {
    const onOpenApp = () => undefined;
    const action = resolveSkillAction(skill, { onOpenApp });
    expect(action.kind).toBe('app');
    if (action.kind === 'app') {
      expect(action.appKey).toBe('cheatsheet');
    }
  });

  it('两个都没传 → 兜底 prompt', () => {
    const action = resolveSkillAction(skill, {});
    expect(action.kind).toBe('prompt');
    if (action.kind === 'prompt') {
      expect(action.prompt).toBe(skill.prompt);
    }
  });

  it('没 appKey + 只有 onOpenApp → 退回 prompt', () => {
    const chatOnly: SkillPrompt = {
      label: '再讲一遍',
      utterance: '用更通俗的方式再讲一遍。',
      prompt: '用更通俗的方式讲解。',
    };
    const action = resolveSkillAction(chatOnly, { onOpenApp: () => undefined });
    expect(action.kind).toBe('prompt');
  });

  it('没 appKey + onSay → 返回 say（对话式 skill 走 utterance）', () => {
    const chatOnly: SkillPrompt = {
      label: '再讲一遍',
      utterance: '用更通俗的方式再讲一遍。',
      prompt: '用更通俗的方式讲解。',
    };
    const action = resolveSkillAction(chatOnly, { onSay: () => undefined });
    expect(action.kind).toBe('say');
    if (action.kind === 'say') {
      expect(action.utterance).toBe(chatOnly.utterance);
    }
  });
});
