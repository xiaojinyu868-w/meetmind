/**
 * skill-chip-action.ts — 纯 TS 的 chip 路由决策。
 *
 * M14.6：课中/课后同桌回归纯 AI 对话，不在对话里生成结构化产物。
 * 有 appKey 的 chip（速查表/闪卡/测验/导图/学习报告）直接打开 WorkshopWindow，
 * 没有 appKey 的 chip（再讲一遍）走 utterance 发给 AI 对话。
 * 对话和应用矩阵各司其职，边界清晰。
 */

import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { SkillPrompt } from './skill-prompts';

/**
 * 决定一个 chip 被点击时走哪条路径。优先级：
 *   1. appKey + onOpenApp → 'app'（直接打开 WorkshopWindow——结构化产物不走对话）
 *   2. onSay + utterance  → 'say'（发 prompt 走 AI 对话，适合"再讲一遍"等纯对话 skill）
 *   3. onPick + prompt    → 'prompt'（兜底）
 */
export function resolveSkillAction(
  skill: SkillPrompt,
  options: {
    onSay?: (utterance: string) => void;
    onOpenApp?: (appKey: WorkshopAppKey) => void;
  },
):
  | { kind: 'say'; utterance: string }
  | { kind: 'app'; appKey: WorkshopAppKey }
  | { kind: 'prompt'; prompt: string } {
  if (skill.appKey && options.onOpenApp) {
    return { kind: 'app', appKey: skill.appKey };
  }
  if (options.onSay && skill.utterance) {
    return { kind: 'say', utterance: skill.utterance };
  }
  return { kind: 'prompt', prompt: skill.prompt };
}
