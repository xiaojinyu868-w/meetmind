'use client';

/**
 * v7 移动端学习同桌悬浮按钮 (FAB)
 *
 * 升级要点：
 * - 主体 = Octo 头像（不再是 chat bubble icon），mood 跟随状态：
 *   - 默认 idle，有 pulse 时 thinking，hasUnread 时 happy
 * - 米白质感底盘 + 呼吸光环（octo-aura）
 * - 未读指示从 red-500 改为 vermilion 朱批红
 * - 提示气泡用 ink 黑底 + 米白文字（不再是反白浅灰）
 */

import React, { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { OctoAvatar, type OctoMood } from '@/components/ui/octo-avatar';

interface MobileAIFabProps {
  /** 点击回调 */
  onClick: () => void;
  /** 是否显示 */
  visible?: boolean;
  /** 是否显示脉冲动画（AI 正在思考） */
  pulse?: boolean;
  /** 自定义位置 */
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center';
  /** 是否有未读消息 */
  hasUnread?: boolean;
  /** 提示文字 */
  tooltip?: string;
  /** 自定义 mood（覆盖默认状态推断） */
  mood?: OctoMood;
}

export function MobileAIFab({
  onClick,
  visible = true,
  pulse = false,
  position = 'bottom-right',
  hasUnread = false,
  tooltip = '问同学',
  mood,
}: MobileAIFabProps) {
  const [isPressed, setIsPressed] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);

  // 状态推断：思考中 > 有未读 > 默认
  const effectiveMood: OctoMood =
    mood ?? (pulse ? 'thinking' : hasUnread ? 'happy' : 'idle');

  // 首次显示 3 秒后隐藏提示
  useEffect(() => {
    if (visible && showTooltip) {
      const timer = setTimeout(() => setShowTooltip(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [visible, showTooltip]);

  // 点击时显示提示
  const handleClick = useCallback(() => {
    setIsPressed(true);
    onClick();
    setTimeout(() => setIsPressed(false), 150);
  }, [onClick]);

  if (!visible) return null;

  const positionClasses = {
    'bottom-right': 'right-4 bottom-20',
    'bottom-left': 'left-4 bottom-20',
    'bottom-center': 'left-1/2 -translate-x-1/2 bottom-20',
  };

  return (
    <div
      className={cn(
        'fixed z-40 transition-all duration-300',
        positionClasses[position],
        visible ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
      )}
    >
      {/* 提示气泡（v7 ink 黑底） */}
      {showTooltip && tooltip && (
        <div
          className={cn(
            'absolute bottom-full mb-2 right-0',
            'rounded-md px-3 py-1.5',
            'bg-ink text-white text-xs whitespace-nowrap',
            'shadow-soft animate-fade-in'
          )}
        >
          {tooltip}
          <div className="absolute top-full right-4 -mt-1">
            <div className="size-2 bg-ink transform rotate-45" />
          </div>
        </div>
      )}

      {/* FAB 按钮：Octo 头像作为主体 */}
      <button
        onClick={handleClick}
        className={cn(
          'relative size-14 rounded-full',
          'bg-card border border-divider',
          'flex items-center justify-center',
          'shadow-card transition-all duration-200',
          'active:scale-95 hover:shadow-float',
          isPressed && 'scale-95',
        )}
        aria-label={tooltip}
      >
        {/* 脉冲环（用 vermilion-mist 替代旧 sand/coral） */}
        {pulse && (
          <>
            <span className="absolute inset-0 rounded-full bg-vermilion/20 animate-ping" />
            <span
              className="absolute inset-0 rounded-full bg-vermilion/15 animate-ping"
              style={{ animationDelay: '0.2s' }}
            />
          </>
        )}

        {/* Octo 主体 */}
        <OctoAvatar
          mood={effectiveMood}
          size="md"
          aura={!pulse}
          className="border-0 bg-transparent"
        />

        {/* 未读指示器：朱批红 */}
        {hasUnread && (
          <span
            className="absolute top-0.5 right-0.5 size-3 rounded-full bg-vermilion border-2 border-card animate-rec-pulse"
            aria-label="有新消息"
          />
        )}
      </button>
    </div>
  );
}

export default MobileAIFab;
