'use client';

import * as React from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"

/**
 * MeetMind v7 · OctoAvatar
 *
 * Octo 头像 wrapper。包含：
 * - 米白渐变底盘
 * - 呼吸光环（octo-aura，墨绿光晕 3.6s 缓慢呼吸）
 * - 8 种 mood 状态对应不同 PNG 资产
 * - 可选 status dot（pine = 在线 / vermilion = 录音中）
 *
 * 与现有 OctoBuddy（位置自由的浮动 IP）互补——这是固定尺寸的"头像"原子。
 * 内部用 next/Image 自动优化（避免 LCP 警告）。
 */
export type OctoMood =
  | 'idle' | 'listening' | 'thinking' | 'happy'
  | 'surprised' | 'love' | 'sleeping' | 'original'

const MOOD_ASSET: Record<OctoMood, string> = {
  idle:      '/images/octo-buddy/idle.png',
  listening: '/images/octo-buddy/excited.png',
  thinking:  '/images/octo-buddy/thinking.png',
  happy:     '/images/octo-buddy/happy.png',
  surprised: '/images/octo-buddy/surprised.png',
  love:      '/images/octo-buddy/love.png',
  sleeping:  '/images/octo-buddy/sleeping.png',
  original:  '/images/octo-buddy/original.png',
}

/* 单位 px，next/Image 需要数字 */
const IMG_PX: Record<NonNullable<OctoAvatarProps['size']>, number> = {
  xs: 20,
  sm: 28,
  md: 32,
  lg: 48,
  xl: 80,
  '2xl': 144,
}

const SIZE_CLASS: Record<NonNullable<OctoAvatarProps['size']>, string> = {
  xs: 'size-6',
  sm: 'size-9',
  md: 'size-11',
  lg: 'size-16',
  xl: 'size-24',
  '2xl': 'size-40',
}

const IMG_CLASS: Record<NonNullable<OctoAvatarProps['size']>, string> = {
  xs: 'size-5',
  sm: 'size-7',
  md: 'size-8',
  lg: 'size-12',
  xl: 'size-20',
  '2xl': 'size-36',
}

export interface OctoAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 表情 / 状态 */
  mood?: OctoMood
  /** 尺寸 */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  /** 是否显示呼吸光环（默认 true） */
  aura?: boolean
  /** 状态点：pine = 在线，vermilion = 录音中 / 重要 */
  statusDot?: 'pine' | 'vermilion' | null
  /** 监听态：图片轻微摇摆 */
  animated?: boolean
  /** 优先加载（hero / above-fold 用） */
  priority?: boolean
}

export const OctoAvatar = React.forwardRef<HTMLDivElement, OctoAvatarProps>(
  ({
    className,
    mood = 'idle',
    size = 'md',
    aura = true,
    statusDot = null,
    animated = true,
    priority = false,
    ...props
  }, ref) => {
    const moodAnim =
      mood === 'listening' ? 'animate-octo-listen' :
      mood === 'thinking'  ? 'animate-octo-think' :
      ''

    return (
      <div
        ref={ref}
        className={cn(
          "relative inline-grid place-items-center rounded-full shrink-0",
          "bg-[radial-gradient(circle_at_35%_30%,#FFFFFF_0%,#F2EDE3_70%,#E8E0CE_100%)]",
          "border border-divider",
          aura && "octo-aura",
          SIZE_CLASS[size],
          className,
        )}
        data-mood={mood}
        {...props}
      >
        <Image
          src={MOOD_ASSET[mood]}
          alt=""
          aria-hidden
          width={IMG_PX[size]}
          height={IMG_PX[size]}
          draggable={false}
          priority={priority}
          unoptimized
          className={cn(
            "object-contain pointer-events-none select-none",
            IMG_CLASS[size],
            animated && moodAnim,
          )}
        />
        {statusDot && (
          <span
            className={cn(
              "absolute bottom-0 right-0",
              "size-2.5 rounded-full",
              "border-2 border-card",
              statusDot === 'pine'      && "bg-pine",
              statusDot === 'vermilion' && "bg-vermilion animate-rec-pulse",
            )}
            aria-hidden
          />
        )}
      </div>
    )
  }
)
OctoAvatar.displayName = "OctoAvatar"

