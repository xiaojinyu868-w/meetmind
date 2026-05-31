'use client';

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · ThinkingStrip
 *
 * AI "思考气息流"——比 typing dots 重一档，比 spinner 轻一档。
 * 适合的场景：AI 在做检索 / 推理 / 对照历史，1-2s 的等待。
 *
 *   <ThinkingStrip>Octo 正在对照你前面问过的内容…</ThinkingStrip>
 */
export interface ThinkingStripProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 自动隐藏（毫秒）；如果 0 则不自动隐藏 */
  autoHideMs?: number
}

export const ThinkingStrip = React.forwardRef<HTMLDivElement, ThinkingStripProps>(
  ({ className, children, autoHideMs = 0, ...props }, ref) => {
    const [hidden, setHidden] = React.useState(false)

    React.useEffect(() => {
      if (!autoHideMs) return
      const t = window.setTimeout(() => setHidden(true), autoHideMs)
      return () => window.clearTimeout(t)
    }, [autoHideMs])

    if (hidden) return null

    return (
      <div
        ref={ref}
        role="status"
        aria-live="polite"
        className={cn("thinking-strip", className)}
        {...props}
      >
        {children}
      </div>
    )
  }
)
ThinkingStrip.displayName = "ThinkingStrip"


/**
 * MeetMind v7 · TypingDots
 * 三点跳动——最轻的等待形态。&lt; 0.5s 的 AI 在打字。
 */
export const TypingDots = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-label="正在输入"
      className={cn(
        "inline-flex gap-1 px-3 py-2 bg-paper-warm rounded-full",
        className,
      )}
      {...props}
    >
      {[0, 0.15, 0.3].map((delay, i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-ink-muted"
          style={{
            animation: `type-bounce 1.4s ease-in-out infinite ${delay}s`,
          }}
        />
      ))}
      <style jsx global>{`
        @keyframes type-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  )
)
TypingDots.displayName = "TypingDots"


/**
 * MeetMind v7 · BrewingStrip
 * "酿"指示器——后台理解中，比 thinking 更长更慢。
 * 适合"这节课还在沉淀，下次见面会更聪明"这种隐式状态。
 */
export const BrewingStrip = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "inline-flex items-center gap-2.5 px-4 py-3 rounded-md",
      "bg-paper-warm text-sm text-ink-secondary",
      className,
    )}
    {...props}
  >
    <span
      className="size-1.5 rounded-full bg-pine"
      style={{ animation: "brew-dot 2s ease-in-out infinite" }}
    />
    <span>{children}</span>
    <style jsx global>{`
      @keyframes brew-dot {
        0%, 100% { opacity: 0.3; transform: scale(0.8); }
        50%      { opacity: 1; transform: scale(1.3); }
      }
    `}</style>
  </div>
))
BrewingStrip.displayName = "BrewingStrip"
