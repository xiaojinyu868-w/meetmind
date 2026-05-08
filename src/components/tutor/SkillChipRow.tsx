'use client';

/**
 * SkillChipRow — 共享的 Skill 启发条（组件）
 *
 * 数据目录（SKILL_PROMPTS / SkillPrompt）放在 ./skill-prompts.ts（纯 TS，可在
 * node 测试环境里直接 import）。本文件只负责 JSX。
 *
 * 分发策略（M8-N5 agent-native 对齐）：
 *   1. 父组件传了 onSay → 把 skill.utterance 作为一条用户消息发给 agent，
 *      由 agent 自行决定是否调用 tool（makeCheatsheet / makeQuiz / ...）
 *      还是直接聊天回答。这是 UI/agent parity——chip 等价于用户亲口说。
 *   2. 父组件未传 onSay 但传了 onOpenApp 且 chip 有 appKey → 直接打开
 *      WorkshopWindow（加速路径，跳过 agent 循环，供旧 surface 用）。
 *   3. 都没有 → 回落到 onPick(prompt)，填充输入框或直接发送给旧对话端点。
 *
 * 两种 layout：
 *   - 'grid' = 2 列大格子，用在空态里，每个 chip 都有足够大的点击区；
 *   - 'row'  = 单行横向滚动，用在消息上方，始终可见但不抢戏。
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { SKILL_PROMPTS, type SkillPrompt } from './skill-prompts';
import { resolveSkillAction } from './skill-chip-action';

export { resolveSkillAction };

export interface SkillChipRowProps {
  /** 对话式兜底：无 onSay / 无 appKey 路径可走时调用 */
  onPick: (prompt: string) => void;
  /** Agent-native 首选：把 skill 的 utterance 直接送给 AI 同桌 */
  onSay?: (utterance: string) => void;
  /** 加速路径：chip 有 appKey 且父组件提供时，绕过 agent 直接打开 WorkshopWindow */
  onOpenApp?: (appKey: WorkshopAppKey) => void;
  disabled?: boolean;
  variant?: 'grid' | 'row';
  className?: string;
}

export function SkillChipRow({
  onPick,
  onSay,
  onOpenApp,
  disabled,
  variant = 'grid',
  className,
}: SkillChipRowProps) {
  // 点击反馈：记录刚被点的 chip 标签 + 一个递增 key 让动画可以重播
  const [tappedLabel, setTappedLabel] = React.useState<string | null>(null);
  const tappedNonceRef = React.useRef(0);
  const tapResetTimerRef = React.useRef<number | null>(null);

  const handleClick = React.useCallback(
    (skill: SkillPrompt) => {
      // 立即弹一次微弱缩放 + check 淡入淡出，让用户知道"我收到了"
      tappedNonceRef.current += 1;
      setTappedLabel(skill.label);
      if (tapResetTimerRef.current) window.clearTimeout(tapResetTimerRef.current);
      tapResetTimerRef.current = window.setTimeout(() => setTappedLabel(null), 440);

      const action = resolveSkillAction(skill, { onSay, onOpenApp });
      if (action.kind === 'say') onSay!(action.utterance);
      else if (action.kind === 'app') onOpenApp!(action.appKey);
      else onPick(action.prompt);
    },
    [onSay, onOpenApp, onPick],
  );

  React.useEffect(() => {
    return () => {
      if (tapResetTimerRef.current) window.clearTimeout(tapResetTimerRef.current);
    };
  }, []);

  if (variant === 'row') {
    return (
      <div
        className={cn(
          'flex gap-1.5 overflow-x-auto px-5 pb-2 pt-1',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          className,
        )}
        role="list"
      >
        {SKILL_PROMPTS.map((s) => {
          const tapped = tappedLabel === s.label;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => handleClick(s)}
              disabled={disabled}
              className={cn(
                'relative inline-flex flex-shrink-0 items-center gap-1.5 rounded-full',
                'border border-[#E9E9E7] bg-white px-3 py-1.5 text-[11.5px] text-ink-secondary',
                'transition-colors hover:border-[#CECEC8] hover:text-ink',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                tapped && 'chip-tap-anim',
              )}
              title={s.prompt}
              role="listitem"
            >
              <span>{s.label}</span>
              {tapped && (
                <span
                  aria-hidden
                  className="chip-tap-check pointer-events-none absolute -right-1 -top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ink text-[9px] font-bold text-white"
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('mx-auto mt-4 grid w-full max-w-md grid-cols-2 gap-2', className)}>
      {SKILL_PROMPTS.map((s) => {
        const tapped = tappedLabel === s.label;
        return (
          <button
            key={s.label}
            type="button"
            onClick={() => handleClick(s)}
            disabled={disabled}
            className={cn(
              'relative flex items-center rounded-2xl bg-white px-3.5 py-2.5 text-left text-[13px] text-ink',
              'ring-[0.5px] ring-[#232322]/[0.08] transition',
              'hover:ring-[#232322]/[0.22] hover:-translate-y-[1px]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              tapped && 'chip-tap-anim',
            )}
            title={s.prompt}
          >
            <span className="truncate font-medium tracking-[-0.005em]">{s.label}</span>
            {tapped && (
              <span
                aria-hidden
                className="chip-tap-check pointer-events-none absolute -right-1.5 -top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[9px] font-bold text-white"
              >
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SkillChipRow;
