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
import { Square, Languages, Play, Pause, Camera, ChevronLeft, VolumeX, Mic, Monitor } from 'lucide-react';
import { ClassroomFlowCanvas } from './ClassroomFlowCanvas';
import { OctoBuddySprite } from './OctoBuddy';
import type { ClassroomFlowState } from '@/types/classroom-flow';

import type { TranscriptSegment } from '@/types';
import { extractChineseRuns, extractEnglishRuns } from '@/lib/services/translation/extract-english';
import { useEnToZhTranslation, useTranslationMode, type TranslationMode } from '@/hooks/useEnToZhTranslation';
import { buildLiveTranslationRows } from '@/lib/utils/live-translation-rows';
import { stitchLiveSentences } from '@/lib/utils/stitch-live-sentences';
import { cycleTranslationMode, resolveSessionTranslationMode } from './ClassroomRecordingView.model';
import { COPY } from '@/lib/ui/copy';
import { useLiveAsrLink, type RecorderAudioSource } from '@/stores/capture-editor-store';

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
  /** 返回课程列表（录课入口页）；录音中的课由列表顶部的活动条承接，可以随时回来 */
  onBack?: () => void;
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
  demoAudioMuted?: boolean;
  demoAudioNeedsGesture?: boolean;
  onToggleDemoAudio?: () => void;
  /** 录音来源（真实录课时显示在 LIVE 旁；试听课不显示） */
  audioSource?: RecorderAudioSource;
  /** 英文试听课默认开启 EN→中，但不写入用户长期偏好 */
  defaultTranslationMode?: TranslationMode;
  /** 试听课听完后的课后引导 */
  isDemoComplete?: boolean;
  onReplayDemo?: () => void;
  onFinishDemo?: () => void;
  /** 课中拍照：传入当前录音秒数，由父组件透传到 handleImportFiles */
  onQuickPhoto?: (capturedAtMs: number) => void;
  /** 课中「截取这一页」：屏幕流帧源存在时由父组件传入；按下 = 主动把当前页挂上时间轴 */
  onCaptureFrame?: (capturedAtMs: number) => void;
}

// ── 时间工具 ──────────────────────────────────────────────────────────

function audioSourceLabel(source: RecorderAudioSource): string {
  if (source === 'system') return COPY.recording.sourceSystem;
  if (source === 'mixed') return COPY.recording.sourceMixed;
  return COPY.recording.sourceMic;
}

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
  onBack,
  isDemoPlayback,
  demoAudioPlaying,
  demoAudioMuted = false,
  demoAudioNeedsGesture,
  onToggleDemoAudio,
  listening = true,
  audioSource,
}: {
  segments?: TranscriptSegment[];
  recentLines: Array<{ id: string; text: string; startMs: number }>;
  interimText?: string;
  translationMode: TranslationMode;
  seconds: number;
  onCycleTranslationMode: () => void;
  onStop: () => void;
  onBack?: () => void;
  isDemoPlayback?: boolean;
  demoAudioPlaying?: boolean;
  /** 静音自动播放中（出声被浏览器拦截）：按钮变成「打开声音」 */
  demoAudioMuted?: boolean;
  demoAudioNeedsGesture?: boolean;
  onToggleDemoAudio?: () => void;
  /** 仍在听课 → 头部呼吸球仪式；停止 / 试听结束即消散 */
  listening?: boolean;
  audioSource?: RecorderAudioSource;
}) {
  const rows = useMemo(
    () => buildLiveTranslationRows({ segments, recentLines, interimText, maxFinalRows: 9999 }),
    [segments, recentLines, interimText],
  );
  const translateEnabled = translationMode !== 'off';
  const hasDraftRow = rows.some((row) => row.id === 'live-interim');
  // 实时字幕链路：断了在重连 / 本节课不会再有实时字幕 → 占用这一行状态，恢复后自动回到正常状态字。
  // 试听课没有 ASR 链路，不看这个。
  const liveAsrLink = useLiveAsrLink();
  const liveCaptionsNotice = !isDemoPlayback && listening
    ? (liveAsrLink === 'reconnecting'
        ? COPY.recording.liveCaptionsReconnecting
        : liveAsrLink === 'offline'
          ? COPY.recording.liveCaptionsOffline
          : null)
    : null;
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

  // 自动跟随的判定只来自用户的滚动（onScroll），不在内容变化后再量——
  // 此前在新行渲染后才量"离底部多远"，一句带翻译的新行就超过 96px，被误判成"用户上滚了"，
  // 自动跟随从此永远失效（实测示例课 30 秒后转录卡停在开头，露着「回到底部」）。
  const isNearBottomRef = useRef(true);
  const programmaticScrollUntilRef = useRef(0);

  const handleListScroll = useCallback(() => {
    if (Date.now() < programmaticScrollUntilRef.current) return; // 自己滚出来的事件不算用户意图
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance <= 96;
    isNearBottomRef.current = nearBottom;
    setShowJumpToBottom(!nearBottom);
  }, []);

  const jumpToBottom = useCallback(() => {
    isNearBottomRef.current = true;
    programmaticScrollUntilRef.current = Date.now() + 600;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    setShowJumpToBottom(false);
  }, []);

  // 新内容（新句子或正在说的半句变长）到来：用户没上滚就贴住底部；上滚了就露「回到底部」
  const contentKey = `${rows.length}:${stitchedSentences.reduce((n, sentence) => n + sentence.text.length, 0)}`;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (isNearBottomRef.current) {
      programmaticScrollUntilRef.current = Date.now() + 200;
      el.scrollTop = el.scrollHeight;
      setShowJumpToBottom(false);
    } else if (el.scrollHeight - el.clientHeight > 8) {
      setShowJumpToBottom(true);
    }
  }, [contentKey]);

  return (
    <aside className="relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[22px] border border-divider bg-card shadow-soft">
      <style jsx>{`
        /* 仪式时刻白名单 #1：录音中的呼吸球（转录卡头部 32px 微型版，参考 ui/RecordingHero）
           —— 听课中存在，停止即消散（listening=false 不渲染 halo） */
        .rec-orb-halo-outer {
          background: radial-gradient(circle, rgba(196, 94, 76, 0.22) 0%, transparent 62%);
          animation: rec-orb-breath 2.6s ease-in-out infinite;
        }
        .rec-orb-halo-inner {
          background: radial-gradient(circle, rgba(47, 107, 85, 0.2) 0%, transparent 66%);
          animation: rec-orb-breath 3.4s ease-in-out infinite reverse;
        }
        @keyframes rec-orb-breath {
          0%, 100% { opacity: 0.55; transform: scale(0.94); }
          50%      { opacity: 1;    transform: scale(1.08); }
        }
      `}</style>
      <div className="flex-shrink-0 border-b border-divider bg-paper-warm px-3.5 py-3">
        <div className="rounded-[18px] border border-pine/15 bg-card px-3.5 py-3 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="-ml-1.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-paper-warm hover:text-ink active:scale-95"
                  title={COPY.recording.backToLessons}
                  aria-label={COPY.recording.backToLessons}
                >
                  <ChevronLeft size={16} strokeWidth={2} />
                </button>
              ) : null}
              {listening ? (
                <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center" aria-hidden>
                  <span className="rec-orb-halo-outer absolute inset-0 rounded-full" />
                  <span className="rec-orb-halo-inner absolute inset-1.5 rounded-full" />
                  <span className="relative h-2 w-2 rounded-full bg-pine" />
                </span>
              ) : (
                <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center" aria-hidden>
                  <span className="h-2 w-2 rounded-full bg-ink-muted/45" />
                </span>
              )}
              {/* 一行状态：LIVE 徽标 + 正在听 / 已记 N 句 / 等老师开口。
                  此前是两行（"课堂文字" + 状态），窄栏里标题被截成"课堂…"、LIVE 逐字换行——标签本身也和下面的"实时文字"重复 */}
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-pine/85">
                  {COPY.recording.liveBadge}
                </span>
                {/* 录音来源可见：麦克风 / 电脑声音 / 两路——录到一半才发现录的是空气，是最贵的一种错 */}
                {!isDemoPlayback && audioSource ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 text-ink-muted"
                    title={COPY.recording.sourceListening(audioSourceLabel(audioSource))}
                    aria-label={COPY.recording.sourceListening(audioSourceLabel(audioSource))}
                  >
                    {audioSource === 'system' ? <Monitor size={11} strokeWidth={2} /> : <Mic size={11} strokeWidth={2} />}
                    {audioSource === 'mixed' ? <Monitor size={11} strokeWidth={2} /> : null}
                  </span>
                ) : null}
                <p className="truncate text-[12.5px] text-ink-secondary" data-testid="live-status-line">
                  {liveCaptionsNotice ? (
                    <span data-testid="live-captions-notice">{liveCaptionsNotice}</span>
                  ) : hasDraftRow ? (
                    <span className="text-pine/85">{COPY.recording.listeningSentence}</span>
                  ) : stableSentenceCount > 0 ? (
                    <span className="tabular-nums">{COPY.recording.recordedSentences(stableSentenceCount)}</span>
                  ) : (
                    <span>{COPY.recording.waitingTeacher}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {isDemoPlayback && onToggleDemoAudio ? (
                <button
                  type="button"
                  onClick={onToggleDemoAudio}
                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full text-[12px] font-medium transition active:scale-95 ${
                    demoAudioNeedsGesture && (!demoAudioPlaying || demoAudioMuted) ? 'px-3' : 'w-9'
                  } ${
                    demoAudioPlaying && !demoAudioMuted
                      ? 'bg-paper-warm text-ink-secondary hover:text-ink'
                      : 'bg-ink text-white shadow-soft hover:opacity-90'
                  }`}
                  title={demoAudioMuted ? COPY.recording.demoUnmute : demoAudioPlaying ? COPY.recording.demoPause : COPY.recording.demoPlay}
                  aria-label={demoAudioMuted ? COPY.recording.demoUnmute : demoAudioPlaying ? COPY.recording.demoPause : COPY.recording.demoPlay}
                >
                  {demoAudioMuted
                    ? <VolumeX size={12} strokeWidth={2} />
                    : demoAudioPlaying
                      ? <Pause size={12} strokeWidth={2} />
                      : <Play size={12} strokeWidth={2} fill="currentColor" />}
                  {/* 窄栏里只在"需要手势才能出声"时露文字（没播起来 / 静音在播），其余时候图标即可——把宽度让给左边的状态 */}
                  {demoAudioNeedsGesture && !demoAudioPlaying ? <span>{COPY.recording.demoPlayNeedsGesture}</span> : null}
                  {demoAudioMuted ? <span>{COPY.recording.demoUnmute}</span> : null}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onStop}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white shadow-soft transition hover:opacity-90 active:scale-95"
                title={COPY.recording.endLesson}
                aria-label={COPY.recording.endLesson}
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
        onScroll={handleListScroll}
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
                    className="cite-ts mr-1.5 cursor-default"
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
      <style jsx>{`
        /* 仪式时刻白名单 #3：生成完成的柔光扫过（一次，<1.6s，不循环） */
        .afterclass-sweep {
          background: linear-gradient(
            110deg,
            transparent 20%,
            rgba(47, 107, 85, 0.1) 45%,
            rgba(196, 94, 76, 0.08) 55%,
            transparent 80%
          );
          background-size: 220% 100%;
          animation: afterclass-sweep 1.5s ease-out 1 both;
        }
        @keyframes afterclass-sweep {
          from { background-position: 200% 0; opacity: 1; }
          to   { background-position: -100% 0; opacity: 0; }
        }
      `}</style>
      {/* 收尾卡：纸感 + pine ring——像合上一本笔记 */}
      <div className="relative overflow-hidden rounded-[24px] border border-pine/15 bg-card px-5 py-5 shadow-card">
        <span aria-hidden className="afterclass-sweep pointer-events-none absolute inset-0" />
        <div className="relative flex items-start gap-4">
          <OctoBuddySprite mood="happy" size="lg" className="-ml-2 -mt-3 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-pine">{COPY.recording.afterClass.eyebrow}</p>
            <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.04em] text-ink">
              {COPY.recording.afterClass.title}
            </h2>
            <p className="mt-3 max-w-[28rem] text-[13px] leading-[1.75] text-ink-secondary">
              {COPY.recording.afterClass.body}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <button
          type="button"
          onClick={onFinish}
          className="rounded-[20px] border border-pine bg-pine px-5 py-4 text-left text-white shadow-soft transition hover:bg-pine-deep active:scale-[0.99]"
        >
          <p className="text-[15px] font-semibold tracking-[-0.02em]">{COPY.recording.afterClass.finish}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/70">{COPY.recording.afterClass.finishHint}</p>
        </button>
        <button
          type="button"
          onClick={onReplay}
          className="rounded-[20px] border border-divider bg-card px-4 py-4 text-left text-[13px] font-medium text-ink-secondary transition hover:border-ink-muted hover:text-ink"
        >
          {COPY.recording.afterClass.replay}
        </button>
      </div>
    </div>
  );
}

// ── 移动端：拍一下悬浮键 ────────────────────────────────────────────

/** 桌面端「截取这一页」悬浮键：屏幕流帧源存在时才出现（网课场景） */
function CaptureFrameButton({ onCapture }: { onCapture: () => void }) {
  return (
    <button
      type="button"
      onClick={onCapture}
      className="fixed bottom-[5.5rem] left-4 z-30 hidden h-12 items-center gap-2 rounded-full bg-pine px-4 text-white shadow-card transition hover:opacity-90 active:scale-95 lg:flex"
      aria-label={COPY.recording.captureFrame}
      title={COPY.recording.captureFrame}
    >
      <Camera size={17} strokeWidth={2} />
      <span className="text-sm">{COPY.recording.captureFrame}</span>
    </button>
  );
}

function QuickPhotoButton({ onPhoto }: { onPhoto: () => void }) {  const inputRef = useRef<HTMLInputElement | null>(null);
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
          className="group flex w-full items-center justify-center gap-2.5 rounded-full bg-ink py-3.5 text-[13.5px] font-medium text-white transition hover:bg-pine-deep active:scale-[0.995]"
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
  onBack,
  segments,
  interimText,
  recentLines = [],
  classroomFlow = EMPTY_FLOW,
  classroomFlowNewIds = EMPTY_NEW_IDS,
  isUnderstandingClassroomFlow = false,
  isDemoPlayback = false,
  demoAudioPlaying = false,
  demoAudioMuted = false,
  demoAudioNeedsGesture = false,
  onToggleDemoAudio,
  audioSource,
  defaultTranslationMode,
  isDemoComplete = false,
  onReplayDemo,
  onFinishDemo,
  onQuickPhoto,
  onCaptureFrame,
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
        <div className="mb-2 flex rounded-full border border-divider bg-card p-1 xl:hidden">
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
        <div className="grid h-full w-full grid-cols-1 gap-3 xl:grid-cols-[minmax(340px,0.75fr)_minmax(380px,1.25fr)]">
          <div className={`${mobilePane === 'transcript' ? 'block' : 'hidden'} min-h-0 xl:block`}>
            <LiveTranscriptPanel
              segments={segments}
              recentLines={recentLines}
              interimText={interimText}
              translationMode={translationMode}
              seconds={seconds}
              onCycleTranslationMode={cycleTranslationModeHandler}
              onStop={onStop}
              onBack={onBack}
              isDemoPlayback={isDemoPlayback}
              demoAudioPlaying={demoAudioPlaying}
              demoAudioMuted={demoAudioMuted}
              demoAudioNeedsGesture={demoAudioNeedsGesture}
              onToggleDemoAudio={onToggleDemoAudio}
              listening={!isDemoComplete}
              audioSource={audioSource}
            />
          </div>
          <div className={`${mobilePane === 'flow' ? 'block' : 'hidden'} min-w-0 overflow-hidden rounded-[24px] border border-divider bg-white xl:block`}>
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

      {/* 桌面端：截取这一页（屏幕流帧源存在时才露出——主动意图锚点） */}
      {onCaptureFrame && (
        <CaptureFrameButton onCapture={() => onCaptureFrame(seconds * 1000)} />
      )}

      <StopBar onStop={onStop} />
    </div>
  );
}

export default ClassroomRecordingView;
