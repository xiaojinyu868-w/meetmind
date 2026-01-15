import * as React from "react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card"
import { Badge } from "../ui/badge"
import { Progress } from "../ui/progress"

interface LearningCardProps {
  title: string
  subject?: string
  progress?: number
  duration?: string
  date?: string
  status?: "new" | "in_progress" | "completed" | "review"
  onClick?: () => void
  className?: string
  children?: React.ReactNode
}

const statusConfig = {
  new: { label: "新课程", variant: "default" as const },
  in_progress: { label: "学习中", variant: "secondary" as const },
  completed: { label: "已完成", variant: "outline" as const },
  review: { label: "待复习", variant: "destructive" as const },
}

export function LearningCard({
  title,
  subject,
  progress,
  duration,
  date,
  status,
  onClick,
  className,
  children,
}: LearningCardProps) {
  return (
    <Card
      className={cn(
        "group cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-ink/10 hover:-translate-y-1",
        className
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {subject && (
              <span className="text-xs font-medium text-celadon mb-1 block">
                {subject}
              </span>
            )}
            <CardTitle className="text-base md:text-lg line-clamp-2 group-hover:text-primary transition-colors">
              {title}
            </CardTitle>
          </div>
          {status && (
            <Badge variant={statusConfig[status].variant} className="shrink-0">
              {statusConfig[status].label}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {children}
        
        {(progress !== undefined || duration || date) && (
          <div className="mt-3 space-y-2">
            {progress !== undefined && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>学习进度</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-1.5" />
              </div>
            )}
            
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {duration && (
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {duration}
                </span>
              )}
              {date && (
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {date}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
