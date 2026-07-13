'use client';

/**
 * ClassroomRecordingView — 录课中视图（v7 · 真的转录，真的可交互）
 *
 * v7 变更（M7 真接）：
 *   - 实时文字使用自然句流，避免把 ASR 物理切片直接暴露给用户。
 *   - 中间主画面是课堂脉络：当前讲解 / 近期推进 / 课后保留点。
 *   - 思维导图、闪卡和测验留在课后应用矩阵。
 *
 * 老的 concepts / transcriptText 字段保留向后兼容。
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Square, Languages, Play, Pause, Camera } from 'lucide-react';
import { ClassroomFlowCanvas } from './ClassroomFlowCanvas';
import { OctoBuddySprite } from './OctoBuddy';
import type { ClassroomFlowState } from '@/types/classroom-flow';

import type { TranscriptSegment } from '@/types';
import { extractChineseRuns, extractEnglishRuns } from '@/lib/services/translation/extract-english';
import { useEnToZhTranslation, useTranslationMode, type TranslationMode } from '@/hooks/useEnToZhTranslation';
import { buildLiveTranslationRows } from '@/lib/utils/live-translation-rows';
import { stitchLiveSentences } from '@/lib/utils/stitch-live-sentences';
import { getSpeakerLabel, getSpeakerColorClass } from '@/lib/services/asr/diarization-service';
import { cycleTranslationMode, resolveSessionTranslationMode } from './ClassroomRecordingView.model';
import { COPY } from '@/lib/ui/copy';

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
  /** 真实转录 segments（用于自然句流与移动端原话视图） */
  segments?: TranscriptSegment[];
  /** 正在流式进来但未落定的「跟读」片段（interim） */
  interimText?: string;
  /** 最近已落定的 N 句（仍在 ClassroomView 里用于其他逻辑，这里只取最后一条做单行展示） */
  recentLines?: Array<{ id: string; text: string; startMs: number }>;
  /** 模型基于真实转录形成的课堂脉络 */
  classroomFlow?: ClassroomFlowState;
  /** 最近一轮新增的脉络项 id */
  classroomFlowNewIds?: Set<string>;
  /** 模型正在理解最近一段 */
  isUnderstandingClassroomFlow?: boolean;
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
  /** 课中拍照：传入当前录音秒数，由父组件透传到 handleImportFiles */
  onQuickPhoto?: (capturedAtMs: number) => void;
  /** 是否启用说话人分离（多人会议模式） */
  speakerDiarization?: boolean;
  /** 切换说话人分离 */
  onToggleSpeakerDiarization?: () => void;
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
  onCycleTranslationMode,
  onStop,
  isDemoPlayback,
  demoAudioPlaying,
  demoAudioNeedsGesture,
  onToggleDemoAudio,
  speakerDiarization,
  onToggleSpeakerDiarization,
}: {
  segments?: TranscriptSegment[];
  recentLines: Array<{ id: string; text: string; startMs: number }>;
  interimText?: string;
  translationMode: TranslationMode;
  seconds: number;
  onCycleTranslationMode: () => void;
  onStop: () => void;
  isDemoPlayback?: boolean;
  demoAudioPlaying?: boolean;
  demoAudioNeedsGesture?: boolean;
  onToggleDemoAudio?: () => void;
  speakerDiarization?: boolean;
  onToggleSpeakerDiarization?: () => void;
}) {
  const rows = useMemo(
    () => buildLiveTranslationRows({ segments, recentLines, interimText, maxFinalRows: 9999 }),
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
        speakerId: row.speakerId,
      };
    });
    return stitchLiveSentences(inputs);
  }, [rows, termsByRow, translateEnabled, lookup]);
  const stableSentenceCount = stitchedSentences.filter((s) => !s.isInterim).length;

  const isNearBottomRef = useRef(true);

  const updateJumpVisibility = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance <= 96;
    isNearBottomRef.current = nearBottom;
    setShowJumpToBottom(distance > 96);
  }, []);

  const jumpToBottom = useCallback(() => {
    isNearBottomRef.current = true;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    setShowJumpToBottom(false);
  }, []);

  useEffect(() => {
    updateJumpVisibility();
  }, [rows.length, updateJumpVisibility]);

  // 自动跟随：新内容到来时，如果用户在底部附近（没主动上滚），自动滚到底部。
  // 用 ref 判断（实时），不依赖 state 的异步更新——避免滚动滞后。
  useEffect(() => {
    if (!isNearBottomRef.current) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [rows.length]);

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
                className="h-full rounded-full bg-pine transition-all"
                style={{ width: `${Math.min(100, Math.max(6, seconds / 90))}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 rounded-full border border-divider bg-card px-2 py-1.5">
          <span className="px-3 py-1 text-[12px] font-medium text-ink">实时文字</span>
          <div className="flex items-center gap-1.5">
            {onToggleSpeakerDiarization ? (
              <button
                type="button"
                onClick={onToggleSpeakerDiarization}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                  speakerDiarization ? 'bg-pine text-white shadow-soft' : 'text-ink-muted hover:bg-paper-warm'
                }`}
                title={speakerDiarization ? '说话人分离已开启，点击切回单人模式' : '开启多人说话人分离（实时切换）'}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${speakerDiarization ? 'bg-white' : 'bg-ink-muted'}`} />
                <span>{speakerDiarization ? '多人' : '单人'}</span>
              </button>
            ) : null}
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
            className="space-y-1.5 leading-[1.8] text-[15px]"
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
                    className="mr-1.5 inline-block align-baseline font-mono text-[11.5px] tabular-nums text-ink-muted/55"
                    style={{ verticalAlign: '0.05em' }}
                  >
                    {formatTime(Math.floor(sentence.startMs / 1000))}
                  </span>
                  {sentence.speakerId && speakerDiarization ? (
                    <span
                      className={`mr-1.5 inline-block align-baseline text-[11.5px] font-medium ${getSpeakerColorClass(sentence.speakerId)}`}
                      style={{ verticalAlign: '0.05em' }}
                    >
                      {getSpeakerLabel(sentence.speakerId)}
                    </span>
                  ) : null}
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

    </aside>
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

// ── 移动端：拍一下悬浮键 ────────────────────────────────────────────

function QuickPhotoButton({ onPhoto }: { onPhoto: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="fixed bottom-[5.5rem] left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-vermilion text-white shadow-card transition active:scale-90 lg:hidden"
        aria-label="拍一下"
        title="拍下板书"
      >
        <Camera size={18} strokeWidth={2} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            onPhoto();
          }
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </>
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

const EMPTY_FLOW: ClassroomFlowState = { title: '', now: null, recent: [], keep: [], updatedAtMs: 0 };
const EMPTY_NEW_IDS: Set<string> = new Set();

export function ClassroomRecordingView({
  seconds,
  onStop,
  segments,
  interimText,
  recentLines = [],
  classroomFlow = EMPTY_FLOW,
  classroomFlowNewIds = EMPTY_NEW_IDS,
  isUnderstandingClassroomFlow = false,
  isDemoPlayback = false,
  demoAudioPlaying = false,
  demoAudioNeedsGesture = false,
  onToggleDemoAudio,
  defaultTranslationMode,
  isDemoComplete = false,
  onReplayDemo,
  onFinishDemo,
  onQuickPhoto,
  speakerDiarization,
  onToggleSpeakerDiarization,
}: ClassroomRecordingViewProps) {
  const [mobilePane, setMobilePane] = useState<'flow' | 'transcript'>('flow');

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
        <div className="mb-2 flex rounded-full border border-divider bg-card p-1 lg:hidden">
          {(['flow', 'transcript'] as const).map((pane) => (
            <button
              key={pane}
              type="button"
              onClick={() => setMobilePane(pane)}
              className={`flex-1 rounded-full px-3 py-2 text-[12.5px] font-medium transition ${
                mobilePane === pane ? 'bg-ink text-white' : 'text-ink-muted'
              }`}
            >
              {pane === 'flow' ? COPY.classroomFlow.mobileFlow : COPY.classroomFlow.mobileTranscript}
            </button>
          ))}
        </div>
        <div className="grid h-full w-full grid-cols-1 gap-3 lg:grid-cols-[minmax(390px,0.82fr)_minmax(0,1.18fr)] xl:grid-cols-[minmax(420px,0.78fr)_minmax(0,1.22fr)]">
          <div className={`${mobilePane === 'transcript' ? 'block' : 'hidden'} min-h-0 lg:block`}>
            <LiveTranscriptPanel
              segments={segments}
              recentLines={recentLines}
              interimText={interimText}
              translationMode={translationMode}
              seconds={seconds}
              onCycleTranslationMode={cycleTranslationModeHandler}
              onStop={onStop}
              isDemoPlayback={isDemoPlayback}
              demoAudioPlaying={demoAudioPlaying}
              demoAudioNeedsGesture={demoAudioNeedsGesture}
              onToggleDemoAudio={onToggleDemoAudio}
              speakerDiarization={speakerDiarization}
              onToggleSpeakerDiarization={onToggleSpeakerDiarization}
            />
          </div>
          <div className={`${mobilePane === 'flow' ? 'block' : 'hidden'} min-w-0 overflow-hidden rounded-[24px] border border-divider bg-white lg:block`}>
            {isDemoComplete ? (
              <DemoAfterClassPanel onFinish={onFinishDemo} onReplay={onReplayDemo} />
            ) : (
              <ClassroomFlowCanvas
                flow={classroomFlow}
                newItemIds={classroomFlowNewIds}
                elapsedMs={seconds * 1000}
                isUnderstanding={isUnderstandingClassroomFlow}
              />
            )}
          </div>
        </div>
      </div>

      {/* 移动端：拍一下悬浮键 */}
      {onQuickPhoto && (
        <QuickPhotoButton onPhoto={() => onQuickPhoto(seconds * 1000)} />
      )}

      <StopBar onStop={onStop} />
    </div>
  );
}

export default ClassroomRecordingView;
