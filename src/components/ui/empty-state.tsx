'use client';

import * as React from "react"
import { cn } from "@/lib/utils"
import { OctoAvatar, type OctoMood } from "./octo-avatar"

/**
 * MeetMind v7 · EmptyState
 *
 * 空态从来不"无聊"——用 Octo 表情 + 安静一句话 + 可选 CTA 化解。
 *
 *   <EmptyState
 *     mood="sleeping"
 *     eyebrow="ZERO STATE"
 *     title="课堂还没开始"
 *     emTitle="陪你听"
 *     description="把麦克风 / 电脑声 / 两路都录任选一个，我开始陪你听这节课。"
 *     action={<Button size="lg">开始这节课</Button>}
 *   />
 *
 * - title 中可用 emTitle 替换关键词为 italic + 朱批红
 */
export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Octo 表情 */
  mood?: OctoMood
  /** 上方小标签 · MONO 大写 */
  eyebrow?: string
  /** 主标题 */
  title?: React.ReactNode
  /** 标题中要替换为 italic + 朱批红的部分（自动包裹 em） */
  emTitle?: string
  /** 描述（可写多行） */
  description?: React.ReactNode
  /** 主要操作按钮（自带间距） */
  action?: React.ReactNode
  /** 次要操作（出现在主要操作下方） */
  secondaryAction?: React.ReactNode
  /** 边框样式 */
  bordered?: boolean
  /** 紧凑模式（小尺寸） */
  compact?: boolean
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({
    className,
    mood = 'sleeping',
    eyebrow,
    title,
    emTitle,
    description,
    action,
    secondaryAction,
    bordered = true,
    compact = false,
    children,
    ...props
  }, ref) => {
    const titleNode = React.useMemo(() => {
      if (typeof title !== 'string' || !emTitle) return title
      const idx = title.indexOf(emTitle)
      if (idx < 0) return title
      return (
        <>
          {title.slice(0, idx)}
          <span className="font-serif italic font-normal text-vermilion">
            {emTitle}
          </span>
          {title.slice(idx + emTitle.length)}
        </>
      )
    }, [title, emTitle])

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center text-center",
          "rounded-2xl bg-card",
          bordered && "border border-dashed border-divider",
          compact ? "px-6 py-10 gap-3" : "px-8 py-14 gap-4",
          className,
        )}
        {...props}
      >
        <OctoAvatar
          mood={mood}
          size={compact ? "lg" : "xl"}
          aura={false}
          className="opacity-90"
        />
        {eyebrow && (
          <p className="font-mono text-[11px] font-semibold uppercase tracking-caps text-pine">
            {eyebrow}
          </p>
        )}
        {title && (
          <h3 className={cn(
            "font-semibold tracking-h text-ink",
            compact ? "text-base" : "text-lg",
          )}>
            {titleNode}
          </h3>
        )}
        {description && (
          <p className={cn(
            "text-ink-secondary leading-relaxed max-w-md",
            compact ? "text-xs" : "text-sm",
          )}>
            {description}
          </p>
        )}
        {children}
        {action && <div className="mt-2">{action}</div>}
        {secondaryAction && (
          <div className="mt-1 text-xs text-ink-muted">{secondaryAction}</div>
        )}
      </div>
    )
  }
)
EmptyState.displayName = "EmptyState"
