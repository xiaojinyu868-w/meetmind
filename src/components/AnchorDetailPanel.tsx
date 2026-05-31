'use client';

/**
 * 困惑点详情面板
 * 
 * 展示选中红点的详细内容，支持：
 * - 显示该时间点前后的转录文本
 * - 回放该片段音频
 * - 标记为已解决
 * - 发起 AI 对话解答
 * - 添加笔记
 */

import { useState, useCallback, useMemo } from 'react';
import type { Anchor } from '@/types';
import type { TranscriptSegment } from '@/types';
import { TranscriptFlowView } from './TranscriptFlowView';

interface AnchorDetailPanelProps {
  /** 选中的困惑点 */
  anchor: Anchor | null;
  /** 转录片段列表 */
  segments: TranscriptSegment[];
  /** 跳转到指定时间 */
  onSeek?: (timeMs: number) => void;
  /** 播放指定片段 */
  onPlay?: (startMs: number, endMs: number) => void;
  /** 标记为已解决 */
  onResolve?: () => void;
  /** 添加笔记 */
  onAddNote?: (text: string, anchorId: string) => void;
  /** 关闭面板 */
  onClose?: () => void;
  /** 上下文时间范围（毫秒） */
  contextBeforeMs?: number;
  contextAfterMs?: number;
}

export function AnchorDetailPanel({
  anchor,
  segments,
  onSeek,
  onPlay,
  onResolve,
  onAddNote,
  onClose,
  contextBeforeMs = 30000,
  contextAfterMs = 30000,
}: AnchorDetailPanelProps) {
  const [noteText, setNoteText] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  // 获取困惑点前后的转录上下文
  const contextSegments = useMemo(() => {
    if (!anchor || segments.length === 0) return { before: [], at: [], after: [] };

    const startMs = Math.max(0, anchor.timestamp - contextBeforeMs);
    const endMs = anchor.timestamp + contextAfterMs;

    const before: TranscriptSegment[] = [];
    const at: TranscriptSegment[] = [];
    const after: TranscriptSegment[] = [];

    for (const seg of segments) {
      if (seg.endMs < startMs) continue;
      if (seg.startMs > endMs) break;

      if (seg.endMs <= anchor.timestamp) {
        before.push(seg);
      } else if (seg.startMs >= anchor.timestamp) {
        after.push(seg);
      } else {
        at.push(seg);
      }
    }

    return { before, at, after };
  }, [anchor, segments, contextBeforeMs, contextAfterMs]);

  // 格式化时间
  const formatTime = useCallback((ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(minutes)}:${pad(seconds % 60)}`;
  }, []);

  // 播放上下文片段
  const handlePlayContext = useCallback(() => {
    if (!anchor || !onPlay) return;
    const startMs = Math.max(0, anchor.timestamp - contextBeforeMs);
    const endMs = anchor.timestamp + contextAfterMs;
    onPlay(startMs, endMs);
  }, [anchor, onPlay, contextBeforeMs, contextAfterMs]);

  // 跳转到困惑点
  const handleSeekToAnchor = useCallback(() => {
    if (!anchor || !onSeek) return;
    onSeek(anchor.timestamp);
  }, [anchor, onSeek]);

  // 提交笔记
  const handleSubmitNote = useCallback(() => {
    if (!anchor || !onAddNote || !noteText.trim()) return;
    onAddNote(noteText.trim(), anchor.id);
    setNoteText('');
    setIsAddingNote(false);
  }, [anchor, onAddNote, noteText]);

  if (!anchor) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-ink-muted">
        <div className="w-16 h-16 bg-paper-deep rounded-full flex items-center justify-center mb-4">
          <span className="text-2xl">🎯</span>
        </div>
        <p className="text-sm font-medium">选择一个困惑点查看详情</p>
        <p className="text-xs mt-1">点击波形上的红点或时间轴中的标记</p>
      </div>
    );
  }

  const hasContext = contextSegments.before.length > 0 || 
                     contextSegments.at.length > 0 || 
                     contextSegments.after.length > 0;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider-light bg-[#FADEC9]/30">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${anchor.resolved ? 'bg-pine' : 'bg-vermilion'} animate-pulse`} />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-ink break-words">
              困惑点 @ {formatTime(anchor.timestamp)}
            </h3>
            <p className="text-xs text-ink-muted break-words">
              {anchor.resolved ? '已解决' : '待解决'} · {new Date(anchor.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-ink-secondary hover:bg-paper-deep rounded-lg transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-divider-light">
        <button
          onClick={handleSeekToAnchor}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-ink-secondary hover:text-ink hover:bg-paper-deep rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          定位
        </button>
        
        {onPlay && (
          <button
            onClick={handlePlayContext}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-ink-secondary hover:text-ink hover:bg-paper-deep rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            播放片段
          </button>
        )}

        <div className="flex-1" />

        {!anchor.resolved && onResolve && (
          <button
            onClick={onResolve}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-pine hover:text-pine-deep hover:bg-pine-fog rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            标记已解决
          </button>
        )}
      </div>

      {/* 转录上下文 */}
      <div className="flex-1 overflow-y-auto p-4">
        <h4 className="text-sm font-medium text-ink-secondary mb-3 flex items-center gap-2">
          <span>📝</span>
          该时刻前后的课堂内容
          <span className="text-xs text-ink-muted font-normal">
            (前后 {contextBeforeMs / 1000}s)
          </span>
        </h4>

        {hasContext ? (
          <div>
            {/* 困惑点位置标记 */}
            <div className="flex items-center gap-2 py-2 mb-2">
              <div className="flex-1 h-px bg-vermilion/30" />
              <span className="text-xs text-vermilion font-medium px-2 py-1 bg-vermilion-mist/50 rounded-full">
                🎯 困惑点 {formatTime(anchor.timestamp)}
              </span>
              <div className="flex-1 h-px bg-vermilion/30" />
            </div>

            <TranscriptFlowView
              segments={[...contextSegments.before, ...contextSegments.at, ...contextSegments.after]}
              variant="context"
              confusionAtMs={anchor.timestamp}
              onTimestampClick={onSeek}
              defaultExpanded={true}
              showHeader={false}
              paragraphGapMs={15000}
              enableWordExplainer={true}
            />
          </div>
        ) : (
          <div className="text-center py-8 text-ink-muted">
            <p className="text-sm">暂无该时间段的转录内容</p>
          </div>
        )}
      </div>

      {/* 底部操作区 */}
      <div className="border-t border-divider-light p-4 space-y-3">
        {/* 添加笔记 */}
        {onAddNote && (
          <div>
            {isAddingNote ? (
              <div className="space-y-2">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="记录你对这个困惑点的理解或疑问..."
                  className="w-full px-3 py-2 text-sm border border-divider rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#1C1B19]/20 focus:border-[#E8E2D5]"
                  rows={3}
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSubmitNote}
                    disabled={!noteText.trim()}
                    className="flex-1 px-3 py-2 text-sm font-medium text-white bg-[#1C1B19] rounded-lg hover:bg-[#FDECC8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    保存笔记
                  </button>
                  <button
                    onClick={() => {
                      setIsAddingNote(false);
                      setNoteText('');
                    }}
                    className="px-3 py-2 text-sm text-ink-muted hover:text-navy hover:bg-paper-warm rounded-lg transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingNote(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-ink-secondary hover:text-navy border border-divider rounded-xl hover:bg-paper-warm transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                添加笔记
              </button>
            )}
          </div>
        )}

        {/* 困惑点备注 */}
        {anchor.note && (
          <div className="p-3 bg-sunflower-50 border border-sunflower-200 rounded-lg">
            <p className="text-xs text-sunflower-700 font-medium mb-1">📌 备注</p>
            <p className="text-sm text-sunflower-900">{anchor.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}
