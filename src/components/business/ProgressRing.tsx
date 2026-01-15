import * as React from "react"
import { cn } from "@/lib/utils"

interface ProgressRingProps {
  value: number
  max?: number
  size?: "sm" | "md" | "lg" | "xl"
  strokeWidth?: number
  variant?: "default" | "ink" | "vermilion" | "celadon" | "gradient"
  showValue?: boolean
  label?: string
  className?: string
}

const sizeConfig = {
  sm: { size: 48, fontSize: "text-xs" },
  md: { size: 72, fontSize: "text-sm" },
  lg: { size: 96, fontSize: "text-lg" },
  xl: { size: 128, fontSize: "text-2xl" },
}

const variantConfig = {
  default: "stroke-primary",
  ink: "stroke-ink",
  vermilion: "stroke-vermilion",
  celadon: "stroke-celadon",
  gradient: "stroke-[url(#progress-gradient)]",
}

export function ProgressRing({
  value,
  max = 100,
  size = "md",
  strokeWidth = 4,
  variant = "default",
  showValue = true,
  label,
  className,
}: ProgressRingProps) {
  const { size: svgSize, fontSize } = sizeConfig[size]
  const radius = (svgSize - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)
  const offset = circumference - (percentage / 100) * circumference

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg
        width={svgSize}
        height={svgSize}
        className="transform -rotate-90"
      >
        <defs>
          <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--vermilion)" />
            <stop offset="50%" stopColor="var(--gold)" />
            <stop offset="100%" stopColor="var(--celadon)" />
          </linearGradient>
        </defs>
        
        {/* Background circle */}
        <circle
          cx={svgSize / 2}
          cy={svgSize / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-ink/10"
        />
        
        {/* Progress circle */}
        <circle
          cx={svgSize / 2}
          cy={svgSize / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            "transition-all duration-700 ease-out",
            variant === "gradient" ? "" : variantConfig[variant]
          )}
          style={variant === "gradient" ? { stroke: "url(#progress-gradient)" } : undefined}
        />
      </svg>
      
      {showValue && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-bold text-ink", fontSize)}>
            {Math.round(percentage)}%
          </span>
          {label && (
            <span className="text-xs text-muted-foreground mt-0.5">{label}</span>
          )}
        </div>
      )}
    </div>
  )
}
