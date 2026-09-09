'use client';

/**
 * PodcastWindow — 课堂播客窗口。
 *
 * 一个主角：播放条。下面是"边听边看"的脚本——像播客 App 的逐字稿，不是一列圆角卡片：
 * 说话人是左侧一枚小字标签，正在播的那句加一道朱批竖线、字变墨色，点任意一句跳到那里。
 * 章节只是一份安静的目录（标题 + 一句摘要）。
 *
 * 2026-09-09：去掉「回到课堂片段」与 EvidenceChip——播客的时间轴是播客自己的，
 * 章节引用的课堂时间戳与音频位置根本不对应；"回到老师原话"也不该是一个播客窗口的视觉主角。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PodcastPlayerBar } from './PodcastPlayerBar';
import { toast } from 'sonner';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { RefreshCw, Loader2 } from 'lucide-react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { splitPodcastSections } from './podcast-window-model';

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

export function PodcastWindow({ result, transcript, taskState, onRegenerate }: PodcastWindowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scriptContainerRef = useRef<HTMLDivElement>(null);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
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

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    const currentTime = audioRef.current.currentTime;

    if (scriptLines.length === 0) return;
    const duration = audioRef.current.duration || 1;
    const lineIndex = Math.min(Math.floor((currentTime / duration) * scriptLines.length), scriptLines.length - 1);

    if (lineIndex !== activeLineIndex && lineIndex >= 0) {
      setActiveLineIndex(lineIndex);
      const lineEl = scriptContainerRef.current?.querySelector(`[data-line-index="${lineIndex}"]`);
      lineEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLineIndex, scriptLines.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [handleTimeUpdate]);

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
    if (!audioRef.current || scriptLines.length === 0) return;
    const duration = audioRef.current.duration || 1;
    audioRef.current.currentTime = (lineIndex / scriptLines.length) * duration;
    void audioRef.current.play().catch(() => undefined);
  };

  const hasAudio = Boolean(payload.audioUrl);

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6" data-testid="podcast-window">
      {hasAudio ? (
        <PodcastPlayerBar ref={audioRef} src={payload.audioUrl as string} title={result?.render?.title || undefined} />
      ) : (
        /* 音频未就绪（如火山 403）：播放条形态的重试条，点整条重新生成；成功后同位置直接变成播放条 */
        <button
          type="button"
          onClick={onRegenerate}
          disabled={!onRegenerate || isRegenerating}
          className="flex w-full items-center gap-3.5 rounded-[18px] border border-divider bg-paper-warm px-3.5 py-3 text-left transition hover:bg-paper-deep disabled:cursor-default disabled:opacity-70"
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

      {/* 开场简介：这期播客讲什么，一段话，放在播放条正下方 */}
      {overviewText ? <p className="text-[13px] leading-6 text-ink-secondary">{overviewText}</p> : null}

      {chapters.length > 0 ? (
        <nav aria-label={APPS_COPY.podcast.chapters}>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">{APPS_COPY.podcast.chapters}</p>
          <ol className="mt-2 divide-y divide-divider">
            {chapters.map((section, index) => (
              <li key={section.id || `section-${index}`} className="flex gap-3 py-2.5">
                <span className="w-5 shrink-0 pt-px font-mono text-[11px] tabular-nums text-ink-muted">{String(index + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-5 text-ink">{section.title || APPS_COPY.podcast.chapter(index + 1)}</p>
                  {sanitizeNarration(section.body || '') ? (
                    <p className="mt-0.5 text-[12px] leading-5 text-ink-muted">{sanitizeNarration(section.body || '')}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      {scriptLines.length > 0 ? (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">{APPS_COPY.podcast.script}</p>
            <button type="button" onClick={copyScript} className="text-[12px] text-ink-muted transition hover:text-ink">
              {APPS_COPY.podcast.copyScript}
            </button>
          </div>
          {/* 逐字稿：说话人字母在左栏，正文在右；正在播的一句竖一道朱批、字变墨色。点任意一句跳到那里。 */}
          <div ref={scriptContainerRef} className="mt-3 flex flex-col">
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
                  className={`group grid grid-cols-[28px_1fr] gap-x-3 border-l-2 py-2 pl-3 text-left transition-colors disabled:cursor-default ${
                    isActive ? 'border-vermilion' : 'border-transparent hover:border-divider'
                  }`}
                >
                  <span
                    className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors ${
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
                  <p className={`text-[14px] leading-7 transition-colors ${isActive ? 'text-ink' : 'text-ink-secondary group-hover:text-ink'}`}>
                    {line.line}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
