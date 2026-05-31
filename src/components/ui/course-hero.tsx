'use client';

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · CourseHero
 *
 * 课中 / 复习态用的课程主题卡。
 * - variant="live" 时带 AI 在场光带（surface-ai）
 * - variant="review" 时静态卡，更稳重
 *
 *   <CourseHero
 *     variant="live"
 *     eyebrow="本节正在听 · LIVE"
 *     title="TCP 可靠传输的三道关"
 *     emTitle="三道关"
 *     meta={[
 *       '计算机网络 · 第 7 讲',
 *       '张老师',
 *       <span className="font-mono">23 分钟</span>,
 *       <Pulse>Octo 已理解 76%</Pulse>,
 *     ]}
 *   />
 */
export interface CourseHeroProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: 'live' | 'review'
  /** 顶部小标签 · MONO */
  eyebrow?: string
  /** 主标题 */
  title?: React.ReactNode
  /** 标题中要替换为 italic + 朱批红的部分 */
  emTitle?: string
  /** 元数据列表（点分隔），可包含 ReactNode */
  meta?: React.ReactNode[]
  /** 右侧自定义内容（如进度环） */
  trailing?: React.ReactNode
}

export const CourseHero = React.forwardRef<HTMLDivElement, CourseHeroProps>(
  ({
    className,
    variant = 'live',
    eyebrow,
    title,
    emTitle,
    meta = [],
    trailing,
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
          "rounded-xl border bg-card",
          variant === 'live'
            ? "border-divider surface-ai"
            : "border-divider shadow-soft",
          className,
        )}
        {...props}
      >
        <div className={cn(
          "relative z-10 flex items-center gap-5 px-7 py-6",
          variant === 'review' && "py-5",
        )}>
          <div className="flex-1 min-w-0">
            {eyebrow && (
              <p className="font-mono text-[11px] font-semibold uppercase tracking-caps text-pine mb-2">
                {eyebrow}
              </p>
            )}
            {title && (
              <h1 className={cn(
                "font-semibold leading-tight text-ink",
                variant === 'live' ? "text-3xl tracking-display" : "text-2xl tracking-h",
              )}>
                {titleNode}
              </h1>
            )}
            {meta.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                {meta.map((item, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span aria-hidden className="text-divider">·</span>}
                    <span>{item}</span>
                  </React.Fragment>
                ))}
              </div>
            )}
            {children}
          </div>
          {trailing && <div className="shrink-0">{trailing}</div>}
        </div>
      </div>
    )
  }
)
CourseHero.displayName = "CourseHero"


/**
 * 配合 CourseHero meta 用的"AI 已理解 X%"——前面带墨绿 pulsing dot
 */
export interface CourseHeroPulseProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'pine' | 'vermilion'
}
export const CourseHeroPulse = React.forwardRef<HTMLSpanElement, CourseHeroPulseProps>(
  ({ className, tone = 'pine', children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium",
        tone === 'pine' ? "text-pine" : "text-vermilion",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full animate-rec-pulse",
          tone === 'pine' ? "bg-pine" : "bg-vermilion",
        )}
      />
      {children}
    </span>
  )
)
CourseHeroPulse.displayName = "CourseHeroPulse"
