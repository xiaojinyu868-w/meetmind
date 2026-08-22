'use client';

/**
 * TeachThreadList — ChatGPT 式课程会话列表（/teach 左侧栏/抽屉）。
 *
 * mock 阶段数据来自 localStorage（teach-store），后端就绪后同一接口
 * 换 GET /api/teach/threads（收口在 teach-client.ts）。
 */

import { Plus, Trash2 } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { TeachThreadMeta } from './teach-store';

interface TeachThreadListProps {
  threads: TeachThreadMeta[];
  activeId: string | null;
  onSelect: (meta: TeachThreadMeta) => void;
  onNew: () => void;
  onRemove: (id: string) => void;
}

export function TeachThreadList({ threads, activeId, onSelect, onNew, onRemove }: TeachThreadListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <div className="flex items-center justify-between border-b border-divider-light px-3 py-2.5">
        <span className="text-[13px] font-medium text-ink-secondary">{COPY.apps.teach.history}</span>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1 rounded-lg border border-divider bg-white px-2 py-1 text-[12px] text-ink-secondary transition-colors hover:bg-paper-warm"
        >
          <Plus size={12} strokeWidth={2} />
          {COPY.apps.teach.newLesson}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {threads.map((thread) => (
          <div
            key={thread.id}
            className={cn(
              'group mb-1 flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 transition-colors',
              thread.id === activeId ? 'bg-paper-warm' : 'hover:bg-paper-warm/60',
            )}
            onClick={() => onSelect(thread)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSelect(thread);
            }}
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px]',
                thread.id === activeId ? 'font-medium text-ink' : 'text-ink-secondary',
              )}
              title={thread.title}
            >
              {thread.title}
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(thread.id);
              }}
              className="shrink-0 rounded p-1 text-ink-muted opacity-0 transition-opacity hover:text-vermilion group-hover:opacity-100"
              aria-label="删除"
              title="删除"
            >
              <Trash2 size={12} strokeWidth={1.8} />
            </button>
          </div>
        ))}
        {threads.length === 0 ? (
          <p className="px-2 pt-6 text-center text-[12px] text-ink-muted">讲过的课会列在这里</p>
        ) : null}
      </div>
    </div>
  );
}
