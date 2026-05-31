'use client';

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · SectionHeader
 *
 * 大段落标题 · 编号 + 标题 + 副标题，专用于 design-system / settings / 长页面分节。
 * 自动用 v7 排版：tracking-display + Instrument Serif italic em + 双签名色 eyebrow。
 *
 *   <SectionHeader
 *     num="01.1"
 *     eyebrow="DOUBLE SIGNATURE"
 *     title="双签名色"
 *     emTitle="色"
 *     description="..."
 *   />
 */
export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** 编号（mono 字体） */
  num?: string
  /** 上方小标签 */
  eyebrow?: string
  /** eyebrow 配色（默认墨绿） */
  eyebrowTone?: 'pine' | 'vermilion' | 'mute'
  /** 主标题 */
  title?: React.ReactNode
  /** 标题中要替换为 italic + 朱批红的部分 */
  emTitle?: string
  /** 副标题描述 */
  description?: React.ReactNode
  /** 尺寸：display = 超大 / h1 = 大 / h2 = 中（默认） / h3 = 小 */
  size?: 'display' | 'h1' | 'h2' | 'h3'
  /** 是否居中对齐 */
  center?: boolean
  /** 是否带底部分隔线 */
  divider?: boolean
}

const SIZE: Record<NonNullable<SectionHeaderProps['size']>, { title: string; lede: string; gap: string }> = {
  display: { title: 'text-5xl tracking-tightest', lede: 'text-lg', gap: 'gap-4' },
  h1:      { title: 'text-3xl tracking-display', lede: 'text-base', gap: 'gap-3' },
  h2:      { title: 'text-2xl tracking-h', lede: 'text-sm', gap: 'gap-2' },
  h3:      { title: 'text-lg tracking-h', lede: 'text-sm', gap: 'gap-1.5' },
}

const TONE: Record<NonNullable<SectionHeaderProps['eyebrowTone']>, string> = {
  pine: 'text-pine',
  vermilion: 'text-vermilion',
  mute: 'text-ink-muted',
}

export const SectionHeader = React.forwardRef<HTMLElement, SectionHeaderProps>(
  ({
    className,
    num,
    eyebrow,
    eyebrowTone = 'pine',
    title,
    emTitle,
    description,
    size = 'h2',
    center = false,
    divider = false,
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
      <header
        ref={ref}
        className={cn(
          "flex flex-col",
          SIZE[size].gap,
          center && "items-center text-center",
          divider && "pb-4 mb-6 border-b border-divider",
          className,
        )}
        {...props}
      >
        {(eyebrow || num) && (
          <p className={cn(
            "font-mono text-xs font-semibold uppercase tracking-caps",
            "flex items-center gap-2",
            center && "justify-center",
          )}>
            {num && (
              <span className="text-ink-muted">{num}</span>
            )}
            {eyebrow && (
              <span className={TONE[eyebrowTone]}>{eyebrow}</span>
            )}
          </p>
        )}
        {title && (
          <h2 className={cn(
            "font-semibold leading-tight text-ink",
            SIZE[size].title,
          )}>
            {titleNode}
          </h2>
        )}
        {description && (
          <p className={cn(
            "leading-relaxed text-ink-secondary max-w-[64ch]",
            SIZE[size].lede,
            center && "mx-auto",
          )}>
            {description}
          </p>
        )}
      </header>
    )
  }
)
SectionHeader.displayName = "SectionHeader"
