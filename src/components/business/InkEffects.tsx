import * as React from "react"
import { cn } from "@/lib/utils"

interface InkTransitionProps {
  children: React.ReactNode
  show?: boolean
  delay?: number
  duration?: number
  className?: string
}

export function InkTransition({
  children,
  show = true,
  delay = 0,
  duration = 600,
  className,
}: InkTransitionProps) {
  const [isVisible, setIsVisible] = React.useState(false)

  React.useEffect(() => {
    if (show) {
      const timer = setTimeout(() => setIsVisible(true), delay)
      return () => clearTimeout(timer)
    } else {
      setIsVisible(false)
    }
  }, [show, delay])

  return (
    <div
      className={cn(
        "transition-all ease-out",
        isVisible
          ? "opacity-100 translate-y-0 blur-0"
          : "opacity-0 translate-y-4 blur-sm",
        className
      )}
      style={{
        transitionDuration: `${duration}ms`,
      }}
    >
      {children}
    </div>
  )
}

interface InkSpreadProps {
  active?: boolean
  color?: string
  className?: string
}

export function InkSpread({ active = false, color = "var(--ink)", className }: InkSpreadProps) {
  return (
    <span
      className={cn(
        "absolute inset-0 rounded-inherit pointer-events-none overflow-hidden",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-500 ease-out",
          active ? "w-[200%] h-[200%] opacity-10" : "w-0 h-0 opacity-0"
        )}
        style={{ backgroundColor: color }}
      />
    </span>
  )
}

interface InkDropProps {
  x?: number
  y?: number
  size?: number
  color?: string
  className?: string
}

export function InkDrop({ x = 50, y = 50, size = 100, color = "var(--ink)", className }: InkDropProps) {
  const [isAnimating, setIsAnimating] = React.useState(true)

  React.useEffect(() => {
    const timer = setTimeout(() => setIsAnimating(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  if (!isAnimating) return null

  return (
    <span
      className={cn(
        "absolute rounded-full pointer-events-none animate-ink-drop",
        className
      )}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        height: size,
        backgroundColor: color,
        transform: "translate(-50%, -50%)",
      }}
    />
  )
}

interface StaggeredListProps {
  children: React.ReactNode[]
  staggerDelay?: number
  initialDelay?: number
  className?: string
}

export function StaggeredList({
  children,
  staggerDelay = 100,
  initialDelay = 0,
  className,
}: StaggeredListProps) {
  return (
    <div className={className}>
      {React.Children.map(children, (child, index) => (
        <InkTransition
          key={index}
          delay={initialDelay + index * staggerDelay}
          duration={500}
        >
          {child}
        </InkTransition>
      ))}
    </div>
  )
}
