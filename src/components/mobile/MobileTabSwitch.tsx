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
        'relative inline-flex items-center rounded-full p-[3px]',
        'bg-black/[0.05]',
        className
      )}
    >
      <div
        className="absolute h-[calc(100%-6px)] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.06)] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
        }}
      />

      <button
        onClick={() => onTabChange('record')}
        className={cn(
          'relative z-10 rounded-full px-5 py-1.5 text-[13px] font-medium whitespace-nowrap',
          'transition-all duration-200',
          activeTab === 'record'
            ? 'text-slate-900'
            : 'text-slate-400 hover:text-slate-500'
        )}
      >
        收集
      </button>

      <button
        onClick={() => onTabChange('review')}
        className={cn(
          'relative z-10 rounded-full px-5 py-1.5 text-[13px] font-medium whitespace-nowrap',
          'transition-all duration-200',
          activeTab === 'review'
            ? 'text-slate-900'
            : 'text-slate-400 hover:text-slate-500'
        )}
      >
        复习
      </button>
    </div>
  );
}
