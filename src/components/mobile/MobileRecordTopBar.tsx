'use client';

import { History, Menu } from 'lucide-react';
import { MobileTabSwitch } from './MobileTabSwitch';
import type { ViewMode } from '@/types/page-types';

interface MobileRecordTopBarProps {
  viewMode: ViewMode;
  statusText?: string;
  onTabChange: (tab: ViewMode) => void;
  onOpenMore: () => void;
  onOpenHistory: () => void;
}

export function MobileRecordTopBar({
  viewMode,
  statusText,
  onTabChange,
  onOpenMore,
  onOpenHistory,
}: MobileRecordTopBarProps) {
  return (
    <div className="flex-shrink-0 bg-[#F7F7F5] px-4 pb-1.5 pt-[max(env(safe-area-inset-top),6px)]">
      <div className="mx-auto flex w-full max-w-md items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenMore}
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.04] hover:text-slate-600"
          aria-label="打开收集菜单"
        >
          <Menu size={18} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <MobileTabSwitch
            activeTab={viewMode}
            onTabChange={onTabChange}
          />
        </div>
        <button
          type="button"
          onClick={onOpenHistory}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.04] hover:text-slate-600"
          aria-label="打开历史收集"
        >
          <History size={17} />
        </button>
      </div>
      {statusText ? (
        <p className="mt-1 text-center text-[10px] font-medium text-[#787774]">{statusText}</p>
      ) : null}
    </div>
  );
}
