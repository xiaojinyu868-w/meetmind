/**
 * SKILL_PROMPTS — 共享的"Skill 原语"数据目录。
 *
 * 这份目录是产品层的单一事实源。TutorAgentPanel / ClassroomCompanionPanel 以及
 * 未来任何希望把"考试速查表 / 闪卡 / 测验 / 思维导图 / 学习报告 / 再讲一遍"
 * 作为一键入口的界面，都必须从这里读——不要在本地再写一份。
 *
 * ── Skill 的履行方式（M8-N5 agent-native 对齐后）──
 *
 * 每条 skill 都有一句自然语言 `utterance`——等价于"用户亲口说出这句话"。
 * 点击 chip 就是把 utterance 当作一条用户消息发给 AI 同桌（agent endpoint），
 * 由 agent 自行决定调用哪个工具（makeCheatsheet / makeFlashcards / makeQuiz / ...）
 * 还是直接对话回答。
 *
 * 这是 Every.to 讲的 agent-native 原则：UI/agent parity——chip 能做的事，
 * 用户打字一样能做；反过来，决策权完全在 agent 手里，UI 不自行分派插件。
 *
 * 兼容字段：
 *   - appKey：结构化技能的显式 app 引用。在 agent 迁移完成前，
 *     某些 surface（review-mode 里 TutorAgentPanel 的"快速打开应用"）仍
 *     可以直接 openWorkshopWindow(appKey) 跳过 agent 循环——作为加速路径。
 *     新代码应优先走 utterance。
 *   - prompt：旧版"填充输入框"的文案，和 utterance 区分：utterance 是
 *     "直接作为一条消息发出"，prompt 原本是"建议你这样问"。目前两者等价。
 *
 * 纯 .ts 文件（不含 JSX），方便在 node 测试环境里直接 import。
 * 组件实现（SkillChipRow）在 ./SkillChipRow.tsx 里。
 */

import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export interface SkillPrompt {
  label: string;
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

export const SKILL_PROMPTS: SkillPrompt[] = [
  {
    label: '考试速查表',
    appKey: 'cheatsheet',
    utterance: '帮我把这节课整理成一页考试速查表。',
    prompt: '把这节课整理成一页"考试速查表"：核心定义、公式/关键步骤、易错点各一组。',
  },
  {
    label: '做闪卡',
    appKey: 'flashcards',
    utterance: '基于这节课给我做一组闪卡，我想主动回忆一下。',
    prompt: '基于这节课做 10 张闪卡（概念题 + 公式题 + 应用题），正反面都给。',
  },
  {
    label: '出测验',
    appKey: 'quiz',
    utterance: '考我一下，出几道题测测我有没有真懂。',
    prompt: '基于这节课出 5 道单选题测验，要有正确答案和解析。',
  },
  {
    label: '画思维导图',
    appKey: 'mindmap',
    utterance: '帮我把这节课的结构画成思维导图。',
    prompt: '把这节课的主干和分支整理成思维导图结构。',
  },
  {
    label: '学习报告',
    appKey: 'study-report',
    utterance: '生成一份这节课的学习报告，我想知道自己应该关注哪里。',
    prompt: '根据这节课我的答题情况和困惑点，生成一份学习报告，告诉我还需要巩固什么。',
  },
  {
    // "再讲一遍"天然对话式——agent 不会调 tool，直接流式回答即可。
    label: '再讲一遍',
    utterance: '把这节课的核心内容用更通俗的方式再讲一遍。',
    prompt: '用更通俗的方式重新讲解这节课的核心概念，像同学之间聊天那样。',
  },
];
