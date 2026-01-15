import * as React from "react"
import { cn } from "@/lib/utils"

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg"
  variant?: "default" | "dots" | "pulse" | "ink"
  className?: string
}

export function LoadingSpinner({ 
  size = "md", 
  variant = "default",
  className 
}: LoadingSpinnerProps) {
  const sizes = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  }

  if (variant === "dots") {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "rounded-full bg-primary animate-bounce",
              size === "sm" && "w-1.5 h-1.5",
              size === "md" && "w-2 h-2",
              size === "lg" && "w-3 h-3"
            )}
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    )
  }

  if (variant === "pulse") {
    return (
      <div className={cn("relative", sizes[size], className)}>
        <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
        <span className="absolute inset-2 rounded-full bg-primary" />
      </div>
    )
  }

  if (variant === "ink") {
    return (
      <div className={cn("relative", sizes[size], className)}>
        <svg viewBox="0 0 50 50" className="animate-spin">
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="80, 200"
            className="text-ink/20"
          />
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="80, 200"
            strokeDashoffset="-15"
            className="text-ink"
          />
        </svg>
      </div>
    )
  }

  return (
    <div className={cn("relative", sizes[size], className)}>
      <svg viewBox="0 0 50 50" className="animate-spin">
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="80, 200"
          className="text-primary/20"
        />
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="80, 200"
          strokeDashoffset="-15"
          className="text-primary"
        />
      </svg>
    </div>
  )
}

interface LoadingOverlayProps {
  message?: string
  className?: string
}

export function LoadingOverlay({ message, className }: LoadingOverlayProps) {
  return (
    <div className={cn(
      "fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper/80 backdrop-blur-sm",
      className
    )}>
      <LoadingSpinner size="lg" variant="ink" />
      {message && (
        <p className="mt-4 text-sm text-ink/60 animate-pulse">{message}</p>
      )}
    </div>
  )
}

interface LoadingCardProps {
  lines?: number
  className?: string
}

export function LoadingCard({ lines = 3, className }: LoadingCardProps) {
  return (
    <div className={cn("p-5 space-y-4 rounded-xl bg-card border border-border/50", className)}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-ink/10 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/3 rounded bg-ink/10 animate-pulse" />
          <div className="h-3 w-1/4 rounded bg-ink/5 animate-pulse" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3 rounded bg-ink/10 animate-pulse"
            style={{ width: `${100 - i * 15}%`, animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  )
}
