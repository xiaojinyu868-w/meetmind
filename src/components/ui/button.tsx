import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · Button
 *
 * 设计哲学：
 * - 主按钮 = Pine（默认，表达智能与继续）
 * - Pine = AI 主动型动作（生成、整理）
 * - Vermilion = 此刻 / 重要操作（分享、标注）
 * - Ghost = 日常 80% 用这个
 * - Danger = 删除 / 撤销
 *
 * 微动效：默认 hover 上浮 0.5px，active 缩 0.97。AI 类型 hover 加 ai-glow。
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md font-medium tracking-tight",
    "transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/20",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:scale-[0.97]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // ===== v7 主力 variant =====
        default:
          "bg-pine text-white hover:bg-pine-deep hover:-translate-y-px",
        pine:
          "bg-pine text-white hover:bg-pine-deep hover:-translate-y-px shadow-soft hover:shadow-card",
        vermilion:
          "bg-vermilion text-white hover:bg-vermilion-deep hover:-translate-y-px shadow-soft hover:shadow-card",
        ghost:
          "bg-transparent text-ink-secondary border border-divider hover:bg-paper-warm hover:text-ink hover:border-ink-muted",
        naked:
          "bg-transparent text-ink-secondary hover:bg-paper-warm hover:text-ink",
        link:
          "bg-transparent text-pine hover:underline underline-offset-4 decoration-pine-light p-0 h-auto",
        danger:
          "bg-transparent text-vermilion border border-vermilion-mist hover:bg-vermilion hover:text-white hover:border-vermilion",

        // ===== v6 兼容（继续支持现有调用点） =====
        destructive:
          "bg-vermilion text-white hover:bg-vermilion-deep",
        outline:
          "border border-divider bg-card hover:bg-paper-warm hover:text-ink",
        secondary:
          "bg-paper-warm text-ink hover:bg-paper-deep",
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm:      "h-7 rounded-sm px-3 text-xs",
        md:      "h-9 px-4 text-sm",
        lg:      "h-11 rounded-md px-6 text-base",
        xl:      "h-13 rounded-lg px-8 text-md font-semibold",
        icon:    "h-9 w-9 p-0",
        "icon-sm": "h-7 w-7 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size:    "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** 显示 loading spinner（按钮变 disabled，文字隐藏，spinner 居中） */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          loading && "relative cursor-wait [&>:not(.btn-spinner)]:opacity-0",
        )}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {children}
        {loading && (
          <span
            className="btn-spinner absolute inset-0 flex items-center justify-center opacity-100"
            aria-hidden
          >
            <svg
              className="size-4 animate-spin"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle
                cx="8" cy="8" r="6"
                stroke="currentColor" strokeOpacity="0.25" strokeWidth="2"
              />
              <path
                d="M14 8a6 6 0 00-6-6"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              />
            </svg>
          </span>
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
