'use client';

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { OctoAvatar, type OctoMood } from "./octo-avatar"

/**
 * MeetMind v7 · AppTopBar
 *
 * 全局应用顶栏。三段式：
 * - 左：品牌 (logo + dot) + breadcrumb（含分隔斜杠）
 * - 中：Octo 永驻胶囊（小头像 + 状态文字 · 全站 IP）
 * - 右：session meta（自定义内容） + 主/次按钮
 *
 * 用法：
 * ```tsx
 * <AppTopBar
 *   breadcrumb={[{ label: '计算机网络', href: '/courses/cs-network' }, '第 7 讲 · 课中']}
 *   octoMood="listening"
 *   octoLabel="Octo 在听"
 *   meta={<RecordingTimer />}
 *   actions={<>
 *     <Button variant="ghost" size="sm">分享一节</Button>
 *     <Button size="sm">结束这节课</Button>
 *   </>}
 * />
 * ```
 */

export type Breadcrumb =
  | string
  | { label: string; href?: string }

export interface AppTopBarProps extends React.HTMLAttributes<HTMLElement> {
  /** 面包屑链路（最末项自动加粗） */
  breadcrumb?: Breadcrumb[]
  /** Octo 永驻胶囊：表情 */
  octoMood?: OctoMood
  /** Octo 永驻胶囊：右侧文字（默认 "Octo 在这里"） */
  octoLabel?: string
  /** Octo 永驻胶囊：是否显示（true 默认；空课堂可关） */
  showOcto?: boolean
  /** Octo 永驻胶囊：点击 */
  onOctoClick?: () => void
  /** 中间或右侧自定义元数据（如录音计时） */
  meta?: React.ReactNode
  /** 右侧操作按钮组 */
  actions?: React.ReactNode
  /** 自定义 logo（替换 Brand 部分） */
  logo?: React.ReactNode
  /** sticky 固定到顶部 */
  sticky?: boolean
}

const Brand = React.memo(function Brand() {
  return (
    <Link
      href="/app"
      className="inline-flex items-center gap-2.5 font-semibold text-sm tracking-tight text-ink hover:text-pine transition-colors"
    >
      <span className="size-2 rounded-full bg-pine shadow-[0_0_0_3px_rgba(45,79,62,0.12)]" />
      <span>MeetMind</span>
    </Link>
  )
})

const BreadcrumbList = React.memo(function BreadcrumbList({
  items,
}: {
  items: Breadcrumb[]
}) {
  if (!items.length) return null
  return (
    <nav
      className="flex items-center gap-2 text-sm text-ink-muted ml-3"
      aria-label="breadcrumb"
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        const label = typeof item === "string" ? item : item.label
        const href = typeof item === "string" ? undefined : item.href

        return (
          <React.Fragment key={i}>
            <span aria-hidden className="text-divider select-none">/</span>
            {!isLast && href ? (
              <Link
                href={href}
                className="text-ink-secondary hover:text-pine transition-colors"
              >
                {label}
              </Link>
            ) : (
              <span
                className={cn(
                  isLast ? "text-ink font-medium" : "text-ink-secondary",
                )}
                aria-current={isLast ? "page" : undefined}
              >
                {label}
              </span>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
})

export const AppTopBar = React.forwardRef<HTMLElement, AppTopBarProps>(
  ({
    className,
    breadcrumb = [],
    octoMood = 'idle',
    octoLabel = 'Octo 在这里',
    showOcto = true,
    onOctoClick,
    meta,
    actions,
    logo,
    sticky = false,
    ...props
  }, ref) => {
    return (
      <header
        ref={ref}
        className={cn(
          "flex items-center gap-3 px-5 h-14 bg-paper border-b border-divider",
          sticky && "sticky top-0 z-40 backdrop-blur-md bg-paper/85",
          className,
        )}
        {...props}
      >
        {/* 左：logo + breadcrumb */}
        {logo ?? <Brand />}
        <BreadcrumbList items={breadcrumb} />

        {/* 中：Octo 永驻胶囊 */}
        {showOcto && (
          <button
            type="button"
            onClick={onOctoClick}
            className={cn(
              "ml-3 inline-flex items-center gap-2 pl-1 pr-3 py-0.5 rounded-full",
              "bg-paper-warm border border-divider",
              "text-xs text-ink-secondary",
              "transition-all duration-150 ease-out",
              "hover:bg-paper-deep hover:text-ink",
              !onOctoClick && "cursor-default pointer-events-none",
            )}
            title="你的学习同桌"
          >
            <OctoAvatar mood={octoMood} size="xs" aura />
            <span>{octoLabel}</span>
          </button>
        )}

        {/* 右：meta + 操作 */}
        <div className="ml-auto flex items-center gap-3 text-sm text-ink-secondary">
          {meta}
          {actions && (
            <div className="flex items-center gap-2">{actions}</div>
          )}
        </div>
      </header>
    )
  }
)
AppTopBar.displayName = "AppTopBar"
