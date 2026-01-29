'use client';

import React, { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type TabId = 'record' | 'review';

export interface MobileTabSwitchProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  className?: string;
  'data-onboarding'?: string;  // 支持引导系统标记
}

export function MobileTabSwitch({
  activeTab,
  onTabChange,
  className,
  'data-onboarding': dataOnboarding,
}: MobileTabSwitchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // 更新指示器位置
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const buttons = container.querySelectorAll('button');
    const activeIndex = activeTab === 'record' ? 0 : 1;
    const activeButton = buttons[activeIndex];
    
    if (activeButton) {
      setIndicatorStyle({
        left: activeButton.offsetLeft,
        width: activeButton.offsetWidth,
      });
    }
  }, [activeTab]);

  return (
    <div
      ref={containerRef}
      data-onboarding={dataOnboarding}
      className={cn(
        'relative inline-flex items-center p-0.5 rounded-full',
        'bg-[#F0EBE5]',
        className
      )}
    >
      {/* 滑动指示器 */}
      <div
        className="absolute h-[calc(100%-4px)] rounded-full bg-white shadow-sm transition-all duration-300 ease-out"
        style={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
        }}
      />

      {/* 录音 Tab */}
      <button
        onClick={() => onTabChange('record')}
        className={cn(
          'relative z-10 py-1.5 px-4 rounded-full text-sm font-medium whitespace-nowrap',
          'transition-colors duration-200',
          activeTab === 'record'
            ? 'text-[var(--dedao-text)]'
            : 'text-[var(--dedao-text-muted)]'
        )}
      >
        录音
      </button>

      {/* 复习 Tab */}
      <button
        onClick={() => onTabChange('review')}
        className={cn(
          'relative z-10 py-1.5 px-4 rounded-full text-sm font-medium whitespace-nowrap',
          'transition-colors duration-200',
          activeTab === 'review'
            ? 'text-[var(--dedao-text)]'
            : 'text-[var(--dedao-text-muted)]'
        )}
      >
        复习
      </button>
    </div>
  );
}
