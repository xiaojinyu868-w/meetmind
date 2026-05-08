'use client';

/**
 * CompanionAvatar — 同学的几何标识。
 *
 * 设计意图：
 *   同学不是一张拟人头像，不是一个卡通 emoji。它是一种"在场感"——
 *   一个圆形 + 一条暗示耳朵的弧线，让用户潜意识知道"有谁在听"。
 *   受 Linear / Apple Intelligence 启发：几何、克制、跨亮暗背景都稳。
 *
 * 三个尺寸：
 *   - sm (20): 聊天气泡左侧
 *   - md (24): companion header 默认
 *   - lg (32): 首屏 hero 大号标识
 *
 * 生命状态：
 *   - idle: 静态圆
 *   - listening: 外环脉冲（耳朵持续开放）
 *   - thinking: 三点 "..." 取代弧线（耳朵变成嘴，在整理话）
 *
 * 为什么用 SVG inline 而不是图片：
 *   - 可随色系（currentColor）自动适配亮暗
 *   - 动画不依赖 GIF / Lottie，纯 CSS keyframe
 *   - tree-shakeable、零资源请求
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export type CompanionState = 'idle' | 'listening' | 'thinking';

export interface CompanionAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  state?: CompanionState;
  className?: string;
}

const SIZE_MAP = {
  sm: 20,
  md: 24,
  lg: 32,
} as const;

export function CompanionAvatar({
  size = 'md',
  state = 'idle',
  className,
}: CompanionAvatarProps) {
  const px = SIZE_MAP[size];

  return (
    <span
      className={cn(
        'relative inline-flex items-center justify-center',
        state === 'listening' && 'companion-avatar-listening',
        className,
      )}
      style={{ width: px, height: px }}
      aria-label="同学"
    >
      {/* 听见时的脉冲外环——radial, 1.8s ease-in-out infinite。纯 CSS keyframes */}
      {state === 'listening' && (
        <span
          aria-hidden
          className="companion-avatar-pulse absolute inset-[-4px] rounded-full"
        />
      )}

      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative"
      >
        {/* 主圆：同学的身体。用 currentColor 适配亮暗 */}
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeOpacity="0.92"
          strokeWidth="1.25"
          fill="none"
        />

        {state === 'thinking' ? (
          /* 思考态：三点省略号，表示"同学在整理话" */
          <>
            <circle cx="8" cy="12" r="1.1" fill="currentColor" className="companion-dot companion-dot-1" />
            <circle cx="12" cy="12" r="1.1" fill="currentColor" className="companion-dot companion-dot-2" />
            <circle cx="16" cy="12" r="1.1" fill="currentColor" className="companion-dot companion-dot-3" />
          </>
        ) : (
          /* 静态/听见态：右侧一条暗示耳朵的弧线 */
          <path
            d="M16.5 8.5 Q19 12 16.5 15.5"
            stroke="currentColor"
            strokeOpacity="0.88"
            strokeWidth="1.35"
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
    </span>
  );
}

export default CompanionAvatar;
