import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · Input
 *
 * Focus 用墨绿 ring（不是默认蓝），error 用朱批。
 * 尺寸：h-10 默认（移动端友好），h-8 紧凑。
 */
export interface InputProps extends React.ComponentProps<"input"> {
  /** 错误态：边框 + ring 切到朱批红 */
  error?: boolean
  /** 紧凑尺寸（h-8） */
  compact?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, compact, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // base
          "flex w-full rounded-md border bg-card text-ink",
          "px-3 py-1.5 text-sm",
          "transition-all duration-150 ease-out",
          "placeholder:text-ink-faint",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink-secondary",
          // states
          "border-divider hover:border-ink-muted",
          "focus-visible:outline-none focus-visible:border-pine focus-visible:ring-2 focus-visible:ring-pine/15",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-paper-warm",
          // sizes
          compact ? "h-8" : "h-10",
          // error
          error && "border-vermilion focus-visible:border-vermilion focus-visible:ring-vermilion/15",
          className,
        )}
        aria-invalid={error || undefined}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
