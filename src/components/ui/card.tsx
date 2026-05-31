import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · Card
 *
 * 4 个 variant：
 * - default：默认卡 · 1px 边线，无投影
 * - soft：浅投影（日常 80%）
 * - elevated：明显投影（hero / 重要内容）
 * - ai：AI 在场（surface-ai · 1px 墨绿 ring + 缓慢光带 · "AI 活着"）
 *
 * hoverable=true 时悬停上浮 + 边缘墨绿 + 投影变重
 */
const cardVariants = cva(
  "rounded-xl border bg-card text-ink transition-all",
  {
    variants: {
      variant: {
        default:  "border-divider",
        soft:     "border-divider shadow-soft",
        elevated: "border-divider shadow-card",
        ai:       "surface-ai", // 见 globals.css · ring + shimmer
      },
      hoverable: {
        true:  "cursor-pointer hover:-translate-y-0.5 hover:shadow-card hover:border-pine-light",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      hoverable: false,
    },
  }
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, hoverable, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, hoverable, className }))}
      {...props}
    />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "font-semibold leading-snug tracking-h text-ink",
      className,
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-ink-secondary leading-relaxed", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardEyebrow = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "font-mono text-xs uppercase tracking-caps text-pine font-semibold mb-2",
      className,
    )}
    {...props}
  />
))
CardEyebrow.displayName = "CardEyebrow"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardEyebrow,
  CardContent,
  cardVariants,
}
