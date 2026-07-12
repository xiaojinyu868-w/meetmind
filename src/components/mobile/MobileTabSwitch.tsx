'use client';

import React, { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';

export type TabId = 'record' | 'review' | 'classroom';

export interface MobileTabSwitchProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  className?: string;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'classroom', label: COPY.navigation.classroom },
  { id: 'record', label: COPY.navigation.collection },
  { id: 'review', label: '复习' },
];

export function MobileTabSwitch({
  activeTab,
  onTabChange,
  className,
}: MobileTabSwitchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const buttons = container.querySelectorAll('button');
    const activeIndex = TABS.findIndex((t) => t.id === activeTab);
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

      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'relative z-10 rounded-full px-4 py-1.5 text-[13px] font-medium whitespace-nowrap',
            'transition-all duration-200',
            activeTab === tab.id
              ? 'text-ink'
              : 'text-ink-muted hover:text-ink-muted'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
