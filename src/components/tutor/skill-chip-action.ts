/**
 * skill-chip-action.ts — 纯 TS 的 chip 路由决策。
 *
 * 从 SkillChipRow.tsx 里抽出来，让 node 测试环境能直接 import，而不触发
 * vitest 的 JSX 解析。所有 agent-parity 的核心合约都在这个函数里。
 */

import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { SkillPrompt } from './skill-prompts';

/**
 * 决定一个 chip 被点击时走哪条路径。优先级（M8 agent-native 修正）：
 *   1. onSay + utterance  → 'say'（agent-native 主路径：chip = 用户亲口说同一句话
 *                                  给同学听。同学会自然地先回复一句"好，我来整"，
 *                                  然后在回复里带一个 <open_app:KEY/> 标记让前端
 *                                  打开对应 WorkshopWindow。这条路径保证 chip 和
 *                                  打字行为完全一致——这是 UI/agent parity 的内核。）
 *   2. onOpenApp + appKey → 'app'（加速路径：仅供"应用矩阵"这类不带 companion
 *                                   上下文的 surface 用。此时没有同学对话通道，
 *                                   直接开窗口是合理的。）
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
  if (options.onSay && skill.utterance) {
    return { kind: 'say', utterance: skill.utterance };
  }
  if (skill.appKey && options.onOpenApp) {
    return { kind: 'app', appKey: skill.appKey };
  }
  return { kind: 'prompt', prompt: skill.prompt };
}
