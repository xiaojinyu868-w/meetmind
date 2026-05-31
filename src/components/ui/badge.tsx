import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · Badge
 *
 * variant：
 * - default：黑底白字（强调）
 * - pine：墨绿胶囊（AI / 已就绪 / 长期上下文）
 * - vermilion：朱批胶囊（此刻 / 警示 / 引用）
 * - sand：荧光笔黄
 * - mute：弱化标签
 *
 * dot=true 时左侧加同色小圆点（"已就绪 / 作答中 / 录音中"信号）
 */
const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "rounded-full px-2.5 py-0.5",
    "text-xs font-medium tracking-tight",
    "font-mono",
    "transition-colors",
  ].join(" "),
  {
    variants: {
      variant: {
        default:    "bg-ink text-white",
        pine:       "bg-pine-mist text-pine",
        vermilion:  "bg-vermilion-mist text-vermilion",
        sand:       "bg-sand text-vermilion-deep",
        mute:       "bg-paper-warm text-ink-secondary",
        outline:    "border border-divider text-ink-secondary bg-transparent",

        // ===== v6 兼容 =====
        secondary:    "bg-paper-warm text-ink-secondary",
        destructive:  "bg-vermilion text-white",
      },
      dot: {
        true:  "before:content-[''] before:size-1.5 before:rounded-full before:bg-current before:shrink-0",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      dot: false,
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, dot, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, dot }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
