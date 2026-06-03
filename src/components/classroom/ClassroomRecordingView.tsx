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

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Square, ChevronDown, ChevronUp, Languages, Play, Pause } from 'lucide-react';
import { MindMap } from './MindMap';
import { OctoBuddySprite } from './OctoBuddy';
import type { MindMapTree } from '@/hooks/useClassroomMindMap';

import type { TranscriptSegment } from '@/types';
import { extractChineseRuns, extractEnglishRuns } from '@/lib/services/translation/extract-english';
import { useEnToZhTranslation, useTranslationMode, type TranslationMode } from '@/hooks/useEnToZhTranslation';
import { buildLiveTranslationRows } from '@/lib/utils/live-translation-rows';
import { stitchLiveSentences } from '@/lib/utils/stitch-live-sentences';
import { cycleTranslationMode, resolveSessionTranslationMode } from './ClassroomRecordingView.model';

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
  /** 试听课音频播放控制：浏览器自动播放失败时，这个按钮就是用户手势入口 */
  isDemoPlayback?: boolean;
  demoAudioPlaying?: boolean;
  demoAudioNeedsGesture?: boolean;
  onToggleDemoAudio?: () => void;
  /** 英文试听课默认开启 EN→中，但不写入用户长期偏好 */
  defaultTranslationMode?: TranslationMode;
  /** 试听课听完后的课后引导 */
  isDemoComplete?: boolean;
  onReplayDemo?: () => void;
  onFinishDemo?: () => void;
}

// ── 时间工具 ──────────────────────────────────────────────────────────

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function LiveTranscriptPanel({
  segments,
  recentLines,
  interimText,
  translationMode,
  seconds,
  expanded,
  onToggleExpanded,
  onCycleTranslationMode,
  onStop,
  isDemoPlayback,
  demoAudioPlaying,
  demoAudioNeedsGesture,
  onToggleDemoAudio,
}: {
  segments?: TranscriptSegment[];
  recentLines: Array<{ id: string; text: string; startMs: number }>;
  interimText?: string;
  translationMode: TranslationMode;
  seconds: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onCycleTranslationMode: () => void;
  onStop: () => void;
  isDemoPlayback?: boolean;
  demoAudioPlaying?: boolean;
  demoAudioNeedsGesture?: boolean;
  onToggleDemoAudio?: () => void;
}) {
  const rows = useMemo(
    () => buildLiveTranslationRows({ segments, recentLines, interimText, maxFinalRows: 10 }),
    [segments, recentLines, interimText],
  );
  const translateEnabled = translationMode !== 'off';
  const hasDraftRow = rows.some((row) => row.id === 'live-interim');
  const activeDirection: Exclude<TranslationMode, 'off'> = translationMode === 'zh-en' ? 'zh-en' : 'en-zh';
  const { request, lookup } = useEnToZhTranslation(translateEnabled, activeDirection);
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastRequestedTermsKeyRef = useRef('');
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const termsByRow = useMemo(() => {
    const next = new Map<string, string[]>();
    // M14.5.5 fix: 之前只对最后 4 行做翻译（rows.slice(-4)），其他 6 行永远没翻译。
    // 用户反馈"有些句子没翻译"的根因。现在所有可见 rows 都翻——
    // useEnToZhTranslation 内置 LRU 缓存 + LocalStorage 持久化，
    // 重复 term 不会重复调 LLM，没有性能负担。
    for (const row of rows) {
      if (row.id === 'live-interim') {
        next.set(row.id, []);
        continue;
      }
      const terms = translationMode === 'zh-en'
        ? extractChineseRuns(row.text)
        : extractEnglishRuns(row.text);
      next.set(row.id, terms.slice(0, 1));
    }
    return next;
  }, [rows, translationMode]);

  const terms = useMemo(
    () => rows.flatMap((row) => termsByRow.get(row.id) ?? []),
    [rows, termsByRow],
  );
  const termsKey = terms.join('|');

  useEffect(() => {
    if (!translateEnabled || terms.length === 0 || !termsKey) return;
    if (lastRequestedTermsKeyRef.current === termsKey) return;
    lastRequestedTermsKeyRef.current = termsKey;
    request(terms);
  }, [request, terms, termsKey, translateEnabled]);

  // M14.5.6: 把 ASR 物理切片缝合成自然句子流。
  // 用户反馈：之前每段 row 独立 <p> 渲染，"look" + "s and..." 永远不愈合，
  // 时间戳每 2 秒一块，对正在上课的学生是阅读灾难。
  // stitchLiveSentences 做：词中切愈合 + 中文不加空格 + 句尾切句 + 长讲软标点 flush。
  const stitchedSentences = useMemo(() => {
    const inputs = rows.map((row) => {
      const term = termsByRow.get(row.id)?.[0];
      const translation = term && translateEnabled ? lookup(term) : undefined;
      return {
        id: row.id,
        text: row.text,
        startMs: row.startMs,
        isInterim: row.id === 'live-interim',
        translation,
      };
    });
    return stitchLiveSentences(inputs);
  }, [rows, termsByRow, translateEnabled, lookup]);
  const stableSentenceCount = stitchedSentences.filter((s) => !s.isInterim).length;

  const updateJumpVisibility = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpToBottom(distance > 96);
  }, []);

  const jumpToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    setShowJumpToBottom(false);
  }, []);

  useEffect(() => {
    updateJumpVisibility();
  }, [rows.length, updateJumpVisibility]);

  return (
    <aside className="relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[22px] border border-divider bg-card shadow-soft">
      <div className="flex-shrink-0 border-b border-divider bg-paper-warm px-3.5 py-3">
        <div className="rounded-[18px] border border-pine/15 bg-card px-3.5 py-3 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pine opacity-45" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-pine" />
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">课堂文字</p>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-pine/85">
                    LIVE
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  {hasDraftRow ? (
                    <span className="font-serif italic text-pine/85">正在听这一句…</span>
                  ) : stableSentenceCount > 0 ? (
                    <span>
                      已记
                      <span className="font-mono mx-1 tabular-nums text-pine font-medium">{stableSentenceCount}</span>
                      句
                    </span>
                  ) : (
                    <span className="font-serif italic">等老师开口</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {isDemoPlayback && onToggleDemoAudio ? (
                <button
                  type="button"
                  onClick={onToggleDemoAudio}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition active:scale-95 ${
                    demoAudioPlaying
                      ? 'bg-paper-warm text-ink-secondary hover:text-ink'
                      : 'bg-ink text-white shadow-soft hover:opacity-90'
                  }`}
                  title={demoAudioPlaying ? '暂停试听音频' : '播放试听音频'}
                  aria-label={demoAudioPlaying ? '暂停试听音频' : '播放试听音频'}
                >
                  {demoAudioPlaying ? <Pause size={12} strokeWidth={2} /> : <Play size={12} strokeWidth={2} fill="currentColor" />}
                  <span>{demoAudioPlaying ? '暂停' : demoAudioNeedsGesture ? '播放声音' : '播放'}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={onStop}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white shadow-soft transition hover:opacity-90 active:scale-95"
                title="结束这节课"
                aria-label="结束这节课"
              >
                <Square size={11} strokeWidth={2} fill="currentColor" />
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="font-mono text-[12px] font-medium tabular-nums text-pine">{formatTime(seconds)}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-warm">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pine to-pine-deep transition-all"
                style={{ width: `${Math.min(100, Math.max(6, seconds / 90))}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 rounded-full border border-divider bg-card px-2 py-1.5">
          <div className="inline-flex rounded-full bg-paper-warm p-0.5">
            <span className="rounded-full bg-card px-3 py-1 text-[12px] font-medium text-ink shadow-soft">实时文字</span>
            <span className="px-3 py-1 text-[12px] font-medium text-ink-muted">结构</span>
          </div>
          <button
            type="button"
            onClick={onCycleTranslationMode}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
              translateEnabled ? 'bg-ink text-white shadow-soft' : 'text-ink-muted hover:bg-paper-warm'
            }`}
            title="切换翻译模式：关闭 / EN→中 / 中→EN"
          >
            <Languages size={11} strokeWidth={2} />
            <span>{translationMode === 'off' ? '翻译关' : translationMode === 'en-zh' ? 'EN→中' : '中→EN'}</span>
          </button>
        </div>
      </div>

      <div
        ref={listRef}
        onScroll={updateJumpVisibility}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-divider bg-canvas px-4 text-center">
            <p className="max-w-[14rem] text-[12.5px] leading-relaxed text-ink-muted">
              等老师开口后，这里会开始出现实时文字。
            </p>
          </div>
        ) : (
          // M14.5.6: 自然句流（stitch 后） —— 像看 YouTube 字幕，不像 ASR debug 日志。
          //
          // 之前的灾难（用户实测截图）：
          //   - "look" + "s and..." 永远显示成两段，要在脑子里缝
          //   - "a" + "bility" / "ev" + "eryone" 同上
          //   - 每 2 秒一块时间戳 + 行间距，视觉跳跃严重
          //
          // 现在：
          //   - stitchLiveSentences 在客户端把 rows 缝成句子（词中切愈合，中文不加空格）
          //   - 每个 sentence 一行 <p>，时间戳只在句首给一次（淡灰小号 mono，不喧宾夺主）
          //   - 翻译在句尾以斜体淡色形式跟随（— 译文）
          //   - interim 单独 italic muted（"正在听这一句"的视觉提示）
          //   - 唯一自由度：向上滚动看历史；新内容追加底部
          //
          // 阅读手感对齐：iOS 实时听写 / Otter / YouTube 自动字幕。
          <div
            className="space-y-1.5 leading-[1.95] text-[13.5px]"
            style={{ wordBreak: 'normal', overflowWrap: 'break-word' }}
          >
            {stitchedSentences.map((sentence, index) => {
              const isLatest = index === stitchedSentences.length - 1;
              const { isInterim } = sentence;

              return (
                <p
                  key={sentence.id}
                  className={`m-0 ${
                    isInterim
                      ? 'text-ink-muted italic'
                      : isLatest
                        ? 'text-ink'
                        : 'text-ink-secondary'
                  }`}
                >
                  <span
                    className="mr-1.5 inline-block align-baseline font-mono text-[10.5px] tabular-nums text-ink-muted/55"
                    style={{ verticalAlign: '0.05em' }}
                  >
                    {formatTime(Math.floor(sentence.startMs / 1000))}
                  </span>
                  <span>{sentence.text}</span>
                  {translateEnabled && sentence.translation && !isInterim ? (
                    <span className="ml-1.5 inline italic text-ink-muted/80">
                      — {sentence.translation}
                    </span>
                  ) : null}
                </p>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {showJumpToBottom ? (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-[70px] right-5 rounded-full border border-divider bg-white px-3 py-2 text-[12px] font-medium text-ink-secondary transition hover:text-ink"
        >
          回到底部
        </button>
      ) : null}

      <div className="flex-shrink-0 border-t border-divider bg-white px-3 py-3">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex w-full items-center justify-center gap-1.5 rounded-full bg-canvas px-3 py-2.5 text-[12px] font-medium text-ink-secondary transition hover:text-ink"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          {expanded ? '收起完整文字' : '展开完整文字'}
        </button>
      </div>
    </aside>
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
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium text-ink-muted/80 hover:bg-[#F2EDE3] hover:text-ink-secondary transition"
    >
      {expanded ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
      {expanded ? '收起实时文字' : '查看实时文字'}
    </button>
  );
}

function DemoAfterClassPanel({
  onFinish,
  onReplay,
}: {
  onFinish?: () => void;
  onReplay?: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-5 lg:px-6">
      <div className="rounded-[24px] border border-divider bg-[#F2EDE3] px-5 py-5">
        <div className="flex items-start gap-4">
          <OctoBuddySprite mood="happy" size="lg" className="-ml-2 -mt-3 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">课后</p>
            <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.04em] text-ink">
              这节试听课听完了。
            </h2>
            <p className="mt-3 max-w-[28rem] text-[13px] leading-[1.75] text-ink-secondary">
              课堂里先停在这里。点“结束这节课”，我带你去课后复习页，那里有完整应用矩阵。
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <button
          type="button"
          onClick={onFinish}
          className="rounded-[20px] border border-ink bg-ink px-5 py-4 text-left text-white transition hover:bg-[#1a1a19] active:scale-[0.99]"
        >
          <p className="text-[15px] font-semibold tracking-[-0.02em]">结束这节课</p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/70">进入课后复习和应用矩阵</p>
        </button>
        <button
          type="button"
          onClick={onReplay}
          className="rounded-[20px] border border-divider bg-canvas px-4 py-4 text-left text-[13px] font-medium text-ink-secondary transition hover:text-ink"
        >
          再听一遍
        </button>
      </div>
    </div>
  );
}

// ── 底部：结束录课 ────────────────────────────────────────────────────

function StopBar({ onStop }: { onStop: () => void }) {
  return (
      <div className="flex-shrink-0 bg-canvas px-8 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2 lg:hidden">
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
  isDemoPlayback = false,
  demoAudioPlaying = false,
  demoAudioNeedsGesture = false,
  onToggleDemoAudio,
  defaultTranslationMode,
  isDemoComplete = false,
  onReplayDemo,
  onFinishDemo,
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

  const [userTranslationMode, setUserTranslationMode] = useTranslationMode();
  const [translationTouched, setTranslationTouched] = useState(false);
  const translationMode = resolveSessionTranslationMode({
    userMode: userTranslationMode,
    sessionDefault: defaultTranslationMode,
    userTouched: translationTouched,
  });
  const cycleTranslationModeHandler = () => {
    setTranslationTouched(true);
    setUserTranslationMode(cycleTranslationMode(translationMode));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 px-2.5 py-2.5 lg:px-3">
        <div className="grid h-full w-full grid-cols-1 gap-3 lg:grid-cols-[minmax(390px,0.82fr)_minmax(0,1.18fr)] xl:grid-cols-[minmax(420px,0.78fr)_minmax(0,1.22fr)]">
          <div className="hidden min-h-0 lg:block">
            <LiveTranscriptPanel
              segments={segments}
              recentLines={recentLines}
              interimText={interimText}
              translationMode={translationMode}
              seconds={seconds}
              expanded={expanded}
              onToggleExpanded={() => setExpanded((v) => !v)}
              onCycleTranslationMode={cycleTranslationModeHandler}
              onStop={onStop}
              isDemoPlayback={isDemoPlayback}
              demoAudioPlaying={demoAudioPlaying}
              demoAudioNeedsGesture={demoAudioNeedsGesture}
              onToggleDemoAudio={onToggleDemoAudio}
            />
          </div>
          <div className="min-w-0 overflow-hidden rounded-[24px] border border-divider bg-white">
            {isDemoComplete ? (
              <DemoAfterClassPanel onFinish={onFinishDemo} onReplay={onReplayDemo} />
            ) : (
              <MindMap
                tree={mindMapTree}
                newNodeIds={mindMapNewIds}
                elapsedMs={seconds * 1000}
                onAnchorClick={onAnchorClick}
              />
            )}
          </div>
        </div>
      </div>

      {/* 展开态：完整原文抽屉 */}
      {expanded && (
        <div className="flex-shrink-0 border-t border-divider bg-canvas px-4 py-3 lg:px-6">
          <div className="mx-auto w-full max-w-4xl">
            <div
              ref={transcriptScrollRef}
              className="max-h-[38vh] overflow-y-auto rounded-2xl border border-divider bg-white px-4 py-3"
            >
              {hasTranscriptSegments ? (
                <TranscriptFlowView
                  segments={segments!}
                  variant="live"
                  isRecording
                  interimText={interimText}
                  transcribeMode="streaming"
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

      <div className="flex flex-shrink-0 justify-center border-t border-[#E8E2D5]/40 bg-canvas pt-2 pb-1 lg:hidden">
        <TranscriptToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      </div>

      <StopBar onStop={onStop} />
    </div>
  );
}

export default ClassroomRecordingView;
