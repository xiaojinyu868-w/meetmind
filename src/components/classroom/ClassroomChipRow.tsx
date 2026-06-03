'use client';

/**
 * ClassroomChipRow —— 课堂同桌 composer 上方的 chip 行（M14）
 *
 * 两区结构（左稳定 + 右动态）：
 *
 *   [刚才那段] [我没跟上] [记一下]   ·   [动态chip]  [动态chip]
 *   ←———— 稳定区 3 个，永远在 ————→     ←—— AI 写的最多 2 个 ——→
 *
 * 稳定区：肌肉记忆，按钮文案不变；点了发出固定 utterance（除"记一下"是客户端动作）。
 *   - 「刚才那段」 → 发送 "请回放刚才那段，把核心讲一句"
 *   - 「我没跟上」 → 发送 "我刚没跟上，从断点把主线接给我"
 *   - 「记一下」 → onMarkMoment 客户端给当前转录段打标，不发对话
 *
 * 动态区：useClassroomChipPulse 后台 30s 一次写候选 chip 缓存到 IndexedDB。
 *   完全由 AI 决定写什么；用户**不点也行**，不强制读。
 *
 * 设计哲学（v7 + AI-native）：
 *   - 视觉极克制：纸感底 + divider 边，hover 时 pine 光晕，无饱和色
 *   - 不抢主位：永远在 textarea 上方，不和发送按钮争视觉
 *   - 稳定 chip 永远显示（不靠 focus 浮现）—— 用户说这是肌肉记忆
 *   - 动态 chip 数量软约束 0-2 个，没有就不显示分隔点
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export type ClassroomStableChipKind = 'recap' | 'catch-up' | 'mark-moment';

export interface ClassroomDynamicChip {
  /** 稳定 id 用于 React key 和命中判断 */
  id: string;
  /** 显示文案 + 点击发送的 utterance（同一段文本，AI 自己写多长由模型决定） */
  text: string;
}

export interface ClassroomChipRowProps {
  /** 稳定 chip 的回调 —— 'recap' / 'catch-up' 是发 utterance；'mark-moment' 是客户端动作 */
  onPickStable: (kind: ClassroomStableChipKind, utterance?: string) => void;
  /** 动态 chip 列表（最多 2 个，多的截掉） */
  dynamicChips?: ClassroomDynamicChip[];
  /** 点动态 chip → 发送 utterance（与 chip 文案一致） */
  onPickDynamic?: (chip: ClassroomDynamicChip) => void;
  /** busy 时禁用所有 chip（AI 正在回话，避免连发） */
  disabled?: boolean;
  className?: string;
}

const STABLE_CHIPS: Array<{
  kind: ClassroomStableChipKind;
  label: string;
  /** 点击发送的 utterance；mark-moment 不发 */
  utterance?: string;
}> = [
  {
    kind: 'recap',
    label: '刚才那段',
    utterance: '请回放刚才那段，把核心用一句话讲清楚。',
  },
  {
    kind: 'catch-up',
    label: '我没跟上',
    utterance: '我刚没跟上，从断点把主线最少必要的信息接给我，让我能继续在场。',
  },
  {
    kind: 'mark-moment',
    label: '记一下',
    // 客户端动作，不发 utterance
  },
];

export function ClassroomChipRow({
  onPickStable,
  dynamicChips = [],
  onPickDynamic,
  disabled = false,
  className,
}: ClassroomChipRowProps) {
  const visibleDynamic = dynamicChips.slice(0, 2);

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5 px-1', className)}
      role="group"
      aria-label="课堂同桌快捷动作"
    >
      {/* 稳定区：永远在，肌肉记忆 */}
      {STABLE_CHIPS.map((chip) => (
        <button
          key={chip.kind}
          type="button"
          disabled={disabled}
          onClick={() => onPickStable(chip.kind, chip.utterance)}
          className={cn(
            'inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] transition-all duration-150',
            disabled
              ? 'cursor-not-allowed border-divider bg-paper-warm/40 text-ink-muted/60'
              : 'border-divider bg-paper-warm text-ink-secondary hover:border-pine/50 hover:bg-pine-fog/40 hover:text-pine active:scale-[0.98]',
          )}
        >
          {chip.label}
        </button>
      ))}

      {/* 分隔点 + 动态区（仅在有动态 chip 时显示） */}
      {visibleDynamic.length > 0 ? (
        <>
          <span className="mx-1 select-none text-ink-muted/40" aria-hidden>
            ·
          </span>
          {visibleDynamic.map((chip) => (
            <button
              key={chip.id}
              type="button"
              disabled={disabled}
              onClick={() => onPickDynamic?.(chip)}
              title={chip.text}
              className={cn(
                'inline-flex max-w-[14rem] items-center rounded-full border px-3 py-1 text-[12px] transition-all duration-150',
                'animate-in fade-in slide-in-from-right-1 duration-200',
                disabled
                  ? 'cursor-not-allowed border-divider/60 bg-canvas/50 text-ink-muted/60'
                  : 'border-divider/70 bg-canvas/70 text-ink-muted hover:border-pine/40 hover:bg-pine-fog/30 hover:text-pine-deep active:scale-[0.98]',
              )}
            >
              <span className="truncate">{chip.text}</span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}

export default ClassroomChipRow;
