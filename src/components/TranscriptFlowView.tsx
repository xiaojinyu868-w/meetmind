'use client';

/**
 * TranscriptFlowView — 统一转录文本显示组件
 *
 * 设计理念：
 * - 文本以「连续段落流」呈现，相邻 segments 按时间自动分组
 * - 每个段落开头显示第一句的时间戳，段落内 hover 某句可见精确时间
 * - 底层数据（segments）完整保留，不做合并，仅为前端视觉分组
 *
 * 通过 variant 控制不同场景的差异行为：
 * - live:    录音实时转录（最新句动画，自动滚底）
 * - review:  录音回顾（当前播放句高亮，可点击跳转）
 * - video:   视频导入（hover 显示 🎯 困惑点标记按钮）
 * - context: 困惑点上下文（困惑时刻红色高亮）
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
  type UIEvent,
  type KeyboardEvent,
} from 'react';
/** Minimal segment interface — compatible with both types/TranscriptSegment and longcut TranscriptSegment */
interface FlowSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}
import { useTextSelection } from '@/hooks/useTextSelection';
import { WordExplainer } from './WordExplainer';

// ─── 类型定义 ───

export type TranscriptFlowVariant = 'live' | 'review' | 'video' | 'context';

export interface TranscriptFlowViewProps {
  /** 转录 segments（底层数据，不做修改） */
  segments: FlowSegment[];
  /** 显示模式 */
  variant: TranscriptFlowVariant;
  /** 当前播放时间 ms（review/video 模式用于高亮） */
  currentTime?: number;
  /** 正在录音中（live 模式） */
  isRecording?: boolean;
  /** 实时转录的临时文本 */
  interimText?: string;
  /** 转录模式标签 */
  transcribeMode?: 'streaming' | 'batch';
  /** 时间戳点击回调（跳转播放） */
  onTimestampClick?: (timeMs: number) => void;
  /** 困惑点标记回调（video 模式，🎯 按钮） */
  onMarkConfusion?: (timeMs: number, segmentId: string) => void;
  /** 文本编辑回调 */
  onSegmentTextUpdate?: (segmentId: string, text: string) => void;
  /** 是否可编辑 */
  editable?: boolean;
  /** 搜索查询 */
  searchQuery?: string;
  /** 启用选词解释 */
  enableWordExplainer?: boolean;
  /** 完整转录上下文文本（给 WordExplainer 用） */
  fullContextText?: string;
  /** 困惑点时间戳列表（review 模式显示困惑标记） */
  confusionTimestamps?: Array<{ timestamp: number; resolved: boolean }>;
  /** context 模式：困惑点时间 */
  confusionAtMs?: number;
  /** 默认折叠时显示的段落数 */
  collapsedParagraphs?: number;
  /** 默认展开 */
  defaultExpanded?: boolean;
  /** 自定义 className */
  className?: string;
  /** 显示标题栏 */
  showHeader?: boolean;
  /** 标题文本 */
  headerTitle?: string;
  /** 段落分组间隔（ms），默认 30000（30秒） */
  paragraphGapMs?: number;
}

// ─── 工具函数 ───

/** 紧凑时间格式 M:SS */
function formatCompactTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** 搜索高亮 */
function highlightText(text: string, query?: string): ReactNode {
  if (!query?.trim()) return text;
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[#FDF3C0] text-[#232322] px-0.5 rounded">
        {text.slice(idx, idx + lowerQuery.length)}
      </mark>
      {text.slice(idx + lowerQuery.length)}
    </>
  );
}

// ─── 段落分组 ───

interface Paragraph {
  /** 段落起始时间 ms */
  startMs: number;
  /** 段落内的 segments */
  segments: FlowSegment[];
}

function groupIntoParagraphs(
  segments: FlowSegment[],
  gapMs: number
): Paragraph[] {
  if (segments.length === 0) return [];

  // Max characters per paragraph — prevents wall-of-text for streaming mode
  const MAX_CHARS_PER_PARAGRAPH = 200;
  const MAX_SEGMENTS_PER_PARAGRAPH = 12;

  const paragraphs: Paragraph[] = [];
  let current: Paragraph = {
    startMs: segments[0].startMs,
    segments: [segments[0]],
  };
  let currentChars = segments[0].text.length;

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const lastSeg = current.segments[current.segments.length - 1];
    const gap = seg.startMs - lastSeg.endMs;

    const shouldSplit =
      gap > gapMs ||
      (seg.startMs - current.startMs) > gapMs ||
      currentChars >= MAX_CHARS_PER_PARAGRAPH ||
      current.segments.length >= MAX_SEGMENTS_PER_PARAGRAPH;

    if (shouldSplit) {
      paragraphs.push(current);
      current = { startMs: seg.startMs, segments: [seg] };
      currentChars = seg.text.length;
    } else {
      current.segments.push(seg);
      currentChars += seg.text.length;
    }
  }

  paragraphs.push(current);
  return paragraphs;
}

// ─── 内联 Segment Span ───

interface SegmentSpanProps {
  segment: FlowSegment;
  variant: TranscriptFlowVariant;
  isActive: boolean;
  /** 是否已播放过（用于荧光笔效果：已播放的文字变灰） */
  isPast: boolean;
  isConfusionAt: boolean;
  searchQuery?: string;
  showHoverTime: boolean;
  onTimestampClick?: (timeMs: number) => void;
  onMarkConfusion?: (timeMs: number, segmentId: string) => void;
  editable?: boolean;
  isEditing: boolean;
  draftText: string;
  onStartEdit?: (segment: FlowSegment) => void;
  onDraftChange?: (text: string) => void;
  onCommitEdit?: () => void;
  onCancelEdit?: () => void;
  hasConfusion?: { resolved: boolean };
}

function SegmentSpan({
  segment,
  variant,
  isActive,
  isPast,
  isConfusionAt,
  searchQuery,
  showHoverTime,
  onTimestampClick,
  onMarkConfusion,
  editable,
  isEditing,
  draftText,
  onStartEdit,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
  hasConfusion,
}: SegmentSpanProps) {
  const [hovered, setHovered] = useState(false);

  const highlighted = useMemo(
    () => highlightText(segment.text, searchQuery),
    [segment.text, searchQuery]
  );

  if (isEditing) {
    return (
      <span className="inline-block w-full my-1">
        <textarea
          value={draftText}
          onChange={(e) => onDraftChange?.(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancelEdit?.();
            }
          }}
          className="w-full min-h-[60px] rounded-lg border border-[#E9E9E7] bg-white px-2.5 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#E9E9E7]"
          autoFocus
        />
      </span>
    );
  }

  const isClickable = variant === 'review' || variant === 'video' || variant === 'context';

  return (
    <span
      className={[
        'relative inline rounded-sm',
        // 荧光笔高亮：当前正在播放的句子 — 醒目的黄色背景 + 平滑过渡
        isActive && !isConfusionAt
          ? 'bg-yellow-200/90 text-gray-900 font-medium shadow-[0_1px_0_rgba(250,204,21,0.4)] transition-all duration-300'
          : 'transition-colors duration-200',
        // 已播放的句子 — 略灰，视觉上区分已读/未读
        isPast && !isActive && !isConfusionAt ? 'text-gray-400' : '',
        // 未播放的句子 — 正常颜色
        !isPast && !isActive && !isConfusionAt ? 'text-gray-700' : '',
        // 困惑点时刻高亮
        isConfusionAt ? 'bg-red-50 text-red-700 rounded px-0.5' : '',
        // hover 效果
        !isActive && !isConfusionAt && hovered ? 'bg-gray-100/80' : '',
        // 可点击
        isClickable ? 'cursor-pointer' : '',
        // 可编辑
        editable ? 'hover:bg-[#EFEFEF]/50' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={
        isClickable
          ? () => onTimestampClick?.(segment.startMs)
          : undefined
      }
      onDoubleClick={
        editable ? () => onStartEdit?.(segment) : undefined
      }
      title={editable ? '双击编辑' : undefined}
    >
      {/* hover 时显示精确时间 */}
      {showHoverTime && hovered && !isActive && (
        <span className="absolute -top-5 left-0 text-[10px] font-mono text-[#787774] bg-white/95 border border-[#E9E9E7] rounded px-1 py-0.5 shadow-sm whitespace-nowrap z-10 pointer-events-none">
          {formatCompactTime(segment.startMs)}
        </span>
      )}

      {/* 文本内容 */}
      {highlighted}

      {/* 困惑点标记 */}
      {hasConfusion && (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ml-0.5 align-middle ${
            hasConfusion.resolved ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
      )}

      {/* 视频模式 hover 🎯 按钮 */}
      {variant === 'video' && hovered && onMarkConfusion && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMarkConfusion(segment.startMs, segment.id);
          }}
          className="inline-flex items-center justify-center w-5 h-5 ml-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors align-middle"
          title="标记困惑点"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" strokeWidth="2" />
            <path strokeLinecap="round" strokeWidth="2" d="M12 8v4M12 16h.01" />
          </svg>
        </button>
      )}
    </span>
  );
}

// ─── 段落组件 ───

interface ParagraphBlockProps {
  paragraph: Paragraph;
  variant: TranscriptFlowVariant;
  currentTime: number;
  searchQuery?: string;
  onTimestampClick?: (timeMs: number) => void;
  onMarkConfusion?: (timeMs: number, segmentId: string) => void;
  editable?: boolean;
  editingSegmentId: string | null;
  draftText: string;
  onStartEdit: (segment: FlowSegment) => void;
  onDraftChange: (text: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  confusionTimestamps?: Array<{ timestamp: number; resolved: boolean }>;
  confusionAtMs?: number;
  isLastParagraph?: boolean;
  'data-paragraph'?: boolean;
}

function ParagraphBlock({
  paragraph,
  variant,
  currentTime,
  searchQuery,
  onTimestampClick,
  onMarkConfusion,
  editable,
  editingSegmentId,
  draftText,
  onStartEdit,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
  confusionTimestamps,
  confusionAtMs,
  isLastParagraph,
  'data-paragraph': dataParagraph,
}: ParagraphBlockProps) {
  const isTimestampClickable = variant === 'review' || variant === 'video' || variant === 'context';

  // 段落是否包含当前播放的句子
  const isParaActive = (variant === 'review' || variant === 'video') &&
    paragraph.segments.some(seg => currentTime >= seg.startMs && currentTime < seg.endMs);
  // 段落是否已全部播放过
  const isParaPast = (variant === 'review' || variant === 'video') &&
    currentTime > 0 &&
    paragraph.segments.every(seg => seg.endMs <= currentTime);

  return (
    <div className={`relative ${isLastParagraph ? '' : 'mb-3'}`} data-paragraph={dataParagraph || true}>
      {/* 段落时间标签 */}
      <span
        className={[
          'inline-block text-xs font-mono tabular-nums mr-2 mb-0.5 transition-colors duration-200',
          // 当前活跃段落 — 时间戳也用黄色高亮
          isParaActive ? 'text-yellow-600 font-semibold' : '',
          // 已播放过的段落 — 时间戳变灰
          !isParaActive && isParaPast ? 'text-gray-300' : '',
          // 正常状态
          !isParaActive && !isParaPast && isTimestampClickable
            ? 'text-[#787774]/80 hover:text-[#232322] cursor-pointer'
            : '',
          !isParaActive && !isParaPast && !isTimestampClickable ? 'text-gray-400' : '',
          isTimestampClickable ? 'cursor-pointer' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={
          isTimestampClickable
            ? () => onTimestampClick?.(paragraph.startMs)
            : undefined
        }
      >
        {formatCompactTime(paragraph.startMs)}
      </span>

      {/* 段落内的 segments 连续排列 */}
      {paragraph.segments.map((seg, i) => {
        const isActive =
          (variant === 'review' || variant === 'video') &&
          currentTime >= seg.startMs &&
          currentTime < seg.endMs;

        // 已播放过的句子（endMs <= currentTime）
        const isPast =
          (variant === 'review' || variant === 'video') &&
          currentTime > 0 &&
          seg.endMs <= currentTime;

        const isConfusionAt =
          variant === 'context' &&
          confusionAtMs !== undefined &&
          seg.startMs <= confusionAtMs &&
          seg.endMs > confusionAtMs;

        const confusion = confusionTimestamps?.find(
          (c) => c.timestamp >= seg.startMs && c.timestamp < seg.endMs
        );

        return (
          <SegmentSpan
            key={seg.id}
            segment={seg}
            variant={variant}
            isActive={isActive}
            isPast={isPast}
            isConfusionAt={isConfusionAt}
            searchQuery={searchQuery}
            showHoverTime={i > 0}
            onTimestampClick={onTimestampClick}
            onMarkConfusion={onMarkConfusion}
            editable={editable}
            isEditing={editingSegmentId === seg.id}
            draftText={editingSegmentId === seg.id ? draftText : ''}
            onStartEdit={onStartEdit}
            onDraftChange={onDraftChange}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            hasConfusion={confusion}
          />
        );
      })}
    </div>
  );
}

// ─── 主组件 ───

export function TranscriptFlowView({
  segments,
  variant,
  currentTime = 0,
  isRecording = false,
  interimText = '',
  transcribeMode,
  onTimestampClick,
  onMarkConfusion,
  onSegmentTextUpdate,
  editable = false,
  searchQuery: externalSearchQuery,
  enableWordExplainer = false,
  fullContextText,
  confusionTimestamps,
  confusionAtMs,
  collapsedParagraphs = 3,
  defaultExpanded = false,
  className = '',
  showHeader = true,
  headerTitle,
  paragraphGapMs = 30000,
}: TranscriptFlowViewProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || variant === 'live' || variant === 'context');
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [editingOriginalText, setEditingOriginalText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const searchQuery = externalSearchQuery ?? internalSearchQuery;
  const canEdit = editable && typeof onSegmentTextUpdate === 'function';

  // 选词解释
  const containerRef = useRef<HTMLDivElement>(null);
  const { selection, clearSelection } = useTextSelection(
    enableWordExplainer ? containerRef : ({ current: null } as React.RefObject<HTMLElement | null>)
  );

  // 搜索过滤
  const filteredSegments = useMemo(() => {
    if (!searchQuery?.trim()) return segments;
    const q = searchQuery.toLowerCase();
    return segments.filter((seg) => seg.text.toLowerCase().includes(q));
  }, [segments, searchQuery]);

  // 段落分组
  const paragraphs = useMemo(
    () => groupIntoParagraphs(filteredSegments, paragraphGapMs),
    [filteredSegments, paragraphGapMs]
  );

  // 折叠/展开
  const displayParagraphs = useMemo(() => {
    if (isExpanded) return paragraphs;
    return paragraphs.slice(-collapsedParagraphs);
  }, [paragraphs, isExpanded, collapsedParagraphs]);

  const hiddenParagraphs = paragraphs.length - collapsedParagraphs;
  const hasMore = !isExpanded && hiddenParagraphs > 0;

  // 编辑逻辑
  const startEditing = useCallback(
    (segment: FlowSegment) => {
      if (!canEdit) return;
      setEditingSegmentId(segment.id);
      setDraftText(segment.text);
      setEditingOriginalText(segment.text);
      setAutoScrollEnabled(false);
    },
    [canEdit]
  );

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

  // 自动滚动到底部（live 模式）
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current && autoScrollEnabled) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScrollEnabled]);

  useEffect(() => {
    if (variant === 'live' && isRecording && autoScrollEnabled && !editingSegmentId) {
      scrollToBottom();
    }
  }, [segments.length, variant, isRecording, autoScrollEnabled, editingSegmentId, scrollToBottom]);

  // 自动滚动到当前播放位置（review 模式）
  useEffect(() => {
    if (variant !== 'review' && variant !== 'video') return;
    if (!scrollRef.current) return;
    // 找到当前活跃段落
    const activeParaIdx = displayParagraphs.findIndex((p) =>
      p.segments.some((seg) => currentTime >= seg.startMs && currentTime < seg.endMs)
    );
    if (activeParaIdx < 0) return;
    const paraElements = scrollRef.current.querySelectorAll('[data-paragraph]');
    const el = paraElements[activeParaIdx] as HTMLElement;
    if (!el) return;
    const container = scrollRef.current;
    const elRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime, variant, displayParagraphs]);

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (variant !== 'live') return;
      const target = e.target as HTMLDivElement;
      const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
      if (isNearBottom !== autoScrollEnabled && isRecording && !editingSegmentId) {
        setAutoScrollEnabled(isNearBottom);
      }
    },
    [autoScrollEnabled, editingSegmentId, isRecording, variant]
  );

  // 临时文本去重
  const lastText = segments[segments.length - 1]?.text || '';
  const normalizedInterim = (interimText || '').trim();
  const normalizedLast = lastText.trim();
  const interimVisible = normalizedInterim && normalizedInterim !== normalizedLast ? interimText : '';

  // 空状态
  if (segments.length === 0 && !interimVisible) {
    if (variant === 'live') {
      return (
        <div className={`flex flex-col items-center justify-center py-12 text-center ${className}`}>
          <div className="w-16 h-16 bg-[#FDF3C0] rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-[#787774]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-gray-700 mb-1">正在聆听...</h3>
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

  const title =
    headerTitle ??
    (variant === 'live'
      ? transcribeMode === 'streaming'
        ? '实时转录'
        : '转录结果'
      : variant === 'video'
        ? '视频内容'
        : '课堂转录');

  return (
    <div ref={containerRef} className={`flex flex-col ${className}`}>
      {/* 头部 */}
      {showHeader && (
        <div className="flex items-center justify-between px-1 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">
              📝 {title}
            </span>
            <span className="text-xs text-gray-400">{segments.length} 句</span>
            {searchQuery && (
              <span className="text-xs text-[#787774]">
                · {filteredSegments.length} 匹配
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* 搜索按钮 */}
            <button
              onClick={() => setShowSearch((p) => !p)}
              className={`p-1 rounded-md transition-colors ${
                showSearch
                  ? 'bg-[#FDF3C0] text-[#787774]'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title="搜索"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            {/* 折叠/展开 */}
            {variant !== 'live' && variant !== 'context' && paragraphs.length > collapsedParagraphs && (
              <button
                onClick={() => setIsExpanded((p) => !p)}
                className="text-xs text-[#787774] hover:text-[#232322] flex items-center gap-0.5 transition-colors"
              >
                {isExpanded ? '收起' : '展开'}
                <svg
                  className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 搜索栏 */}
      {showSearch && !externalSearchQuery && (
        <div className="px-1 pb-2">
          <div className="relative">
            <input
              type="text"
              value={internalSearchQuery}
              onChange={(e) => setInternalSearchQuery(e.target.value)}
              placeholder="搜索转录内容..."
              className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E9E9E7] focus:border-[#E9E9E7] bg-white"
              autoFocus
            />
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {internalSearchQuery && (
              <button
                onClick={() => setInternalSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 段落内容区 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto text-sm text-gray-700 leading-relaxed select-text px-1"
      >
        {/* 折叠提示 */}
        {hasMore && (
          <button
            onClick={() => setIsExpanded(true)}
            className="w-full text-xs text-gray-400 hover:text-[#232322] py-1.5 text-center transition-colors"
          >
            还有 {hiddenParagraphs} 个段落，点击展开
          </button>
        )}

        {displayParagraphs.map((para, pi) => (
          <ParagraphBlock
            key={`p-${para.startMs}`}
            data-paragraph
            paragraph={para}
            variant={variant}
            currentTime={currentTime}
            searchQuery={searchQuery}
            onTimestampClick={onTimestampClick}
            onMarkConfusion={onMarkConfusion}
            editable={canEdit}
            editingSegmentId={editingSegmentId}
            draftText={draftText}
            onStartEdit={startEditing}
            onDraftChange={setDraftText}
            onCommitEdit={commitEditing}
            onCancelEdit={cancelEditing}
            confusionTimestamps={confusionTimestamps}
            confusionAtMs={confusionAtMs}
            isLastParagraph={pi === displayParagraphs.length - 1}
          />
        ))}

        {/* 临时转录文本（live 模式） */}
        {interimVisible && (
          <span className="text-gray-400 italic animate-pulse"> {interimVisible}</span>
        )}
      </div>

      {/* live 模式回到最新按钮 */}
      {variant === 'live' && isRecording && !autoScrollEnabled && (
        <div className="flex justify-end px-2 py-1">
          <button
            onClick={() => {
              setAutoScrollEnabled(true);
              scrollToBottom();
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white bg-[#232322] hover:bg-[#FDECC8] rounded-full transition-all animate-bounce"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

export default TranscriptFlowView;
