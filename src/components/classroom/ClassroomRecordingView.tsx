'use client';

/**
 * ClassroomRecordingView — 录课中视图（v7 · 真的转录，真的可交互）
 *
 * v7 变更（M7 真接）：
 *   - 展开态的转录原文从 `<p>{transcriptText}</p>` 升级为 TranscriptFlowView。
 *     立刻解锁：段落分组、EN→中行内气泡、划词解释（WordExplainer）、搜索。
 *   - MindMap 节点点击 → 通过 scrollTargetMs 把对应段落滚到视线中央。
 *   - 保留 v6 的主画面思维导图 + 极薄状态头 + "结束这节课"按钮。
 *
 * 老的 concepts / transcriptText 字段保留向后兼容。
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Square, ChevronDown, ChevronUp, Languages } from 'lucide-react';
import { MindMap } from './MindMap';
import type { MindMapTree } from '@/hooks/useClassroomMindMap';
import type { TranscriptSegment } from '@/types';
import { extractEnglishRuns } from '@/lib/services/translation/extract-english';
import { useEnToZhEnabled, useEnToZhTranslation } from '@/hooks/useEnToZhTranslation';

// TranscriptFlowView 只在展开态用，且组件较重——code-split 一下，
// 保持课堂首屏打开时不拉这份 bundle。
const TranscriptFlowView = dynamic(
  () => import('@/components/TranscriptFlowView').then((m) => ({ default: m.TranscriptFlowView })),
  { ssr: false },
);

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
  /** 真实转录 segments（用于 TranscriptFlowView 分段展示） */
  segments?: TranscriptSegment[];
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
  /**
   * 当 MindMap 节点被点击时传入：带 `{ ms }` 的 nonce。
   * 本组件会：
   *   1. 自动展开转录抽屉（如果还没展开）
   *   2. 把该 ms 对应的段落滚到抽屉中央
   * 每次新点击都要带一个新的对象（或 bumped version），才能触发新一次跳转——
   * 纯数字 ms 不够，因为连续点同一个节点就无法再触发。
   */
  scrollTarget?: { ms: number; nonce: number } | null;
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
 *
 * M7-fix10: 当当前显示的句子里含英文 run 时，额外在下方挂一行极细的 zh 翻译，
 * 用户不必展开完整转录抽屉就能看到关键术语的中译。整段翻译仍走抽屉 + TranscriptFlowView。
 * 有一个小 `中/EN` 切换按钮挂在"正在听课"右侧，用户不想看翻译可以关掉（持久化）。
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
  const displayedLine = showInterim ? interimText! : hasFinal ? lastFinalLine! : '';

  // 持久化的 EN→中 开关——复用 TranscriptFlowView 走的那份 LocalStorage 偏好，
  // 避免课堂 tab 和复习 tab 两个开关各记各的。
  const [translateEnabled, setTranslateEnabled] = useEnToZhEnabled();

  // 从当前显示的这一行里抽出值得翻译的英文 run（≥2 词 + 有实词）
  const englishRuns = useMemo(
    () => (translateEnabled && displayedLine ? extractEnglishRuns(displayedLine) : []),
    [translateEnabled, displayedLine],
  );

  const { request, lookup } = useEnToZhTranslation(translateEnabled);

  // 新 run 出现时异步请求翻译；lookup 命中缓存时直接展示。
  // 故意用 string join 做依赖——run 集合稳定时不重复触发 fetch。
  const runsKey = englishRuns.join('|');
  useEffect(() => {
    if (englishRuns.length > 0) request(englishRuns);
  }, [runsKey, englishRuns, request]);

  // 收集已翻译好的 `EN → 中` pair，最多挂 2 条，避免刷屏
  const translated = useMemo(() => {
    return englishRuns
      .map((en) => ({ en, zh: lookup(en) }))
      .filter((p): p is { en: string; zh: string } => Boolean(p.zh))
      .slice(0, 2);
  }, [englishRuns, lookup]);

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
          {/* 右侧：EN→中 开关 —— 极小按钮，不抢戏 */}
          <button
            type="button"
            onClick={() => setTranslateEnabled(!translateEnabled)}
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-wide transition ${
              translateEnabled
                ? 'bg-[#232322] text-white'
                : 'text-ink-muted/70 hover:text-ink-secondary hover:bg-[#EFEFED]'
            }`}
            title={translateEnabled ? '关闭 EN→中 翻译' : '开启 EN→中 翻译'}
            aria-pressed={translateEnabled}
          >
            <Languages size={10} strokeWidth={2} />
            <span>EN→中</span>
          </button>
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
        {/* EN→中 行内提示：极轻字号，only when something actually got translated */}
        {translated.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {translated.map(({ en, zh }) => (
              <span
                key={en}
                className="inline-flex items-baseline gap-1.5 text-[11px] leading-snug text-ink-muted/80"
              >
                <span className="font-medium text-ink-muted">{en}</span>
                <span aria-hidden className="text-ink-muted/40">→</span>
                <span className="text-ink-secondary">{zh}</span>
              </span>
            ))}
          </div>
        ) : null}
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
  segments,
  interimText,
  recentLines = [],
  mindMapTree = EMPTY_TREE,
  mindMapNewIds = EMPTY_NEW_IDS,
  onAnchorClick,
  scrollTarget = null,
}: ClassroomRecordingViewProps) {
  const [expanded, setExpanded] = useState(false);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  // 有转录原文（从 segments 判定，不再依赖 transcriptText 字符串）
  const hasTranscriptSegments = Boolean(segments && segments.length > 0);
  const hasTranscript = hasTranscriptSegments || Boolean(transcriptText && transcriptText.trim().length > 0);

  // scrollTarget 变化时：自动展开抽屉 + 滚动到对应段落 + 1.2s 黄色脉冲高亮
  // 依赖 TranscriptFlowView 给每个段落挂的 data-paragraph-start-ms 属性，
  // 找到距离目标 ms 最近且 ≤ 目标的那个段落，scrollIntoView + 加 class。
  useEffect(() => {
    if (!scrollTarget) return;
    // 展开抽屉——如果用户手动收起过，点节点的意图就是"给我看看这段原话"
    setExpanded(true);
    // 等 TranscriptFlowView render + 展开动画结束再滚
    const timer = setTimeout(() => {
      const scope = transcriptScrollRef.current;
      if (!scope) return;
      const elements = Array.from(
        scope.querySelectorAll<HTMLElement>('[data-paragraph-start-ms]'),
      );
      if (elements.length === 0) return;
      // 找到 startMs ≤ target 的最后一段（即"包含这个时刻"的段落）
      let picked: HTMLElement | null = null;
      for (const el of elements) {
        const ms = Number(el.dataset.paragraphStartMs || '0');
        if (ms <= scrollTarget.ms) {
          picked = el;
        } else {
          break;
        }
      }
      const target = picked ?? elements[0];
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // M8 agent-native: 1.2s 黄色脉冲高亮——让用户一眼知道"就是这段"
      // 先移除同 class（以防连续点同一段时动画不重播），再重新 add。
      target.classList.remove('transcript-paragraph-highlight');
      // 强制 reflow 后再 add，浏览器才会重新播动画
      void target.offsetWidth;
      target.classList.add('transcript-paragraph-highlight');
      // 动画结束后自动移除 class，避免残留影响后续交互
      const cleanup = window.setTimeout(() => {
        target.classList.remove('transcript-paragraph-highlight');
      }, 1400);
      return () => window.clearTimeout(cleanup);
    }, 180);
    return () => clearTimeout(timer);
    // 故意只对 scrollTarget（含 nonce）敏感——同一个 ms 重复点击也要重新滚
  }, [scrollTarget]);

  const lastFinalLine = recentLines.length > 0 ? recentLines[recentLines.length - 1]?.text : undefined;

  return (
    <div className="flex h-full flex-col">
      <StatusHeader
        seconds={seconds}
        interimText={interimText}
        lastFinalLine={lastFinalLine}
      />

      {/* 主画面:思维导图 */}
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
              className="max-h-[38vh] overflow-y-auto rounded-xl bg-white px-4 py-3 ring-[0.5px] ring-[#232322]/[0.05]"
            >
              {hasTranscriptSegments ? (
                <TranscriptFlowView
                  segments={segments!}
                  variant="live"
                  isRecording
                  interimText={interimText}
                  transcribeMode="streaming"
                  enableEnToZhTranslation
                  enableWordExplainer
                  fullContextText={transcriptText ?? ''}
                  showHeader={false}
                  defaultExpanded
                  paragraphGapMs={30000}
                />
              ) : hasTranscript ? (
                // 没有 segments 但有字符串兜底——极少数老代码路径
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
