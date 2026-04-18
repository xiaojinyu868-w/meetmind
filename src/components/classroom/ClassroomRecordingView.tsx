'use client';

/**
 * ClassroomRecordingView — 录课中视图（v6 · 生长中的思维导图）
 *
 * 设计变更相对 v5：
 *   - 主画面不再是"一条理解卡片流 + 一条刚才讲到流"——那是"零散气泡"，信息密度低
 *     且互相重复。
 *   - 换成一棵真正的思维导图（MindMap 组件）：中心节点是本段主题，一级分支是老师讲
 *     到的主要概念，叶子是要点。每 ~45s 或命中主题切换词时由 LLM 整理一次。
 *   - 顶部保留极薄状态条（正在听课 + 计时 + 跟读），不刷屏。
 *   - 底部"刚才讲到"卡片区砍掉，换成单行"当前句"——屏幕真正的主角是导图。
 *   - 完整转录原文依然可点击展开查看。
 *
 * 老的 concepts 字段向后兼容但已不展示——通过 tree 传入结构化数据。
 */

import React, { useState, useEffect, useRef } from 'react';
import { Square, ChevronDown, ChevronUp } from 'lucide-react';
import { MindMap } from './MindMap';
import type { MindMapTree } from '@/hooks/useClassroomMindMap';

export interface LiveConcept {
  id: string;
  term: string;
  quote: string;
  /** 在这节课里出现的时间戳（相对录音开始的毫秒数） */
  at: number;
}

export interface ClassroomRecordingViewProps {
  seconds: number;
  /** 保留用于向后兼容（不再直接展示） */
  concepts?: LiveConcept[];
  onStop: () => void;
  /** 真实转录文本（整段拼接） */
  transcriptText?: string;
  /** 正在流式进来但未落定的「跟读」片段（interim） */
  interimText?: string;
  /** 最近已落定的 N 句（仍在 ClassroomView 里用于其他逻辑，这里只取最后一条做单行展示） */
  recentLines?: Array<{ id: string; text: string; startMs: number }>;
  /** 思维导图树（由 useClassroomMindMap 提供） */
  mindMapTree?: MindMapTree;
  /** 最近一轮新增的节点 id */
  mindMapNewIds?: Set<string>;
  /** 点击节点时间戳 → 跳转录音位置（可选） */
  onAnchorClick?: (ms: number) => void;
}

// ── 时间工具 ──────────────────────────────────────────────────────────

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ── 顶部状态条 ────────────────────────────────────────────────────────

/**
 * 极薄状态条：红点 + 正在听课 + 计时 + 跟读 / 当前句
 * - 有 interim 时显示 interim（正在识别但未落定）
 * - 无 interim 时如果有 lastFinalLine 显示它
 * - 都没有时显示 "在听……"
 */
function StatusHeader({
  seconds,
  interimText,
  lastFinalLine,
}: {
  seconds: number;
  interimText?: string;
  lastFinalLine?: string;
}) {
  const showInterim = Boolean(interimText && interimText.trim().length > 0);
  const hasFinal = Boolean(lastFinalLine && lastFinalLine.trim().length > 0);

  return (
    <div className="flex-shrink-0 bg-canvas px-8 pt-7 pb-4 lg:px-12">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-baseline gap-3">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D96B6B] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D96B6B]" />
          </span>
          <span className="text-[13px] font-medium tracking-[-0.005em] text-ink">
            正在听课
          </span>
          <span className="font-mono text-[13px] tabular-nums tracking-tight text-ink-muted">
            {formatTime(seconds)}
          </span>
        </div>
        <div className="mt-2.5 min-h-[20px]">
          {showInterim ? (
            <p className="truncate text-[13px] leading-relaxed text-ink-secondary italic">
              {interimText}
              <span className="ml-0.5 inline-block h-[12px] w-[2px] translate-y-[1px] bg-ink-secondary/60 animate-pulse" />
            </p>
          ) : hasFinal ? (
            <p className="truncate text-[12.5px] leading-relaxed text-ink-muted">
              {lastFinalLine}
            </p>
          ) : (
            <p className="text-[12px] leading-relaxed text-ink-muted/70">
              {seconds < 3 ? '准备好了——说话吧。' : '在听……'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 折叠区：完整转录原文 ──────────────────────────────────────────────

function TranscriptToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium text-ink-muted/80 hover:bg-[#EFEFED] hover:text-ink-secondary transition"
    >
      {expanded ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
      {expanded ? '收起实时转录原文' : '查看实时转录原文'}
    </button>
  );
}

// ── 底部：结束录课 ────────────────────────────────────────────────────

function StopBar({ onStop }: { onStop: () => void }) {
  return (
    <div className="flex-shrink-0 border-t border-[#E9E9E7]/70 bg-canvas px-8 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-4 lg:px-12">
      <div className="mx-auto w-full max-w-3xl">
        <button
          type="button"
          onClick={onStop}
          className="group flex w-full items-center justify-center gap-2.5 rounded-full bg-ink py-3.5 text-[13.5px] font-medium text-white transition hover:bg-[#1a1a19] active:scale-[0.995]"
        >
          <Square size={11} strokeWidth={2} fill="currentColor" />
          结束这节课
        </button>
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────

const EMPTY_TREE: MindMapTree = { title: '', nodes: [] };
const EMPTY_NEW_IDS: Set<string> = new Set();

export function ClassroomRecordingView({
  seconds,
  onStop,
  transcriptText,
  interimText,
  recentLines = [],
  mindMapTree = EMPTY_TREE,
  mindMapNewIds = EMPTY_NEW_IDS,
  onAnchorClick,
}: ClassroomRecordingViewProps) {
  const [expanded, setExpanded] = useState(false);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  // 展开时：文本变化自动滚到底部（跟读效果）
  useEffect(() => {
    if (!expanded) return;
    const el = transcriptScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcriptText, expanded]);

  const hasTranscript = Boolean(transcriptText && transcriptText.trim().length > 0);
  const lastFinalLine = recentLines.length > 0 ? recentLines[recentLines.length - 1]?.text : undefined;

  return (
    <div className="flex h-full flex-col">
      <StatusHeader
        seconds={seconds}
        interimText={interimText}
        lastFinalLine={lastFinalLine}
      />

      {/* 主画面：思维导图 */}
      <MindMap
        tree={mindMapTree}
        newNodeIds={mindMapNewIds}
        elapsedMs={seconds * 1000}
        onAnchorClick={onAnchorClick}
      />

      {/* 展开态：完整原文抽屉 */}
      {expanded && (
        <div className="flex-shrink-0 border-t border-[#E9E9E7]/70 bg-white/40 px-8 py-4 lg:px-12">
          <div className="mx-auto w-full max-w-3xl">
            <div
              ref={transcriptScrollRef}
              className="max-h-[28vh] overflow-y-auto rounded-xl bg-white px-4 py-3 ring-[0.5px] ring-[#232322]/[0.05]"
            >
              {hasTranscript ? (
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
                  {transcriptText}
                </p>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-ink-muted/80">
                  还没听到内容……等老师说话我就开始记。
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-shrink-0 justify-center border-t border-[#E9E9E7]/40 bg-canvas pt-2 pb-1">
        <TranscriptToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      </div>

      <StopBar onStop={onStop} />
    </div>
  );
}

export default ClassroomRecordingView;
