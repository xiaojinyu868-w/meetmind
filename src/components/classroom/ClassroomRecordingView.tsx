'use client';

/**
 * ClassroomRecordingView — 录课中视图
 *
 * 设计意图（核心）：
 *   录课中的屏幕是"留白"。MeetMind 不在你上课的时候刷屏幕给你看。
 *   它只做两件事：1) 让你知道它在听；2) 偶尔递上一张"我刚听到一个关键概念"的小卡。
 *
 *   这不是"实时转录界面"——那是录音笔的形态。
 *   这是"AI 同桌在做笔记"的形态——你上课，它在旁边默默记。
 *
 * 区块：
 *   顶部：录音计时器（极简，红点+时间）
 *   中部：关键概念气泡流（AI 刚听到的概念，2-5 秒浮现一张）
 *   底部：可折叠的"查看实时转录原文"（默认收起）
 *   固定：停止录音按钮（独立一行，明确但不抢戏）
 *
 * 接入点：
 *   后续用 Recorder 组件的 transcript 驱动 concepts；现在用占位。
 *
 * 设计系统：零渐变、零阴影、纯平涂
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Square, ChevronDown, ChevronUp } from 'lucide-react';

export interface LiveConcept {
  id: string;
  term: string;
  quote: string;
  /** 在这节课里出现的秒数 */
  at: number;
}

export interface ClassroomRecordingViewProps {
  seconds: number;
  concepts: LiveConcept[];
  onStop: () => void;
  /** 真实转录文本（整段拼接） */
  transcriptText?: string;
}

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatAt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** 顶部录音状态条 */
function StatusBar({ seconds }: { seconds: number }) {
  return (
    <div className="flex items-center gap-3 px-6 pt-8 pb-2">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#D96B6B] opacity-75 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D96B6B]" />
      </span>
      <span className="text-[13px] font-medium text-ink">正在听课</span>
      <span className="text-[12px] tabular-nums text-ink-muted">
        {formatTime(seconds)}
      </span>
    </div>
  );
}

/** 关键概念气泡 */
function ConceptBubble({ concept, isLatest }: { concept: LiveConcept; isLatest: boolean }) {
  return (
    <div
      className={`relative flex gap-3 rounded-xl px-4 py-3 transition-colors ${
        isLatest
          ? 'bg-[#FDF3C0]/30 before:absolute before:left-0 before:top-3 before:bottom-3 before:w-0.5 before:rounded-full before:bg-[#FDF3C0]'
          : ''
      }`}
    >
      <span className="mt-1.5 inline-flex h-1 w-1 flex-shrink-0 rounded-full bg-ink-muted/60" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink leading-snug">
          {concept.term}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
          「{concept.quote}」
        </p>
        <p className="mt-1 text-[11px] text-ink-muted/60 tabular-nums">
          {formatAt(concept.at)}
        </p>
      </div>
    </div>
  );
}

/** 主体：关键概念流 */
function ConceptStream({ concepts }: { concepts: LiveConcept[] }) {
  if (concepts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-10 pb-10 text-center">
        <p className="text-[14px] text-ink-muted">
          我在听，等老师讲到关键的地方，我会记下来。
        </p>
        <p className="mt-1.5 text-[12px] text-ink-muted/60">
          你专心听就好，不用盯着屏幕。
        </p>
      </div>
    );
  }

  // 最新的放顶上
  const ordered = [...concepts].reverse();

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-3 flex items-center gap-2 px-1 pt-2 text-[11px] font-medium tracking-wide text-ink-muted">
          <span className="inline-flex h-1 w-1 rounded-full bg-ink-muted/60" />
          <span>正在听到的</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {ordered.map((c, i) => (
            <ConceptBubble key={c.id} concept={c} isLatest={i === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 可折叠的转录原文 */
function TranscriptToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1 px-6 py-2 text-[12px] text-ink-muted/70 transition-colors hover:text-ink-muted"
    >
      {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      {expanded ? '收起实时转录原文' : '查看实时转录原文'}
    </button>
  );
}

/** 底部：停止录音 */
function StopBar({ onStop }: { onStop: () => void }) {
  return (
    <div className="flex-shrink-0 border-t border-[#E9E9E7]/60 bg-canvas px-5 pb-5 pt-3">
      <div className="mx-auto w-full max-w-2xl">
        <button
          type="button"
          onClick={onStop}
          className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-[14px] font-medium text-ink ring-[0.5px] ring-[#232322]/[0.06] transition-all hover:ring-[#232322]/[0.14] active:scale-[0.995]"
        >
          <Square size={14} strokeWidth={1.8} fill="currentColor" className="text-[#D96B6B]" />
          结束录课
        </button>
      </div>
    </div>
  );
}

export function ClassroomRecordingView({
  seconds,
  concepts,
  onStop,
  transcriptText,
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

  const transcriptArea = useMemo(() => {
    if (!expanded) return null;
    return (
      <div className="mx-6 mb-3 rounded-xl bg-white/60 px-4 py-3 ring-[0.5px] ring-[#232322]/[0.04]">
        <div
          ref={transcriptScrollRef}
          className="max-h-[28vh] overflow-y-auto"
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
    );
  }, [expanded, transcriptText, hasTranscript]);

  return (
    <div className="flex h-full flex-col">
      <StatusBar seconds={seconds} />
      <ConceptStream concepts={concepts} />
      {transcriptArea}
      <div className="flex justify-center pb-1">
        <TranscriptToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      </div>
      <StopBar onStop={onStop} />
    </div>
  );
}

export default ClassroomRecordingView;
