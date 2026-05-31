'use client';

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · Composer
 *
 * 课中 / 复习态右栏的输入框。和 globals.css 已有的 .comp 不同——这是组件化版本。
 *
 *   <Composer
 *     placeholder="问 Octo 任何关于这节课的事…"
 *     onSend={(text) => send(text)}
 *     extra={<VoiceButton />}  // 可选语音按钮
 *   />
 *
 * Enter 发送，Shift+Enter 换行。空文本不触发。
 */
export interface ComposerProps {
  /** 占位文字 */
  placeholder?: string
  /** 发送回调（Enter 或点击按钮触发） */
  onSend?: (text: string) => void
  /** 自动 focus */
  autoFocus?: boolean
  /** 禁用 */
  disabled?: boolean
  /** 输入框最大行数（约束高度） */
  maxRows?: number
  /** 左侧 / 右侧额外内容（如语音按钮） */
  extra?: React.ReactNode
  /** 包裹容器 className */
  className?: string
}

export const Composer = React.forwardRef<HTMLTextAreaElement, ComposerProps>(
  ({ placeholder = '问点什么…', onSend, autoFocus, disabled, maxRows = 5, extra, className }, ref) => {
    const [text, setText] = React.useState('')
    const localRef = React.useRef<HTMLTextAreaElement>(null)
    React.useImperativeHandle(ref, () => localRef.current!)

    const handleSend = React.useCallback(() => {
      const trimmed = text.trim()
      if (!trimmed) return
      onSend?.(trimmed)
      setText('')
      // 复位高度
      if (localRef.current) localRef.current.style.height = 'auto'
    }, [onSend, text])

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        handleSend()
      }
    }, [handleSend])

    const handleInput = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value)
      const ta = e.target
      ta.style.height = 'auto'
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 22
      const maxHeight = lineHeight * maxRows
      ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`
    }, [maxRows])

    return (
      <div className={cn(
        "flex items-end gap-2 px-3 py-2.5",
        "rounded-xl bg-card border border-divider",
        "transition-all duration-150 ease-out",
        "focus-within:border-pine focus-within:ring-[3px] focus-within:ring-pine/8",
        disabled && "opacity-60 pointer-events-none",
        className,
      )}>
        <textarea
          ref={localRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          rows={1}
          className={cn(
            "flex-1 resize-none border-0 bg-transparent outline-none",
            "text-sm leading-snug text-ink",
            "placeholder:text-ink-faint",
            "min-h-[22px]",
            "py-1",
          )}
        />
        {extra}
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className={cn(
            "size-8 rounded-md grid place-items-center shrink-0",
            "bg-ink text-white",
            "transition-colors duration-150",
            "hover:bg-pine",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-ink",
          )}
          aria-label="发送"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    )
  }
)
Composer.displayName = "Composer"
