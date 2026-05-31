import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · Skeleton
 *
 * 用 v7 的 .skel 类（globals.css 定义）— shimmer 横扫（米白底 + 浅米白光带），
 * 不再用 animate-pulse 的"全块明灭"。
 *
 * 用法：
 *   <Skeleton className="h-3 w-1/2" />        // 单行
 *   <Skeleton.Paragraph lines={5} />          // 段落
 *   <Skeleton.Cite />                          // [MM:SS] 形态的引用占位
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skel rounded-sm", className)}
      aria-busy
      aria-live="polite"
      {...props}
    />
  )
}

interface ParagraphProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 段落行数 */
  lines?: number
  /** 末行是否短一些（更像真实段落） */
  truncated?: boolean
}
Skeleton.Paragraph = function SkeletonParagraph({
  className,
  lines = 4,
  truncated = true,
  ...props
}: ParagraphProps) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => {
        const isLast = i === lines - 1
        // 长度梯度：让段落看起来自然
        const widths = ["w-full", "w-[92%]", "w-full", "w-[88%]", "w-[95%]"]
        const w = isLast && truncated ? "w-2/3" : widths[i % widths.length]
        return (
          <div key={i} className={cn("skel h-3 rounded-sm", w)} />
        )
      })}
    </div>
  )
}

Skeleton.Cite = function SkeletonCite({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "skel inline-block h-3.5 w-12 rounded-xs align-middle",
        className,
      )}
    />
  )
}

Skeleton.AppCard = function SkeletonAppCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-divider bg-card p-6",
        className,
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="skel size-7 rounded-md" />
        <div className="skel h-3.5 w-32 rounded-sm" />
      </div>
      <Skeleton.Paragraph lines={3} />
    </div>
  )
}

export { Skeleton }
