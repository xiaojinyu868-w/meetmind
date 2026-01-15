import * as React from "react"
import { cn } from "@/lib/utils"

interface AchievementBadgeProps {
  title: string
  description?: string
  icon?: React.ReactNode
  unlocked?: boolean
  rarity?: "common" | "rare" | "epic" | "legendary"
  date?: string
  onClick?: () => void
  className?: string
}

const rarityConfig = {
  common: {
    bg: "bg-ink/5",
    border: "border-ink/20",
    text: "text-ink/60",
    glow: "",
  },
  rare: {
    bg: "bg-celadon/10",
    border: "border-celadon/30",
    text: "text-celadon",
    glow: "shadow-lg shadow-celadon/20",
  },
  epic: {
    bg: "bg-vermilion/10",
    border: "border-vermilion/30",
    text: "text-vermilion",
    glow: "shadow-lg shadow-vermilion/20",
  },
  legendary: {
    bg: "bg-gradient-to-br from-gold/20 via-vermilion/10 to-celadon/20",
    border: "border-gold/40",
    text: "text-gold",
    glow: "shadow-xl shadow-gold/30",
  },
}

export function AchievementBadge({
  title,
  description,
  icon,
  unlocked = false,
  rarity = "common",
  date,
  onClick,
  className,
}: AchievementBadgeProps) {
  const config = rarityConfig[rarity]

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-center p-4 rounded-2xl border-2 transition-all duration-300",
        unlocked
          ? cn(config.bg, config.border, config.glow, "hover:scale-105")
          : "bg-ink/5 border-ink/10 opacity-50 grayscale",
        className
      )}
    >
      {/* Seal-like icon container */}
      <div
        className={cn(
          "relative w-16 h-16 rounded-full flex items-center justify-center mb-3 transition-transform duration-300",
          unlocked ? "group-hover:rotate-12" : ""
        )}
      >
        {/* Seal border effect */}
        <div
          className={cn(
            "absolute inset-0 rounded-full border-4 border-dashed",
            unlocked ? config.border : "border-ink/20"
          )}
          style={{
            borderRadius: "50%",
          }}
        />
        
        {/* Inner seal */}
        <div
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center",
            unlocked ? config.bg : "bg-ink/10"
          )}
        >
          {icon || (
            <svg
              className={cn("w-6 h-6", unlocked ? config.text : "text-ink/40")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Title */}
      <h4
        className={cn(
          "text-sm font-semibold text-center mb-1",
          unlocked ? "text-ink" : "text-ink/40"
        )}
      >
        {title}
      </h4>

      {/* Description */}
      {description && (
        <p className="text-xs text-muted-foreground text-center line-clamp-2">
          {description}
        </p>
      )}

      {/* Date */}
      {unlocked && date && (
        <span className="mt-2 text-xs text-muted-foreground">{date}</span>
      )}

      {/* Lock overlay for locked badges */}
      {!unlocked && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-ink/5">
          <svg
            className="w-6 h-6 text-ink/30"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
      )}
    </button>
  )
}
