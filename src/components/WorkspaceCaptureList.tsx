'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  ChevronRight,
  FileText,
  ImageIcon,
  Link2,
  MoreHorizontal,
  PencilLine,
  PlaySquare,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react';

export interface WorkspaceCaptureListItem {
  id: string;
  sourceKey: string;
  sourceType: string;
  kind?: 'workspace' | 'local';
  sourceItemId?: string | null;
  editable?: boolean;
  status?: 'active' | 'archived' | 'deleted';
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

type WorkspaceCaptureEditMode = 'text' | 'transcript' | 'meta';
type WorkspaceCaptureScope = 'active' | 'archived';
type WorkspaceCaptureFilter = 'all' | 'text' | 'audio' | 'video' | 'image' | 'document' | 'link';
type WorkspaceCaptureTimeFilter = 'all' | 'today' | 'recent' | 'earlier';

interface WorkspaceCaptureListProps {
  captures: WorkspaceCaptureListItem[];
  onClose?: () => void;
  onOpenReview?: (capture: WorkspaceCaptureListItem) => void;
  onQuoteCapture?: (capture: WorkspaceCaptureListItem) => void;
  onAskTutorAboutCapture?: (capture: WorkspaceCaptureListItem) => void;
  onToggleSelectCapture?: (capture: WorkspaceCaptureListItem) => void;
  onArchiveCapture?: (capture: WorkspaceCaptureListItem) => void;
  onRestoreCapture?: (capture: WorkspaceCaptureListItem) => void;
  onDeleteCapture?: (capture: WorkspaceCaptureListItem) => void;
  onEditCapture?: (capture: WorkspaceCaptureListItem, mode: WorkspaceCaptureEditMode) => void;
  onAISearch?: () => void;
  selectedCaptureIds?: string[];
  selectionMode?: boolean;
  maxHeight?: string;
  showHeader?: boolean;
}

const FILTER_OPTIONS: Array<{ key: WorkspaceCaptureFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文字' },
  { key: 'audio', label: '原声' },
  { key: 'video', label: '视频' },
  { key: 'image', label: '图片' },
  { key: 'document', label: '材料' },
  { key: 'link', label: '链接' },
];

const TIME_OPTIONS: Array<{ key: WorkspaceCaptureTimeFilter; label: string }> = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: 'recent', label: '最近' },
  { key: 'earlier', label: '更早' },
];

const RECENT_WINDOW_DAYS = 7;

function getCaptureTimestamp(item: WorkspaceCaptureListItem) {
  const value = item.occurredAt || item.createdAt;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
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

  if (item.contentType === 'audio') return '这段原声已经先收下了，后面可以继续校正文字或去复习。';
  if (item.contentType === 'video') return '这份视频已经接进这条学习线里了。';
  if (item.contentType === 'image') return '这张图已经留在当前上下文里了。';
  if (item.contentType === 'link') return '这条链接已经接进当前收集流里了。';
  if (item.contentType === 'document') return '这份材料已经留在当前学习线索里了。';
  return '这条记录已经留在当前学习脉络里了。';
}

function getCaptureDisplayTitle(item: WorkspaceCaptureListItem): string {
  const previewText = item.previewText.trim();
  if (item.contentType === 'text' && previewText) {
    return previewText;
  }

  const normalizedTitle = (item.title || '').trim();
  const looksLikeClockLabel = /^(录音|原声|视频)\s*\d{1,2}:\d{2}(?::\d{2})?$/.test(normalizedTitle);
  if ((item.contentType === 'audio' || item.contentType === 'video') && looksLikeClockLabel) {
    return previewText || '一段原声';
  }

  return normalizedTitle || '未命名收集';
}

function openOriginalCapture(item: WorkspaceCaptureListItem) {
  const url = item.mediaUrl || item.sourceUrl;
  if (!url || typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function matchCaptureSearch(item: WorkspaceCaptureListItem, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;

  return [item.title, item.previewText, item.normalizedText || '', item.tutorContext || '']
    .join('\n')
    .toLowerCase()
    .includes(query);
}

function matchCaptureTime(item: WorkspaceCaptureListItem, timeFilter: WorkspaceCaptureTimeFilter) {
  if (timeFilter === 'all') return true;

  const timestamp = getCaptureTimestamp(item);
  if (!timestamp) return false;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfRecentWindow = startOfToday - (RECENT_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000;

  if (timeFilter === 'today') {
    return timestamp >= startOfToday;
  }

  if (timeFilter === 'recent') {
    return timestamp < startOfToday && timestamp >= startOfRecentWindow;
  }

  return timestamp < startOfRecentWindow;
}

export function WorkspaceCaptureList({
  captures,
  onClose,
  onOpenReview,
  onQuoteCapture,
  onAskTutorAboutCapture,
  onToggleSelectCapture,
  onArchiveCapture,
  onRestoreCapture,
  onDeleteCapture,
  onEditCapture,
  onAISearch,
  selectedCaptureIds = [],
  selectionMode = false,
  maxHeight = '52vh',
  showHeader = true,
}: WorkspaceCaptureListProps) {
  const [activeMenuCaptureId, setActiveMenuCaptureId] = useState<string | null>(null);
  const [confirmDeleteCaptureId, setConfirmDeleteCaptureId] = useState<string | null>(null);
  const [scope, setScope] = useState<WorkspaceCaptureScope>('active');
  const [filterType, setFilterType] = useState<WorkspaceCaptureFilter>('all');
  const [timeFilter, setTimeFilter] = useState<WorkspaceCaptureTimeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!confirmDeleteCaptureId) return;
    if (confirmDeleteCaptureId === activeMenuCaptureId) return;
    setConfirmDeleteCaptureId(null);
  }, [activeMenuCaptureId, confirmDeleteCaptureId]);

  useEffect(() => {
    setActiveMenuCaptureId(null);
    setConfirmDeleteCaptureId(null);
  }, [scope, filterType, timeFilter, searchQuery, selectionMode, showFilters]);

  const sortedCaptures = useMemo(
    () =>
      [...captures]
        .filter((item) => item.status !== 'deleted')
        .sort((a, b) => getCaptureTimestamp(b) - getCaptureTimestamp(a)),
    [captures]
  );

  const activeCount = useMemo(
    () => sortedCaptures.filter((item) => (item.status || 'active') === 'active').length,
    [sortedCaptures]
  );
  const archivedCount = useMemo(
    () => sortedCaptures.filter((item) => item.status === 'archived').length,
    [sortedCaptures]
  );

  // 仅在初始化时：如果 active 为空但 archived 有内容，默认展示 archived
  useEffect(() => {
    if (scope === 'active' && activeCount === 0 && archivedCount > 0) {
      setScope('archived');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredCaptures = useMemo(
    () =>
      sortedCaptures.filter((item) => {
        const status = item.status || 'active';
        if (scope === 'active' && status !== 'active') return false;
        if (scope === 'archived' && status !== 'archived') return false;
        if (filterType !== 'all' && item.contentType !== filterType) return false;
        if (!matchCaptureTime(item, timeFilter)) return false;
        return matchCaptureSearch(item, searchQuery);
      }),
    [filterType, scope, searchQuery, sortedCaptures, timeFilter]
  );

  const isFiltered = Boolean(searchQuery.trim()) || filterType !== 'all' || timeFilter !== 'all';

  return (
    <div className="flex h-full flex-col bg-[#F7F7F5]" style={{ maxHeight }} data-testid="workspace-capture-list">
      {showHeader ? (
        <div className="border-b border-white/80 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
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
        </div>
      ) : null}

      <div className="border-b border-white/80 bg-white/58 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索收集内容"
              aria-label="搜索收集内容"
              className="w-full rounded-[18px] border border-white/80 bg-white/92 py-2.5 pl-9 pr-3 text-sm text-slate-700 shadow-[0_10px_24px_rgba(148,163,184,0.08)] outline-none transition focus:border-[#D1F4E0] focus:ring-2 focus:ring-[#D1F4E0]"
            />
          </div>
          {onAISearch ? (
            <button
              type="button"
              onClick={onAISearch}
              className="flex h-[42px] items-center gap-1.5 rounded-[18px] border border-[#D1F4E0] bg-[#D1F4E0]/20 px-3 text-xs font-semibold text-emerald-700 shadow-[0_10px_24px_rgba(148,163,184,0.08)] transition hover:bg-[#D1F4E0]/40"
              aria-label="AI 检索"
            >
              <Sparkles size={14} />
              <span>AI</span>
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScope('active')}
            aria-pressed={scope === 'active'}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              scope === 'active'
                ? 'bg-[#232322] text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            正在看 {activeCount > 0 ? `(${activeCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setScope('archived')}
            aria-pressed={scope === 'archived'}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              scope === 'archived'
                ? 'bg-slate-800 text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            先收起 {archivedCount > 0 ? `(${archivedCount})` : ''}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            aria-expanded={showFilters}
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
              showFilters || filterType !== 'all' || timeFilter !== 'all'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            {filterType === 'all' && timeFilter === 'all' ? '筛选' : '筛选中'}
          </button>
          {(filterType !== 'all' || timeFilter !== 'all') ? (
            <button
              type="button"
              onClick={() => {
                setFilterType('all');
                setTimeFilter('all');
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
            >
              清空筛选
            </button>
          ) : null}
        </div>

        {showFilters ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white/85 p-3">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">内容类型</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setFilterType(option.key)}
                  aria-pressed={filterType === option.key}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                    filterType === option.key
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="mt-3 text-[11px] font-semibold tracking-[0.08em] text-slate-500">时间范围</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TIME_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTimeFilter(option.key)}
                  aria-pressed={timeFilter === option.key}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                    timeFilter === option.key
                      ? 'bg-[#232322] text-white'
                      : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {filteredCaptures.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#D1F4E0]/30 text-[#232322]">
              <Sparkles size={18} />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-900">
              {isFiltered ? '没找到匹配的收集' : scope === 'archived' ? '还没有收起的内容' : '还没有收进内容'}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {isFiltered
                ? '换个关键词、类型或时间范围再试试。'
                : scope === 'archived'
                  ? '先收起的内容会留在这里，之后随时可以放回来。'
                  : '先发一句话、一张图、一份讲义或一段原声，后面再继续往里接。'}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 pb-2">
            {filteredCaptures.map((item) => {
              const Icon = getCaptureIcon(item.contentType);
              const reviewSessionId = typeof item.metadata?.sessionId === 'string' ? item.metadata.sessionId : null;
              const canReview = Boolean(reviewSessionId && (item.contentType === 'audio' || item.contentType === 'video'));
              const canOpenOriginal = Boolean(item.mediaUrl || item.sourceUrl);
              const canEdit = item.editable !== false;
              const canCorrectTranscript =
                canEdit &&
                (item.contentType === 'audio' || item.contentType === 'video') &&
                Boolean((item.normalizedText || item.tutorContext || '').trim());
              const canEditText = canEdit && item.contentType === 'text';
              const canEditMeta = canEdit && item.contentType !== 'text';
              const isSelected = selectedCaptureIds.includes(item.id);
              const isMenuOpen = activeMenuCaptureId === item.id;
              const isArchived = (item.status || 'active') === 'archived';
              const displayTitle = getCaptureDisplayTitle(item);

              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border bg-white px-3 py-2.5 transition-colors ${
                    isSelected ? 'border-[#D1F4E0] ring-2 ring-[#D1F4E0]' : 'border-transparent hover:bg-slate-50/60'
                  }`}
                  onContextMenu={
                    !selectionMode
                      ? (event) => {
                          event.preventDefault();
                          setConfirmDeleteCaptureId(null);
                          setActiveMenuCaptureId(item.id);
                        }
                      : undefined
                  }
                >
                  {/* 紧凑主行 */}
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{displayTitle}</p>
                        <span className="flex-shrink-0 text-[10px] text-slate-400">
                          {formatRelativeTime(item.occurredAt || item.createdAt)}
                        </span>
                        {!selectionMode ? (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteCaptureId(null);
                              setActiveMenuCaptureId((prev) => (prev === item.id ? null : item.id));
                            }}
                            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                            aria-label={`更多操作：${displayTitle}`}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                          {getCaptureTag(item)}
                        </span>
                        {isArchived ? (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                            已收起
                          </span>
                        ) : null}
                        {item.previewText && item.previewText !== displayTitle ? (
                          <p className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{item.previewText}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {selectionMode ? (
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onToggleSelectCapture?.(item)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          isSelected
                            ? 'border border-[#D1F4E0] bg-[#D1F4E0]/30 text-[#232322]'
                            : 'border border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {isSelected ? '已选择' : '选择'}
                      </button>
                    </div>
                  ) : null}

                      {isMenuOpen ? (
                        <div className="mt-2 space-y-1 rounded-xl border border-slate-100 bg-white p-2">
                          {canReview ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuCaptureId(null);
                                onOpenReview?.(item);
                              }}
                              className="flex w-full items-center justify-between rounded-lg bg-[#D1F4E0]/30 px-3 py-2 text-left text-xs font-semibold text-[#232322] transition hover:bg-[#D1F4E0]"
                            >
                              <span>去复习</span>
                              <ChevronRight size={14} />
                            </button>
                          ) : null}
                          {canEditText ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuCaptureId(null);
                                onEditCapture?.(item, 'text');
                              }}
                              className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                            >
                              <span>编辑文字</span>
                              <PencilLine size={14} className="text-slate-300" />
                            </button>
                          ) : null}
                          {canCorrectTranscript ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuCaptureId(null);
                                onEditCapture?.(item, 'transcript');
                              }}
                              className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                            >
                              <span>校正文字</span>
                              <PencilLine size={14} className="text-slate-300" />
                            </button>
                          ) : null}
                          {canEditMeta ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuCaptureId(null);
                                onEditCapture?.(item, 'meta');
                              }}
                              className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                            >
                              <span>编辑标题/备注</span>
                              <PencilLine size={14} className="text-slate-300" />
                            </button>
                          ) : null}
                          {onQuoteCapture ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuCaptureId(null);
                                onQuoteCapture(item);
                              }}
                              className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                            >
                              <span>引用</span>
                              <ChevronRight size={14} className="text-slate-300" />
                            </button>
                          ) : null}
                          {onAskTutorAboutCapture ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuCaptureId(null);
                                onAskTutorAboutCapture(item);
                              }}
                              className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                            >
                              <span>问 Tutor</span>
                              <ChevronRight size={14} className="text-slate-300" />
                            </button>
                          ) : null}
                          {onToggleSelectCapture ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuCaptureId(null);
                                onToggleSelectCapture(item);
                              }}
                              className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                            >
                              <span>{isSelected ? '取消选择' : '选择'}</span>
                              <ChevronRight size={14} className="text-slate-300" />
                            </button>
                          ) : null}
                          {canOpenOriginal ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuCaptureId(null);
                                openOriginalCapture(item);
                              }}
                              className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                            >
                              <span>打开原件</span>
                              <ChevronRight size={14} className="text-slate-300" />
                            </button>
                          ) : null}
                          {isArchived ? (
                            onRestoreCapture ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmDeleteCaptureId(null);
                                  setActiveMenuCaptureId(null);
                                  onRestoreCapture(item);
                                }}
                                className="flex w-full items-center justify-between rounded-lg bg-[#D1F4E0]/30 px-3 py-2 text-left text-xs font-medium text-[#232322] transition hover:bg-[#D1F4E0]"
                              >
                                <span>放回正在看</span>
                                <RotateCcw size={14} className="text-[#787774]" />
                              </button>
                            ) : null
                          ) : onArchiveCapture ? (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteCaptureId(null);
                                setActiveMenuCaptureId(null);
                                onArchiveCapture(item);
                              }}
                              className="flex w-full items-center justify-between rounded-lg bg-[#FDF3C0]/50 px-3 py-2 text-left text-xs font-medium text-[#232322] transition hover:bg-[#FDF3C0]"
                            >
                              <span>先收起</span>
                              <ChevronRight size={14} className="text-[#FDF3C0]" />
                            </button>
                          ) : null}
                          {onDeleteCapture ? (
                            confirmDeleteCaptureId === item.id ? (
                              <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5">
                                <p className="text-xs font-semibold leading-5 text-rose-700">
                                  彻底删除后，这条收集不会再进入 Tutor、回声和后续记忆。
                                </p>
                                <div className="mt-2 flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmDeleteCaptureId(null);
                                      setActiveMenuCaptureId(null);
                                      onDeleteCapture(item);
                                    }}
                                    className="rounded-full bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rose-700"
                                  >
                                    确认彻底删除
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteCaptureId(null)}
                                    className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-medium text-rose-600 transition hover:border-rose-300"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCaptureId(item.id)}
                                className="flex w-full items-center justify-between rounded-lg bg-rose-50 px-3 py-2 text-left text-xs font-medium text-rose-700 transition hover:bg-rose-100"
                              >
                                <span>彻底删除</span>
                                <ChevronRight size={14} className="text-rose-300" />
                              </button>
                            )
                          ) : null}
                        </div>
                      ) : null}
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
