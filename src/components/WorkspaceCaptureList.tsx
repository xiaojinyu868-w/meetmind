'use client';

import { useMemo } from 'react';
import { AudioLines, ChevronRight, FileText, ImageIcon, Link2, PlaySquare, Sparkles } from 'lucide-react';

export interface WorkspaceCaptureListItem {
  id: string;
  sourceKey: string;
  sourceType: string;
  role: string;
  contentType: string;
  title: string;
  previewText: string;
  normalizedText?: string | null;
  sourceUrl?: string | null;
  mediaUrl?: string | null;
  tutorContext?: string | null;
  occurredAt?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

interface WorkspaceCaptureListProps {
  captures: WorkspaceCaptureListItem[];
  onClose?: () => void;
  onOpenReview?: (capture: WorkspaceCaptureListItem) => void;
  onQuoteCapture?: (capture: WorkspaceCaptureListItem) => void;
  onAskTutorAboutCapture?: (capture: WorkspaceCaptureListItem) => void;
  onToggleSelectCapture?: (capture: WorkspaceCaptureListItem) => void;
  selectedCaptureIds?: string[];
  selectionMode?: boolean;
  maxHeight?: string;
  showHeader?: boolean;
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return '刚刚';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';

  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时前`;
  if (diff < 7 * day) return `${Math.max(1, Math.round(diff / day))} 天前`;

  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function getCaptureIcon(contentType: string) {
  if (contentType === 'audio') return AudioLines;
  if (contentType === 'video') return PlaySquare;
  if (contentType === 'image') return ImageIcon;
  if (contentType === 'link') return Link2;
  return FileText;
}

function getCaptureTag(item: WorkspaceCaptureListItem): string {
  if (item.contentType === 'audio') return '原声';
  if (item.contentType === 'video') {
    const videoProvider =
      typeof item.metadata?.reachChannel === 'string' && item.metadata.reachChannel === 'video-link'
        ? typeof item.metadata?.providerLabel === 'string'
          ? item.metadata.providerLabel
          : null
        : null;
    return videoProvider || '视频';
  }
  if (item.contentType === 'image') return '图片';
  if (item.contentType === 'link') {
    const providerLabel = typeof item.metadata?.providerLabel === 'string' ? item.metadata.providerLabel : null;
    return providerLabel && providerLabel !== '网页' ? providerLabel : '链接';
  }
  if (item.contentType === 'document') return '材料';
  if (item.contentType === 'text') return '记录';
  return '收集';
}

function getCaptureHint(item: WorkspaceCaptureListItem): string {
  if (item.previewText?.trim()) return item.previewText.trim();

  if (item.contentType === 'audio') return '这段原声已经收下来了，后面可以继续转写和复习。';
  if (item.contentType === 'video') return '这份视频材料已经接进这条学习线索里了。';
  if (item.contentType === 'image') return '这张图已经留在当前上下文里了。';
  if (item.contentType === 'link') return '这条链接已经接进当前收集流里。';
  if (item.contentType === 'document') return '这份材料已经留在这条收集线索里。';
  return '这条记录已经留在当前学习脉络里。';
}

function getCaptureDisplayTitle(item: WorkspaceCaptureListItem): string {
  if (item.contentType === 'text' && item.previewText.trim()) {
    return item.previewText.trim();
  }
  return item.title;
}

function openOriginalCapture(item: WorkspaceCaptureListItem) {
  const url = item.mediaUrl || item.sourceUrl;
  if (!url || typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function WorkspaceCaptureList({
  captures,
  onClose,
  onOpenReview,
  onAskTutorAboutCapture,
  onToggleSelectCapture,
  selectedCaptureIds = [],
  selectionMode = false,
  maxHeight = '52vh',
  showHeader = true,
}: WorkspaceCaptureListProps) {
  const sortedCaptures = useMemo(
    () =>
      [...captures].sort(
        (a, b) =>
          new Date(b.occurredAt || b.createdAt).getTime() - new Date(a.occurredAt || a.createdAt).getTime()
      ),
    [captures]
  );

  return (
    <div className="flex h-full flex-col bg-[#fbf8f2]" style={{ maxHeight }}>
      {showHeader ? (
        <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">全部收集</p>
            <p className="mt-1 text-xs text-slate-500">原声、图片、材料和链接都会留在这里。</p>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
            >
              关闭
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {sortedCaptures.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Sparkles size={18} />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-900">还没有收进内容</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              先发一句话、一张图、一份讲义或一段原声，后面再继续往里接。
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            {sortedCaptures.map((item) => {
              const Icon = getCaptureIcon(item.contentType);
              const reviewSessionId =
                typeof item.metadata?.sessionId === 'string' ? item.metadata.sessionId : null;
              const canReview = Boolean(reviewSessionId && (item.contentType === 'audio' || item.contentType === 'video'));
              const canOpenOriginal = Boolean(item.mediaUrl || item.sourceUrl);
              const isSelected = selectedCaptureIds.includes(item.id);
              const displayTitle = getCaptureDisplayTitle(item);

              return (
                <div
                  key={item.id}
                  className={`rounded-[24px] border bg-white px-4 py-4 shadow-[0_6px_20px_rgba(15,23,42,0.05)] ${
                    isSelected ? 'border-emerald-200 ring-2 ring-emerald-100' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                          {getCaptureTag(item)}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {formatRelativeTime(item.occurredAt || item.createdAt)}
                        </span>
                      </div>
                      {displayTitle !== item.title ? (
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-900">{displayTitle}</p>
                      ) : (
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-900">{item.title}</p>
                      )}
                      <p className="mt-1 text-sm leading-6 text-slate-500">{getCaptureHint(item)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectionMode && onToggleSelectCapture ? (
                          <button
                            type="button"
                            onClick={() => onToggleSelectCapture(item)}
                            className={`rounded-full px-3 py-2 text-xs font-medium transition ${
                              isSelected
                                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            {isSelected ? '已选' : '选择'}
                          </button>
                        ) : canReview ? (
                          <button
                            type="button"
                            onClick={() => onOpenReview?.(item)}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
                          >
                            去复习
                            <ChevronRight size={12} />
                          </button>
                        ) : onAskTutorAboutCapture ? (
                          <button
                            type="button"
                            onClick={() => onAskTutorAboutCapture(item)}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                          >
                            问 Tutor
                          </button>
                        ) : null}
                        {canOpenOriginal ? (
                          <button
                            type="button"
                            onClick={() => openOriginalCapture(item)}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                          >
                            {item.contentType === 'image'
                              ? '查看原图'
                              : item.contentType === 'video'
                                ? '打开原视频'
                                : '打开原件'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkspaceCaptureList;
