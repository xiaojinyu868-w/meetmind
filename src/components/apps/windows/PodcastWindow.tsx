'use client';

/**
 * PodcastWindow — 课堂播客窗口。
 *
 * 一个主角：播放条。下面是"边听边看"的脚本——像播客 App 的逐字稿，不是一列圆角卡片：
 * 说话人是左侧一枚小字标签，正在播的那句加一道朱批竖线、字变墨色，点任意一句跳到那里。
 * 章节只是一份安静的目录（标题 + 一句摘要），点一章按比例跳到那附近。
 *
 * 2026-09-09：去掉「回到课堂片段」与 EvidenceChip——播客的时间轴是播客自己的，
 * 章节引用的课堂时间戳与音频位置根本不对应；"回到老师原话"也不该是一个播客窗口的视觉主角。
 *
 * 2026-09-10 交互打磨：
 * - 逐字稿自动跟随；用户自己滚动（wheel / touch）后停止跟随，出现「回到当前」一枚，点它或当前句自己回到
 *   视口中段时恢复——此前 scrollIntoView 会把用户正在读的地方抢回去；
 * - 当前句左侧那道朱批竖线是一条会滑动的指示条（top / height 240ms 过渡），不是每句各画一道；
 * - 播放条 scrub / 键盘见 PodcastPlayerBar；快捷键提示只在第一次进入出现一次。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PodcastPlayerBar } from './PodcastPlayerBar';
import { toast } from 'sonner';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { RefreshCw, Loader2, ArrowDown } from 'lucide-react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { splitPodcastSections } from './podcast-window-model';
import { lineIndexForTime, shouldResumeFollow, timeForLine } from './podcast-player-model';
import { useKeyboardHintOnce } from './keyboard-hints';
import { prefersReducedMotion } from './app-motion';

interface PodcastWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  taskState?: AppTaskState;
  onSeek?: (startMs: number) => void;
  onRegenerate?: () => void;
}

interface PodcastSection {
  id?: string;
  title?: string;
  body?: string;
}

interface PodcastPayload {
  audioUrl?: string;
  error?: string;
  sections?: PodcastSection[];
  lines?: Array<{ speaker?: string; line?: string }>;
}

const TIMESTAMP_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const CHINESE_TIME_PATTERN = /\d+点\d+分(?:\d+秒)?|\d+分\d+秒/g;
const SPEAKER_ID_PATTERN = /^(zh[_-].+|voice[_-].+|.+bigtts.*)$/i;

function sanitizeNarration(text: string): string {
  return text
    .replace(TIMESTAMP_PATTERN, ' ')
    .replace(CHINESE_TIME_PATTERN, ' ')
    .replace(/\b(startMs|endMs)\s*=\s*\d+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSpeaker(raw: string | undefined, index: number, mapping: Map<string, string>): string {
  const speaker = (raw || '').trim();
  const copy = APPS_COPY.podcast;
  if (!speaker) return index % 2 === 0 ? copy.hostA : copy.hostB;
  if (mapping.has(speaker)) return mapping.get(speaker) as string;
  if (SPEAKER_ID_PATTERN.test(speaker)) {
    const alias = mapping.size % 2 === 0 ? copy.hostA : copy.hostB;
    mapping.set(speaker, alias);
    return alias;
  }
  return speaker;
}

/** 找到包着逐字稿的那个滚动容器（宿主的 overflow-auto） */
function scrollParentOf(node: HTMLElement | null): HTMLElement | null {
  let cursor = node?.parentElement ?? null;
  while (cursor) {
    const overflowY = window.getComputedStyle(cursor).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && cursor.scrollHeight > cursor.clientHeight) return cursor;
    cursor = cursor.parentElement;
  }
  return null;
}

export function PodcastWindow({ result, transcript, taskState, onRegenerate }: PodcastWindowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const scriptContainerRef = useRef<HTMLDivElement>(null);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [following, setFollowing] = useState(true);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const programmaticScrollUntil = useRef(0);
  const showKeyboardHint = useKeyboardHintOnce('podcast');
  const payload = (result?.render?.payload || {}) as PodcastPayload;
  const isRegenerating = taskState?.status === 'running';
  const { overview, chapters } = useMemo(
    () => splitPodcastSections(Array.isArray(payload.sections) ? payload.sections : []),
    [payload.sections],
  );
  const overviewText = sanitizeNarration(overview?.body || '');

  const scriptLines = useMemo(() => {
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    const speakerMap = new Map<string, string>();
    return lines
      .map((line, index) => ({
        speaker: normalizeSpeaker(line.speaker, index, speakerMap),
        line: sanitizeNarration(line.line || ''),
      }))
      .filter((line) => line.line);
  }, [payload.lines]);

  /** 两位主持人各自一个稳定的字母，做左侧的说话人标签 */
  const speakerInitials = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of scriptLines) {
      if (!map.has(line.speaker)) map.set(line.speaker, String.fromCharCode(65 + (map.size % 26)));
    }
    return map;
  }, [scriptLines]);

  const scriptPlainText = useMemo(
    () => scriptLines.map((line) => `${line.speaker}：${line.line}`).join('\n\n'),
    [scriptLines]
  );

  const scrollToLine = useCallback((lineIndex: number, behavior: ScrollBehavior = 'smooth') => {
    const lineEl = scriptContainerRef.current?.querySelector<HTMLElement>(`[data-line-index="${lineIndex}"]`);
    if (!lineEl) return;
    programmaticScrollUntil.current = performance.now() + 700;
    lineEl.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : behavior, block: 'center' });
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || scriptLines.length === 0) return;
    const lineIndex = lineIndexForTime(audio.currentTime, audio.duration || 1, scriptLines.length);
    if (lineIndex !== activeLineIndex && lineIndex >= 0) {
      setActiveLineIndex(lineIndex);
      if (following) scrollToLine(lineIndex);
    }
  }, [activeLineIndex, following, scriptLines.length, scrollToLine]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
    };
  }, [handleTimeUpdate]);

  // 用户自己滚动 → 停止跟随；当前句回到视口中段 → 恢复
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const parent = scrollParentOf(root);
    const onUserScroll = () => {
      if (performance.now() < programmaticScrollUntil.current) return;
      setFollowing(false);
    };
    const onScroll = () => {
      if (!parent || following) return;
      const lineEl = scriptContainerRef.current?.querySelector<HTMLElement>(`[data-line-index="${activeLineIndex}"]`);
      if (!lineEl) return;
      const parentRect = parent.getBoundingClientRect();
      const lineRect = lineEl.getBoundingClientRect();
      if (shouldResumeFollow(lineRect.top - parentRect.top + parent.scrollTop + lineRect.height / 2, parent.scrollTop, parent.clientHeight)) setFollowing(true);
    };
    root.addEventListener('wheel', onUserScroll, { passive: true });
    root.addEventListener('touchmove', onUserScroll, { passive: true });
    parent?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('wheel', onUserScroll);
      root.removeEventListener('touchmove', onUserScroll);
      parent?.removeEventListener('scroll', onScroll);
    };
  }, [activeLineIndex, following]);

  // 当前句的朱批指示条：量当前句的位置，让它滑过去而不是每句各画一道
  useLayoutEffect(() => {
    const container = scriptContainerRef.current;
    if (!container || activeLineIndex < 0) { setIndicator(null); return; }
    const lineEl = container.querySelector<HTMLElement>(`[data-line-index="${activeLineIndex}"]`);
    if (!lineEl) { setIndicator(null); return; }
    setIndicator({ top: lineEl.offsetTop, height: lineEl.offsetHeight });
  }, [activeLineIndex, scriptLines.length]);

  const copyScript = useCallback(async () => {
    if (!scriptPlainText) return;
    try {
      await navigator.clipboard.writeText(scriptPlainText);
      toast.success(APPS_COPY.podcast.scriptCopied);
    } catch {
      toast.error(APPS_COPY.podcast.copyFailed);
    }
  }, [scriptPlainText]);

  if (!result) {
    if (taskState?.status === 'error') {
      return (
        <AppWindowPlaceholder
          status="error"
          appName={APPS_COPY.podcast.appName}
          errorMessage={taskState.error}
          onRetry={onRegenerate}
        />
      );
    }
    if (taskState?.status === 'idle') {
      return (
        <AppWindowPlaceholder
          status="empty"
          appName={APPS_COPY.podcast.appName}
          description={APPS_COPY.podcast.emptyBody}
          onRetry={onRegenerate}
        />
      );
    }
    return <AppWindowPlaceholder status="loading" appName={APPS_COPY.podcast.appName} transcript={transcript} />;
  }

  const seekToLine = (lineIndex: number) => {
    const audio = audioRef.current;
    if (!audio || scriptLines.length === 0) return;
    audio.currentTime = timeForLine(lineIndex, audio.duration || 1, scriptLines.length);
    setFollowing(true);
    void audio.play().catch(() => undefined);
  };
  /** 章节没有逐句时间戳：按章节序号比例跳到那附近（诚实的近似） */
  const seekToChapter = (chapterIndex: number) => {
    const audio = audioRef.current;
    if (!audio || chapters.length === 0) return;
    audio.currentTime = timeForLine(chapterIndex, audio.duration || 1, chapters.length);
    setFollowing(true);
    void audio.play().catch(() => undefined);
  };
  const backToCurrent = () => {
    setFollowing(true);
    if (activeLineIndex >= 0) scrollToLine(activeLineIndex);
  };

  const hasAudio = Boolean(payload.audioUrl);

  return (
    <section ref={rootRef} className="relative mx-auto flex max-w-2xl flex-col gap-6" data-testid="podcast-window">
      {hasAudio ? (
        <PodcastPlayerBar ref={audioRef} src={payload.audioUrl as string} title={result?.render?.title || undefined} />
      ) : (
        /* 音频未就绪（如火山 403）：播放条形态的重试条，点整条重新生成；成功后同位置直接变成播放条 */
        <button
          type="button"
          onClick={onRegenerate}
          disabled={!onRegenerate || isRegenerating}
          className="mm-press flex w-full items-center gap-3.5 rounded-[18px] border border-divider bg-paper-warm px-3.5 py-3 text-left hover:bg-paper-deep disabled:cursor-default disabled:opacity-70"
          aria-label={isRegenerating ? APPS_COPY.podcast.audioGenerating : APPS_COPY.podcast.audioRetry}
        >
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-ink text-white">
            {isRegenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-ink">
              {isRegenerating ? APPS_COPY.podcast.audioGenerating : APPS_COPY.podcast.audioRetry}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
              {isRegenerating
                ? APPS_COPY.podcast.audioGeneratingHint
                : scriptLines.length > 0
                  ? APPS_COPY.podcast.audioRetryHint
                  : APPS_COPY.podcast.audioRetryNoScriptHint}
            </span>
          </span>
        </button>
      )}
      {hasAudio && showKeyboardHint ? (
        <p className="-mt-4 px-1 text-[11.5px] text-ink-muted/70">{APPS_COPY.podcast.keyboardHint}</p>
      ) : null}

      {/* 开场简介：这期播客讲什么，一段话，放在播放条正下方 */}
      {overviewText ? <p className="text-[13px] leading-6 text-ink-secondary">{overviewText}</p> : null}

      {chapters.length > 0 ? (
        <nav aria-label={APPS_COPY.podcast.chapters}>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">{APPS_COPY.podcast.chapters}</p>
          <ol className="mt-2 divide-y divide-divider">
            {chapters.map((section, index) => (
              <li key={section.id || `section-${index}`}>
                <button
                  type="button"
                  onClick={() => seekToChapter(index)}
                  disabled={!hasAudio}
                  className="mm-hover-warm mm-focus-inset -mx-2 flex w-[calc(100%+1rem)] gap-3 rounded-lg px-2 py-2.5 text-left disabled:cursor-default"
                  title={hasAudio ? APPS_COPY.podcast.chapterSeekHint : undefined}
                >
                  <span className="w-5 shrink-0 pt-px font-mono text-[11px] tabular-nums text-ink-muted">{String(index + 1).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-5 text-ink">{section.title || APPS_COPY.podcast.chapter(index + 1)}</span>
                    {sanitizeNarration(section.body || '') ? (
                      <span className="mt-0.5 block text-[12px] leading-5 text-ink-muted">{sanitizeNarration(section.body || '')}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      {scriptLines.length > 0 ? (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">{APPS_COPY.podcast.script}</p>
            <button type="button" onClick={copyScript} className="mm-focus rounded text-[12px] text-ink-muted transition hover:text-ink">
              {APPS_COPY.podcast.copyScript}
            </button>
          </div>
          {/* 逐字稿：说话人字母在左栏，正文在右；正在播的一句由一条会滑动的朱批竖线标出、字变墨色。点任意一句跳到那里。 */}
          <div ref={scriptContainerRef} className="relative mt-3 flex flex-col">
            {indicator ? (
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 w-[2px] rounded-full bg-vermilion motion-reduce:transition-none"
                style={{ top: indicator.top, height: indicator.height, transition: 'top 240ms cubic-bezier(0.2, 0.8, 0.2, 1), height 240ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
              />
            ) : null}
            {scriptLines.map((line, index) => {
              const isActive = index === activeLineIndex;
              const initial = speakerInitials.get(line.speaker) || 'A';
              return (
                <button
                  key={`line-${index}`}
                  type="button"
                  data-line-index={index}
                  onClick={() => seekToLine(index)}
                  disabled={!hasAudio}
                  title={line.speaker}
                  className="group mm-focus-inset grid grid-cols-[28px_1fr] gap-x-3 rounded-r-md border-l-2 border-transparent py-2 pl-3 text-left transition-colors disabled:cursor-default [@media(hover:hover)]:hover:border-divider"
                >
                  <span
                    className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors duration-200 ${
                      isActive
                        ? 'bg-ink text-white'
                        : initial === 'A'
                          ? 'bg-pine-mist text-pine'
                          : 'bg-vermilion-fog text-vermilion-deep'
                    }`}
                    aria-hidden
                  >
                    {initial}
                  </span>
                  <p className={`text-[14px] leading-7 transition-colors duration-200 ${isActive ? 'text-ink' : 'text-ink-secondary group-hover:text-ink'}`}>
                    {line.line}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 用户自己滚开后：一枚「回到当前」浮在底部，点它回到正在播的那句 */}
      {hasAudio && playing && !following && activeLineIndex >= 0 ? (
        <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
          <button
            type="button"
            onClick={backToCurrent}
            className="mm-pop-in mm-press mm-focus pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12px] font-medium text-white shadow-float"
          >
            <ArrowDown size={13} strokeWidth={2} aria-hidden />
            {APPS_COPY.podcast.backToCurrent}
          </button>
        </div>
      ) : null}
    </section>
  );
}
