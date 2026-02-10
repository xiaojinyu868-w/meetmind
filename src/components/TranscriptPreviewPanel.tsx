'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from 'react';
import type { TranscriptSegment } from '@/types';
import { useTextSelection } from '@/hooks/useTextSelection';
import { WordExplainer } from './WordExplainer';

interface TranscriptPreviewPanelProps {
  transcript: TranscriptSegment[];
  interimText?: string;
  isRecording?: boolean;
  transcribeMode?: 'streaming' | 'batch';
  collapsedCount?: number;
  defaultExpanded?: boolean;
  formatTime?: (ms: number) => string;
  immersiveMode?: boolean;
  editable?: boolean;
  onSegmentTextUpdate?: (segmentId: string, text: string) => void;
  /** 启用选词解释功能 */
  enableWordExplainer?: boolean;
  /** 完整转录上下文（用于 AI 解释时的参考） */
  fullContextText?: string;
  /** 时间戳点击回调 */
  onTimestampClick?: (timeMs: number) => void;
}

const defaultFormatTime = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
  }
  return `${pad(minutes)}:${pad(seconds % 60)}`;
};

const ITEM_HEIGHT = 44;
const BUFFER_SIZE = 5;

function highlightText(text: string, searchQuery?: string): ReactNode {
  if (!searchQuery?.trim()) return text;

  const query = searchQuery.toLowerCase();
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(query);

  if (index === -1) return text;

  const before = text.slice(0, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length);

  return (
    <>
      {before}
      <mark className="bg-amber-200 text-amber-900 px-0.5 rounded">{match}</mark>
      {after}
    </>
  );
}

function normalizeCompareText(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’（）()【】\[\]-]/g, '');
}

export function TranscriptPreviewPanel({
  transcript,
  interimText = '',
  isRecording = false,
  transcribeMode = 'streaming',
  collapsedCount = 5,
  defaultExpanded = false,
  formatTime = defaultFormatTime,
  immersiveMode = false,
  editable = false,
  onSegmentTextUpdate,
  enableWordExplainer = false,
  fullContextText,
  onTimestampClick,
}: TranscriptPreviewPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || immersiveMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [editingOriginalText, setEditingOriginalText] = useState('');

  // 选词解释
  const wordExplainerContainerRef = useRef<HTMLDivElement>(null);
  const { selection, clearSelection } = useTextSelection(
    enableWordExplainer ? wordExplainerContainerRef : { current: null } as React.RefObject<HTMLElement | null>
  );

  const canEdit = editable && typeof onSegmentTextUpdate === 'function';

  const filteredTranscript = useMemo(() => {
    if (!searchQuery.trim()) return transcript;
    const query = searchQuery.toLowerCase();
    return transcript.filter((seg) => seg.text.toLowerCase().includes(query));
  }, [transcript, searchQuery]);

  const displayTranscript = useMemo(() => {
    if (isExpanded) return filteredTranscript;
    return filteredTranscript.slice(-collapsedCount);
  }, [filteredTranscript, isExpanded, collapsedCount]);

  const startEditing = useCallback((segment: TranscriptSegment) => {
    if (!canEdit) return;
    setEditingSegmentId(segment.id);
    setDraftText(segment.text);
    setEditingOriginalText(segment.text);
    setAutoScrollEnabled(false);
  }, [canEdit]);

  const cancelEditing = useCallback(() => {
    setEditingSegmentId(null);
    setDraftText('');
    setEditingOriginalText('');
  }, []);

  const commitEditing = useCallback(() => {
    if (!editingSegmentId || !canEdit || !onSegmentTextUpdate) {
      cancelEditing();
      return;
    }

    const normalized = draftText.trim();
    if (!normalized || normalized === editingOriginalText.trim()) {
      cancelEditing();
      return;
    }

    onSegmentTextUpdate(editingSegmentId, normalized);
    cancelEditing();
  }, [canEdit, cancelEditing, draftText, editingOriginalText, editingSegmentId, onSegmentTextUpdate]);

  useEffect(() => {
    if (!editingSegmentId) return;
    const exists = transcript.some((seg) => seg.id === editingSegmentId);
    if (!exists) {
      cancelEditing();
    }
  }, [cancelEditing, editingSegmentId, transcript]);

  const virtualItems = useMemo(() => {
    if (!isExpanded || displayTranscript.length <= 50) {
      return {
        items: displayTranscript.map((seg, index) => ({ seg, index })),
        totalHeight: displayTranscript.length * ITEM_HEIGHT,
        offsetTop: 0,
        startIndex: 0,
        endIndex: displayTranscript.length - 1,
      };
    }

    const totalHeight = displayTranscript.length * ITEM_HEIGHT;
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE);
    const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT);
    const endIndex = Math.min(
      displayTranscript.length - 1,
      startIndex + visibleCount + BUFFER_SIZE * 2
    );

    const items: Array<{ seg: TranscriptSegment; index: number }> = [];
    for (let i = startIndex; i <= endIndex; i += 1) {
      items.push({ seg: displayTranscript[i], index: i });
    }

    return {
      items,
      totalHeight,
      offsetTop: startIndex * ITEM_HEIGHT,
      startIndex,
      endIndex,
    };
  }, [displayTranscript, isExpanded, scrollTop, containerHeight]);

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current && autoScrollEnabled) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [autoScrollEnabled]);

  useEffect(() => {
    if (isRecording && autoScrollEnabled && !editingSegmentId) {
      scrollToBottom();
    }
  }, [transcript.length, isRecording, autoScrollEnabled, editingSegmentId, scrollToBottom]);

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);

    const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
    if (isNearBottom !== autoScrollEnabled && isRecording && !editingSegmentId) {
      setAutoScrollEnabled(isNearBottom);
    }
  }, [autoScrollEnabled, editingSegmentId, isRecording]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    setContainerHeight(container.clientHeight);

    return () => observer.disconnect();
  }, []);

  const handleJumpToLatest = useCallback(() => {
    setAutoScrollEnabled(true);
    scrollToBottom();
  }, [scrollToBottom]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
    if (!isExpanded) {
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [isExpanded, scrollToBottom]);

  const lastVisibleText = displayTranscript[displayTranscript.length - 1]?.text || '';
  const interimVisibleText =
    normalizeCompareText(interimText) && normalizeCompareText(interimText) === normalizeCompareText(lastVisibleText)
      ? ''
      : interimText;

  if (transcript.length === 0 && !interimVisibleText) {
    if (immersiveMode) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-16 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-amber-100 to-amber-200 rounded-full flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-700 mb-2">正在聆听...</h3>
          <p className="text-sm text-gray-400 max-w-xs">
            {transcribeMode === 'streaming'
              ? '开始说话后，文字会实时出现在这里'
              : '录音结束后会自动转换为文字'}
          </p>
        </div>
      );
    }
    return null;
  }

  const hiddenCount = transcript.length - collapsedCount;
  const hasMore = !isExpanded && hiddenCount > 0;

  if (immersiveMode) {
    return (
      <div ref={wordExplainerContainerRef} className="flex flex-col h-full relative">
        <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">📝 {transcript.length} 句</span>
            {searchQuery && (
              <span className="text-xs text-amber-600">· 匹配 {filteredTranscript.length}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSearch((prev) => !prev)}
              className={`p-1.5 rounded-lg transition-colors ${
                showSearch ? 'bg-amber-100 text-amber-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title="搜索转录"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </div>

        {showSearch && (
          <div className="flex-shrink-0 px-4 pb-2 animate-slide-down">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索转录内容..."
                className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 bg-white"
                autoFocus
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 pb-4 min-h-0"
        >
          <div className="space-y-1">
            {displayTranscript.map((seg) => (
              <ImmersiveTranscriptItem
                key={seg.id}
                segment={seg}
                formatTime={formatTime}
                searchQuery={searchQuery}
                editable={canEdit}
                isEditing={editingSegmentId === seg.id}
                draftText={editingSegmentId === seg.id ? draftText : ''}
                onStartEdit={startEditing}
                onDraftChange={setDraftText}
                onCommitEdit={commitEditing}
                onCancelEdit={cancelEditing}
              />
            ))}

            {interimVisibleText && (
              <div className="flex items-start gap-3 py-2 animate-pulse">
                <span className="text-xs text-gray-300 font-mono shrink-0 pt-1">...</span>
                <span className="text-gray-400 italic text-base leading-relaxed">{interimVisibleText}</span>
              </div>
            )}
          </div>
        </div>

        {isRecording && !autoScrollEnabled && (
          <div className="absolute bottom-4 right-4">
            <button
              onClick={handleJumpToLatest}
              className="flex items-center gap-1 px-3 py-2 text-sm text-white bg-amber-500 hover:bg-amber-600 rounded-full shadow-lg transition-all animate-bounce"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              最新
            </button>
          </div>
        )}

        {/* 选词解释浮窗 */}
        {enableWordExplainer && selection && (
          <WordExplainer
            selection={selection}
            fullContextText={fullContextText}
            onClose={clearSelection}
            onTimestampClick={onTimestampClick}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={!immersiveMode ? wordExplainerContainerRef : undefined} className="mt-8 pt-6 border-t border-gray-100 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          {transcribeMode === 'streaming' ? '📝 实时转录' : '📝 转录结果'}
          <span className="badge badge-streaming">
            {transcribeMode === 'streaming' ? '百炼 ASR' : 'Qwen ASR'}
          </span>
        </h4>
        <div className="flex items-center gap-2">
          {isExpanded && (
            <button
              onClick={() => setShowSearch((prev) => !prev)}
              className={`p-1.5 rounded-lg transition-colors ${
                showSearch ? 'bg-amber-100 text-amber-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title="搜索转录"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          )}
          <span className="text-xs text-gray-400">{transcript.length} 句</span>
          <button
            onClick={toggleExpanded}
            className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 transition-colors"
          >
            {isExpanded ? (
              <>
                收起
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </>
            ) : (
              <>
                查看全部
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>

      {showSearch && isExpanded && (
        <div className="mb-3 animate-slide-down">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索转录内容..."
              className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="mt-1 text-xs text-gray-400">找到 {filteredTranscript.length} 条匹配</p>
          )}
        </div>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={`overflow-y-auto space-y-2 p-3 bg-gray-50 rounded-xl transition-all ${
          isExpanded ? 'max-h-[60vh]' : 'max-h-48'
        }`}
        style={isExpanded && displayTranscript.length > 50 ? { position: 'relative' } : undefined}
      >
        {isExpanded && displayTranscript.length > 50 ? (
          <div style={{ height: virtualItems.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${virtualItems.offsetTop}px)` }}>
              {virtualItems.items.map(({ seg }) => (
                <TranscriptItem
                  key={seg.id}
                  segment={seg}
                  formatTime={formatTime}
                  searchQuery={searchQuery}
                  editable={canEdit}
                  isEditing={editingSegmentId === seg.id}
                  draftText={editingSegmentId === seg.id ? draftText : ''}
                  onStartEdit={startEditing}
                  onDraftChange={setDraftText}
                  onCommitEdit={commitEditing}
                  onCancelEdit={cancelEditing}
                />
              ))}
            </div>
          </div>
        ) : (
          displayTranscript.map((seg) => (
            <TranscriptItem
              key={seg.id}
              segment={seg}
              formatTime={formatTime}
              searchQuery={searchQuery}
              editable={canEdit}
              isEditing={editingSegmentId === seg.id}
              draftText={editingSegmentId === seg.id ? draftText : ''}
              onStartEdit={startEditing}
              onDraftChange={setDraftText}
              onCommitEdit={commitEditing}
              onCancelEdit={cancelEditing}
            />
          ))
        )}

        {interimVisibleText && (
          <div className="flex items-start gap-2 text-sm">
            <span className="text-xs text-gray-300 font-mono shrink-0 mt-0.5">...</span>
            <span className="text-gray-400 italic">{interimVisibleText}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        {hasMore ? (
          <button
            onClick={toggleExpanded}
            className="text-xs text-gray-400 hover:text-amber-600 transition-colors"
          >
            还有 {hiddenCount} 条，点击展开查看
          </button>
        ) : (
          <span />
        )}

        {isExpanded && isRecording && !autoScrollEnabled && (
          <button
            onClick={handleJumpToLatest}
            className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-amber-500 hover:bg-amber-600 rounded-full transition-colors animate-bounce"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            回到最新
          </button>
        )}
      </div>

      {/* 选词解释浮窗 */}
      {enableWordExplainer && selection && (
        <WordExplainer
          selection={selection}
          fullContextText={fullContextText}
          onClose={clearSelection}
          onTimestampClick={onTimestampClick}
        />
      )}
    </div>
  );
}

interface BaseTranscriptItemProps {
  segment: TranscriptSegment;
  formatTime: (ms: number) => string;
  searchQuery?: string;
  editable?: boolean;
  isEditing?: boolean;
  draftText: string;
  onStartEdit?: (segment: TranscriptSegment) => void;
  onDraftChange?: (text: string) => void;
  onCommitEdit?: () => void;
  onCancelEdit?: () => void;
}

function handleEditKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, onCancelEdit?: () => void) {
  if (e.key === 'Escape') {
    e.preventDefault();
    onCancelEdit?.();
  }
}

function TranscriptItem({
  segment,
  formatTime,
  searchQuery,
  editable = false,
  isEditing = false,
  draftText,
  onStartEdit,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
}: BaseTranscriptItemProps) {
  const highlighted = useMemo(() => highlightText(segment.text, searchQuery), [segment.text, searchQuery]);

  return (
    <div className="flex items-start gap-2 text-sm py-1">
      <span className="text-xs text-gray-400 font-mono shrink-0 mt-0.5 bg-gray-100 px-1.5 py-0.5 rounded whitespace-nowrap">
        {formatTime(segment.startMs)} - {formatTime(segment.endMs)}
      </span>

      {isEditing ? (
        <textarea
          value={draftText}
          onChange={(e) => onDraftChange?.(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => handleEditKeyDown(e, onCancelEdit)}
          className="flex-1 min-h-[84px] rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-200"
          autoFocus
        />
      ) : (
        <span
          onDoubleClick={editable ? () => onStartEdit?.(segment) : undefined}
          className={`flex-1 text-gray-700 leading-relaxed select-text ${editable ? 'rounded-md px-1 py-0.5 -mx-1 hover:bg-white transition-colors' : ''}`}
          title={editable ? '双击编辑' : undefined}
        >
          {highlighted}
        </span>
      )}
    </div>
  );
}

function ImmersiveTranscriptItem({
  segment,
  formatTime,
  searchQuery,
  editable = false,
  isEditing = false,
  draftText,
  onStartEdit,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
}: BaseTranscriptItemProps) {
  const highlighted = useMemo(() => highlightText(segment.text, searchQuery), [segment.text, searchQuery]);

  return (
    <div className="group flex items-start gap-4 py-3 border-b border-gray-50 hover:bg-gray-50/50 transition-colors -mx-2 px-2 rounded-lg">
      <span className="text-xs text-gray-400 font-mono shrink-0 pt-1 tabular-nums opacity-60 group-hover:opacity-100 transition-opacity">
        {formatTime(segment.startMs)}
      </span>

      {isEditing ? (
        <textarea
          value={draftText}
          onChange={(e) => onDraftChange?.(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => handleEditKeyDown(e, onCancelEdit)}
          className="flex-1 min-h-[92px] rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-200"
          autoFocus
        />
      ) : (
        <span
          onDoubleClick={editable ? () => onStartEdit?.(segment) : undefined}
          className={`flex-1 text-gray-800 text-base leading-relaxed select-text ${editable ? 'rounded-md px-1 py-0.5 -mx-1 hover:bg-white/80 transition-colors' : ''}`}
          title={editable ? '双击编辑' : undefined}
        >
          {highlighted}
        </span>
      )}
    </div>
  );
}

export default TranscriptPreviewPanel;
