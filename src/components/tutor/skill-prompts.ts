/**
 * SKILL_PROMPTS — 共享的"Skill 原语"数据目录。
 *
 * 这份目录是产品层的单一事实源。TutorAgentPanel / ClassroomCompanionPanel 以及
 * 未来任何希望把"考试速查表 / 闪卡 / 测验 / 思维导图 / 再讲一遍"
 * 作为一键入口的界面，都必须从这里读——不要在本地再写一份。
 *
 * ── Skill 的履行方式（M14.6 纯对话重构后）──
 *
 * 有 appKey 的 skill（速查表/闪卡/测验/导图）→ 直接打开 WorkshopWindow，
 * 不走 AI 对话。对话和应用矩阵各司其职。
 * 没有 appKey 的 skill（再讲一遍）→ utterance 作为一条用户消息发给 AI 同桌，
 * 同桌纯文本回复。
 *
 * 纯 .ts 文件（不含 JSX），方便在 node 测试环境里直接 import。
 * 组件实现（SkillChipRow）在 ./SkillChipRow.tsx 里。
 */

import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export interface SkillPrompt {
  label: string;
  /** 给 chip 展示的轻提示：解释这一步对学习有什么用，而不是解释功能名。 */
  hint?: string;
  /**
   * Agent-native 主路径：点击 = 发这条 utterance 给 agent，agent 自行调度工具。
   * 文案要像"人会说的话"——是用户意图，不是 prompt engineering。
   */
  utterance: string;
  /**
   * 结构化 skill 的加速路径：未走 agent 的 surface 可以直接
   * openWorkshopWindow(appKey) 打开对应渲染面板。新代码首选 utterance。
   */
  appKey?: WorkshopAppKey;
  /**
   * 旧版 prompt 兼容字段（多数情况下 = utterance）。将随 agent 迁移彻底移除。
   */
  prompt: string;
}

export function filterSkillPromptsForSurface(
  skills: readonly SkillPrompt[],
  options: { excludeAppKeys?: readonly WorkshopAppKey[] } = {},
): SkillPrompt[] {
  const excluded = new Set(options.excludeAppKeys ?? []);
  return skills.filter((skill) => !skill.appKey || !excluded.has(skill.appKey));
}

export const SKILL_PROMPTS: SkillPrompt[] = [
  {
    label: '考试速查表',
    hint: '考前一页看完',
    appKey: 'cheatsheet',
    utterance: '帮我把这节课整理成一页考试速查表。',
    prompt: '把这节课整理成一页"考试速查表"：核心定义、公式/关键步骤、易错点各一组。',
  },
  {
    label: '做闪卡',
    hint: '用来主动回忆',
    appKey: 'flashcards',
    utterance: '基于这节课给我做一组闪卡，我想主动回忆一下。',
    prompt: '基于这节课做 10 张闪卡（概念题 + 公式题 + 应用题），正反面都给。',
  },
  {
    label: '出测验',
    hint: '测一下真懂没',
    appKey: 'quiz',
    utterance: '考我一下，出几道题测测我有没有真懂。',
    prompt: '基于这节课出 5 道单选题测验，要有正确答案和解析。',
  },
  {
    label: '画思维导图',
    hint: '把结构串起来',
    appKey: 'mindmap',
    utterance: '帮我把这节课的结构画成思维导图。',
    prompt: '把这节课的主干和分支整理成思维导图结构。',
  },
  {
    label: '讲给同桌听',
    hint: '讲出来才算懂',
    appKey: 'teach-back',
    utterance: '我想把这节课讲给同桌听，看看你听得懂吗。',
    prompt: '我想把这节课的重点讲出来，请你当听众。',
  },
  {
    // "再讲一遍"天然对话式——agent 不会调 tool，直接流式回答即可。
    label: '再讲一遍',
    hint: '换个说法听',
    utterance: '把这节课的核心内容用更通俗的方式再讲一遍。',
    prompt: '用更通俗的方式重新讲解这节课的核心概念，像同学之间聊天那样。',
  },
];
