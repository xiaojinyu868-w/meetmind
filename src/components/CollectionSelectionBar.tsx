'use client';

import { FileText, History, MessageCircle, X } from 'lucide-react';

interface CollectionSelectionBarProps {
  desktopShell: boolean;
  dockWidthClass: string;
  selectedCount: number;
  confirmDelete: boolean;
  onAskTutor: () => void;
  onQuote: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function CollectionSelectionBar({
  desktopShell,
  dockWidthClass,
  selectedCount,
  confirmDelete,
  onAskTutor,
  onQuote,
  onArchive,
  onDelete,
  onClear,
}: CollectionSelectionBarProps) {
  return (
    <div className={`relative z-20 flex-shrink-0 ${desktopShell ? 'px-6 pb-2 pt-3' : 'px-3 pb-2 pt-2'}`}>
      <div className={`mx-auto w-full ${dockWidthClass} rounded-[28px] border border-[#E9E9E7] bg-white px-3.5 py-3`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-full bg-[#232322] px-2.5 py-1 text-[12px] font-semibold text-white">
                {selectedCount} 条
              </span>
              <p className="text-[12px] font-medium text-[#232322]">已加入这次操作</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onAskTutor}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#232322] px-3.5 py-2.5 text-[11px] font-semibold text-white transition hover:bg-[#111111]"
              >
                <MessageCircle size={14} />
                <span>问 Tutor</span>
              </button>
              <button
                type="button"
                onClick={onQuote}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2.5 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
              >
                <FileText size={14} />
                <span>引用</span>
              </button>
              <button
                type="button"
                onClick={onArchive}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#E9E9E7] bg-[#FDF3C0]/50 px-3 py-2.5 text-[11px] font-medium text-[#232322] transition hover:border-[#E9E9E7] hover:bg-[#FDF3C0]"
              >
                <History size={14} />
                <span>先收起</span>
              </button>
              <button
                type="button"
                onClick={onDelete}
                className={`rounded-full px-3 py-2.5 text-[11px] font-medium transition ${
                  confirmDelete
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'text-slate-400 hover:bg-rose-50 hover:text-rose-700'
                }`}
              >
                {confirmDelete ? '确认删除' : '删除'}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-[#E9E9E7] bg-white/86 text-slate-500 transition hover:bg-white hover:text-slate-700"
            aria-label="退出多选"
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {confirmDelete ? (
        <p className={`mx-auto mt-2 w-full ${dockWidthClass} px-1 text-[11px] font-medium text-rose-600`}>
          再点一次删除，就会彻底移除这些内容。
        </p>
      ) : null}
    </div>
  );
}
