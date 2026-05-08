'use client';

/**
 * SkillChipRow — 共享的 Skill 启发条（组件）
 *
 * 数据目录（SKILL_PROMPTS / SkillPrompt）放在 ./skill-prompts.ts（纯 TS，可在
 * node 测试环境里直接 import）。本文件只负责 JSX。
 *
 * 分发策略（M7-fix10）：
 *   - chip 有 appKey 且父组件传了 onOpenApp → 打开 WorkshopWindow（走真实 plugin）
 *   - 否则 → 回落到 onPick(prompt) 走 /api/tutor 对话
 * 这让"考试速查表 / 闪卡 / 测验 / 思维导图 / 学习报告"从聊天回复升级为
 * 结构化应用卡片，和 AI 工坊里的应用矩阵走同一条链，不再重复造轮子。
 *
 * 两种 layout：
 *   - 'grid' = 2 列大格子，用在空态里，每个 chip 都有足够大的点击区；
 *   - 'row'  = 单行横向滚动，用在消息上方，始终可见但不抢戏。
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { SKILL_PROMPTS, type SkillPrompt } from './skill-prompts';

export interface SkillChipRowProps {
  /** 对话式兜底：无 appKey 的 chip 被点击时调用 */
  onPick: (prompt: string) => void;
  /** 应用式首选：chip 有 appKey 且父组件提供时，点击打开对应 WorkshopWindow */
  onOpenApp?: (appKey: WorkshopAppKey) => void;
  disabled?: boolean;
  variant?: 'grid' | 'row';
  className?: string;
}

/**
 * 决定一个 chip 被点击时走哪条路径：
 *   - 有 appKey 且有 onOpenApp → onOpenApp(appKey)
 *   - 否则 → onPick(prompt)
 * 抽成纯函数，方便单测（skill-prompts.test.ts 里直接验证分发意图）。
 */
export function resolveSkillAction(
  skill: SkillPrompt,
  onOpenApp?: (appKey: WorkshopAppKey) => void,
): { kind: 'app'; appKey: WorkshopAppKey } | { kind: 'prompt'; prompt: string } {
  if (skill.appKey && onOpenApp) {
    return { kind: 'app', appKey: skill.appKey };
  }
  return { kind: 'prompt', prompt: skill.prompt };
}

export function SkillChipRow({
  onPick,
  onOpenApp,
  disabled,
  variant = 'grid',
  className,
}: SkillChipRowProps) {
  const handleClick = React.useCallback(
    (skill: SkillPrompt) => {
      const action = resolveSkillAction(skill, onOpenApp);
      if (action.kind === 'app') onOpenApp!(action.appKey);
      else onPick(action.prompt);
    },
    [onOpenApp, onPick],
  );

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
        {SKILL_PROMPTS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => handleClick(s)}
            disabled={disabled}
            className={cn(
              'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full',
              'border border-[#E9E9E7] bg-white px-3 py-1.5 text-[11.5px] text-ink-secondary',
              'transition-colors hover:border-[#CECEC8] hover:text-ink',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            title={s.prompt}
            role="listitem"
          >
            <span aria-hidden="true">{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('mx-auto mt-4 grid w-full max-w-md grid-cols-2 gap-2', className)}>
      {SKILL_PROMPTS.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => handleClick(s)}
          disabled={disabled}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
            'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          title={s.prompt}
        >
          <span aria-hidden="true" className="text-base">{s.icon}</span>
          <span className="truncate">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

export default SkillChipRow;
