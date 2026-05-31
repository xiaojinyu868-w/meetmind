'use client';

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · SkillChip
 *
 * Octo 同桌右栏的"问题建议"chip。
 * - default：墨绿小点（常规问题）
 * - hot：朱批红小点（高优 / 当前最相关）
 * - 点击触发 onSelect（通常 = "把 chip 文字直接发送给同桌"）
 *
 *   <SkillChips>
 *     <SkillChip onSelect={send}>出一道选择题考我</SkillChip>
 *     <SkillChip hot onSelect={send}>这节最容易考的是什么</SkillChip>
 *   </SkillChips>
 */
export interface SkillChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  /** 是否高优（朱批红圆点） */
  hot?: boolean
  /** 选中回调（点击 = 直接发送） */
  onSelect?: () => void
}

export const SkillChip = React.forwardRef<HTMLButtonElement, SkillChipProps>(
  ({ className, hot, onSelect, children, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        onClick?.(e)
        onSelect?.()
      }}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs",
        "rounded-full bg-card border border-divider text-ink-secondary",
        "transition-all duration-150 ease-out",
        "hover:border-pine hover:text-pine hover:-translate-y-px hover:shadow-soft",
        "active:scale-[0.97]",
        "before:content-[''] before:size-1 before:rounded-full",
        hot ? "before:bg-vermilion" : "before:bg-pine-light",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
)
SkillChip.displayName = "SkillChip"


export const SkillChips = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-wrap gap-2 px-4 py-3 border-t border-divider/60",
        className,
      )}
      {...props}
    />
  )
)
SkillChips.displayName = "SkillChips"
