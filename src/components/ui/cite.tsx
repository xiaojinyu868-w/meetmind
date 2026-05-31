import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · Cite
 *
 * 引用资产化——MeetMind 的"有根" DNA。两种语义：
 * - <Cite kind="ts" value="20:01" />        → 朱批时间戳，跳回转录
 * - <Cite kind="src" value="资料 3" />      → 墨绿资料编号
 *
 * 视觉：胶囊 + JetBrains Mono + 双签名色之一
 */
export interface CiteProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 引用类型：ts = 时间戳（朱批红），src = 资料（墨松绿） */
  kind?: "ts" | "src"
  /** 显示文本（不含方括号），如 "20:01" 或 "资料 3" */
  value?: string
  /** 是否显示外层方括号（默认 true） */
  brackets?: boolean
  /** 点击回调（如跳回转录） */
  onActivate?: () => void
}

export const Cite = React.forwardRef<HTMLSpanElement, CiteProps>(
  ({ className, kind = "ts", value, brackets = true, onActivate, children, onClick, ...props }, ref) => {
    const inner = value ?? children
    const display = brackets ? `[${inner}]` : inner
    return (
      <span
        ref={ref}
        role={onActivate || onClick ? "button" : undefined}
        tabIndex={onActivate || onClick ? 0 : undefined}
        onClick={(e) => {
          onClick?.(e)
          onActivate?.()
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && (onActivate || onClick)) {
            e.preventDefault()
            onActivate?.()
          }
        }}
        className={cn(
          kind === "ts" ? "cite-ts" : "cite-src",
          className,
        )}
        {...props}
      >
        {display}
      </span>
    )
  }
)
Cite.displayName = "Cite"
