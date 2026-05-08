/**
 * SKILL_PROMPTS — 共享的"Skill 原语"数据目录。
 *
 * 这份目录是产品层的单一事实源。TutorAgentPanel / ClassroomCompanionPanel 以及
 * 未来任何希望把"考试速查表 / 闪卡 / 测验 / 思维导图 / 学习报告 / 再讲一遍"
 * 作为一键入口的界面，都必须从这里读——不要在本地再写一份。
 *
 * ── Skill 的两种履行方式（M7-fix10 对齐架构）──
 *   1. 调用真实 App 插件（首选）：chip 自带 `appKey`，点击后打开对应的 WorkshopWindow。
 *      走 /api/apps/execute → 插件拿结构化 JSON → 专用渲染组件。
 *      适用于"有结构化输出"的技能：闪卡、测验、思维导图、学习报告、考试速查表。
 *      好处：不把 agent 能力藏在 chat 里；和 AI 工坊里的应用矩阵复用同一套执行链。
 *
 *   2. 走对话式 prompt（兜底）：chip 无 `appKey` 时才退回原来的 onPick(prompt)，
 *      POST /api/tutor，把回答渲染成 markdown 气泡。
 *      适用于"本质就是聊天式重讲"的技能：再讲一遍。
 *
 * 纯 .ts 文件（不含 JSX），方便在 node 测试环境里直接 import。
 * 组件实现（SkillChipRow）在 ./SkillChipRow.tsx 里。
 */

import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export interface SkillPrompt {
  icon: string;
  label: string;
  /**
   * 结构化 skill：点击后打开 WorkshopWindow（优先），不发 /api/tutor。
   * 未设置则退回 prompt 聊天模式。
   */
  appKey?: WorkshopAppKey;
  /**
   * 聊天式兜底：没有 appKey 时把这句话作为用户消息发给 AI 同桌。
   * 有 appKey 时该字段用不上，但保留做 hover tooltip（让用户明白点了会发生什么）。
   */
  prompt: string;
}

export const SKILL_PROMPTS: SkillPrompt[] = [
  {
    icon: '📋',
    label: '考试速查表',
    appKey: 'cheatsheet',
    prompt: '把这节课整理成一页"考试速查表"：核心定义、公式/关键步骤、易错点各一组。',
  },
  {
    icon: '🃏',
    label: '做闪卡',
    appKey: 'flashcards',
    prompt: '基于这节课做 10 张闪卡（概念题 + 公式题 + 应用题），正反面都给。',
  },
  {
    icon: '✍️',
    label: '出测验',
    appKey: 'quiz',
    prompt: '基于这节课出 5 道单选题测验，要有正确答案和解析。',
  },
  {
    icon: '🧠',
    label: '画思维导图',
    appKey: 'mindmap',
    prompt: '把这节课的主干和分支整理成思维导图结构。',
  },
  {
    icon: '📊',
    label: '学习报告',
    appKey: 'study-report',
    prompt: '根据这节课我的答题情况和困惑点，生成一份学习报告，告诉我还需要巩固什么。',
  },
  {
    // "再讲一遍"是真正对话式的——没有结构化输出，就是把老师讲过的用更白的话重说。
    // 故意不给 appKey，保留 prompt 路径。
    icon: '💡',
    label: '再讲一遍',
    prompt: '用更通俗的方式重新讲解这节课的核心概念，像同学之间聊天那样。',
  },
];
