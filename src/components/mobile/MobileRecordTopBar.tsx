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
    <div className="flex-shrink-0 bg-paper px-4 pb-1.5 pt-[max(env(safe-area-inset-top),6px)]">
      <div className="mx-auto flex w-full max-w-md items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenMore}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-divider-light hover:text-ink-secondary"
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
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-divider-light hover:text-ink-secondary"
          aria-label="打开历史收集"
        >
          <History size={17} />
        </button>
      </div>
      {statusText ? (
        <p className="mt-1.5 text-center text-[11.5px] font-medium text-ink-secondary">{statusText}</p>
      ) : null}
    </div>
  );
}
