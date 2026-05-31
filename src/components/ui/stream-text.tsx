'use client';

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · StreamText
 *
 * 流式输出包装器：把传入的字符串拆成字符 span，每个 stagger 浮现 + 末尾常驻 caret。
 * 这是 AI 流式输出的视觉签名——**不能**用通用 typing 库，必须用这个。
 *
 *   <StreamText text="想给你打个比喻…" />
 *   <StreamText text={liveBuf} cursor={isStreaming} />
 *
 * 如果 text 不断更新（流式补全），组件只对"新增字符"做 stagger，旧字符保持原位。
 */
export interface StreamTextProps extends Omit<React.HTMLAttributes<HTMLParagraphElement>, 'children'> {
  /** 要逐字浮现的文本 */
  text: string
  /** 单字符延迟（秒）。默认 0.025s */
  step?: number
  /** 末尾是否显示墨绿光标 */
  cursor?: boolean
  /** 是否每次 text 变化都重新动画（默认 false：只对增量字符动画） */
  resetOnChange?: boolean
}

export const StreamText = React.forwardRef<HTMLParagraphElement, StreamTextProps>(
  ({ className, text, step = 0.025, cursor = true, resetOnChange = false, ...props }, ref) => {
    const prevLenRef = React.useRef(0)
    const baseDelayRef = React.useRef(0)

    // 当 text 缩短或 resetOnChange 时，重置基线
    React.useEffect(() => {
      if (resetOnChange || text.length < prevLenRef.current) {
        prevLenRef.current = 0
        baseDelayRef.current = 0
      }
    }, [text, resetOnChange])

    const chars = React.useMemo(() => {
      const result: { ch: string; delay: number; isNew: boolean }[] = []
      for (let i = 0; i < text.length; i++) {
        const isNew = i >= prevLenRef.current
        // 旧字符 delay = 0（已浮现），新字符按相对偏移
        const delay = isNew ? (i - prevLenRef.current) * step : 0
        result.push({ ch: text[i], delay, isNew })
      }
      // 提交本轮长度，下次再来时这些字符就是"老人"了
      prevLenRef.current = text.length
      return result
    }, [text, step])

    return (
      <p
        ref={ref}
        className={cn("stream", className)}
        {...props}
      >
        {chars.map((c, i) => (
          <span
            key={`${i}-${c.ch}`}
            style={c.isNew ? { animationDelay: `${c.delay}s` } : { opacity: 1, transform: 'translateY(0)' }}
          >
            {c.ch}
          </span>
        ))}
        {cursor && <span className="typing-caret" aria-hidden />}
      </p>
    )
  }
)
StreamText.displayName = "StreamText"
