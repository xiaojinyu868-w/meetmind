import * as React from "react"
import { cn } from "@/lib/utils"

interface MobileNavProps {
  items: {
    id: string
    label: string
    icon: React.ReactNode
    href?: string
  }[]
  activeId?: string
  onItemClick?: (id: string) => void
  className?: string
}

export function MobileNav({ items, activeId, onItemClick, className }: MobileNavProps) {
  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 bg-paper/95 backdrop-blur-xl border-t border-ink/10 safe-area-pb",
        "md:hidden",
        className
      )}
    >
      <div className="flex items-center justify-around h-16 px-2">
        {items.map((item) => {
          const isActive = item.id === activeId
          return (
            <button
              key={item.id}
              onClick={() => onItemClick?.(item.id)}
              className={cn(
                "relative flex flex-col items-center justify-center flex-1 h-full transition-all duration-200",
                isActive ? "text-vermilion" : "text-ink/50 hover:text-ink/70"
              )}
            >
              {/* Active indicator - seal style */}
              {isActive && (
                <span className="absolute -top-0.5 w-8 h-1 bg-vermilion rounded-full" />
              )}
              
              {/* Icon */}
              <span
                className={cn(
                  "transition-transform duration-200",
                  isActive ? "scale-110" : ""
                )}
              >
                {item.icon}
              </span>
              
              {/* Label */}
              <span
                className={cn(
                  "text-xs mt-1 font-medium transition-all duration-200",
                  isActive ? "opacity-100" : "opacity-70"
                )}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

interface PageContainerProps {
  children: React.ReactNode
  hasBottomNav?: boolean
  hasTopNav?: boolean
  className?: string
}

export function PageContainer({
  children,
  hasBottomNav = true,
  hasTopNav = true,
  className,
}: PageContainerProps) {
  return (
    <main
      className={cn(
        "min-h-screen bg-paper",
        hasTopNav && "pt-16 md:pt-20",
        hasBottomNav && "pb-20 md:pb-0",
        className
      )}
    >
      {children}
    </main>
  )
}

interface SectionHeaderProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
  className?: string
}

export function SectionHeader({ title, subtitle, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-4", className)}>
      <div>
        <h2 className="text-lg md:text-xl font-semibold text-ink">{title}</h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  )
}
