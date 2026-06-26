'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { RefreshCw, Loader2 } from 'lucide-react';

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
  if (!speaker) return index % 2 === 0 ? '主持人A' : '主持人B';
  if (mapping.has(speaker)) return mapping.get(speaker) as string;
  if (SPEAKER_ID_PATTERN.test(speaker)) {
    const alias = mapping.size % 2 === 0 ? '主持人A' : '主持人B';
    mapping.set(speaker, alias);
    return alias;
  }
  return speaker;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PodcastWindow({ result, transcript, taskState, onSeek, onRegenerate }: PodcastWindowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scriptContainerRef = useRef<HTMLDivElement>(null);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioTime, setAudioTime] = useState(0);
  const payload = (result?.render?.payload || {}) as PodcastPayload;
  const isRegenerating = taskState?.status === 'running';
  const sections = Array.isArray(payload.sections) ? payload.sections : [];

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

  const chapterCitations = useMemo(
    () => result?.cards.map((card) => card.citations?.[0] || null) || [],
    [result?.cards]
  );

  const scriptPlainText = useMemo(
    () => scriptLines.map((line) => `${line.speaker}：${line.line}`).join('\n\n'),
    [scriptLines]
  );

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    const currentTime = audioRef.current.currentTime;
    setAudioTime(currentTime);

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
    const onMeta = () => setAudioDuration(audio.duration || 0);
    audio.addEventListener('loadedmetadata', onMeta);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', onMeta);
    };
  }, [handleTimeUpdate]);

  const copyScript = useCallback(async () => {
    if (!scriptPlainText) return;
    try {
      await navigator.clipboard.writeText(scriptPlainText);
      toast.success('播客脚本已复制');
    } catch {
      toast.error('复制失败，请手动选择脚本内容');
    }
  }, [scriptPlainText]);

  if (!result) {
    if (taskState?.status === 'error') {
      return (
        <AppWindowPlaceholder
          status="error"
          appName="课堂播客"
          errorMessage={taskState.error}
          onRetry={onRegenerate}
        />
      );
    }
    if (taskState?.status === 'idle') {
      return (
        <AppWindowPlaceholder
          status="empty"
          appName="课堂播客"
          description="点击生成后，会直接给你一版可播放的课堂播客。"
          onRetry={onRegenerate}
        />
      );
    }
    return <AppWindowPlaceholder status="loading" appName="课堂播客" />;
  }

  const seekAudio = (startMs: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, startMs / 1000);
      void audioRef.current.play().catch(() => undefined);
    }
    onSeek?.(startMs);
  };

  const seekToLine = (lineIndex: number) => {
    if (!audioRef.current || scriptLines.length === 0) return;
    const duration = audioRef.current.duration || 1;
    const targetTime = (lineIndex / scriptLines.length) * duration;
    audioRef.current.currentTime = targetTime;
    void audioRef.current.play().catch(() => undefined);
  };

  return (
    <section className="space-y-4" data-testid="podcast-window">
      <div className="rounded-2xl border border-divider bg-white p-4 shadow-sm sm:p-5">
        {payload.audioUrl ? (
          <>
            {/* 生成成功：首页就是一条播放条，其他都收起来 */}
            <audio ref={audioRef} controls src={payload.audioUrl} className="w-full rounded-lg" />
            {audioDuration > 0 ? (
              <p className="mt-2 text-xs tabular-nums text-ink-muted">
                {formatDuration(audioTime)} / {formatDuration(audioDuration)}
              </p>
            ) : null}

            {scriptLines.length > 0 || sections.length > 0 ? (
              <details className="mt-3 border-t border-divider pt-3">
                <summary className="cursor-pointer select-none text-xs font-medium text-ink-secondary hover:text-ink">
                  展开脚本与章节
                </summary>
                <div className="mt-3 space-y-4">
                  {scriptLines.length > 0 ? (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">播客脚本</p>
                        <button
                          type="button"
                          onClick={copyScript}
                          className="rounded-full border border-divider bg-white px-2.5 py-1 text-[11px] font-medium text-ink-secondary transition hover:bg-paper-warm"
                        >
                          复制脚本
                        </button>
                      </div>
                      <div ref={scriptContainerRef} className="max-h-[480px] space-y-2 overflow-y-auto">
                        {scriptLines.map((line, index) => {
                          const isActive = index === activeLineIndex;
                          return (
                            <button
                              key={`line-${index}`}
                              type="button"
                              data-line-index={index}
                              onClick={() => seekToLine(index)}
                              className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                                isActive
                                  ? 'border-vermilion/40 bg-vermilion-mist/50 ring-1 ring-vermilion/20'
                                  : 'border-divider bg-paper-warm hover:border-divider hover:bg-white'
                              }`}
                            >
                              <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${isActive ? 'text-vermilion' : 'text-ink-muted'}`}>
                                {line.speaker}
                              </p>
                              <p className={`mt-2 text-sm leading-7 ${isActive ? 'text-ink' : 'text-ink-secondary'}`}>{line.line}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {sections.length > 0 ? (
                    <div className="grid gap-3">
                      {sections.map((section, index) => {
                        const citation = chapterCitations[index];
                        return (
                          <article key={section.id || `section-${index}`} className="rounded-2xl border border-divider bg-paper-warm p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-ink">{section.title || `章节 ${index + 1}`}</p>
                                <p className="mt-1 text-sm leading-6 text-ink-secondary">{sanitizeNarration(section.body || '') || '暂无章节摘要。'}</p>
                              </div>
                              {citation ? (
                                <button
                                  type="button"
                                  className="rounded-full border border-divider bg-white px-3 py-1.5 text-xs font-medium text-ink-secondary hover:bg-paper-warm"
                                  onClick={() => seekAudio(citation.startMs)}
                                >
                                  跳到本章
                                </button>
                              ) : null}
                            </div>
                            {citation ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <EvidenceChip citation={citation} transcript={transcript} onSeek={seekAudio} />
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
          </>
        ) : (
          /* 音频未就绪（如火山 403）：播放条形态的重试条，点整条重新生成；
             生成中显示 spinner，成功后同位置直接变成上方播放条 */
          <button
            type="button"
            onClick={onRegenerate}
            disabled={!onRegenerate || isRegenerating}
            className="flex w-full items-center gap-4 rounded-xl bg-paper-warm px-4 py-3 text-left transition hover:bg-paper-deep disabled:cursor-default disabled:opacity-70"
            aria-label={isRegenerating ? '正在生成播客音频' : '重新生成播客音频'}
          >
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-vermilion text-white shadow-[0_6px_16px_rgba(181,72,60,0.28)]">
              {isRegenerating ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">
                {isRegenerating ? '正在生成播客音频…' : '音频未就绪 · 点这里重新生成'}
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-muted">
                {isRegenerating
                  ? '生成完这里会变成播放条，直接就能听'
                  : payload.error
                    ? `上次失败：${payload.error}`
                    : '脚本已就绪，音频稍后就好'}
              </span>
            </span>
            <span className="flex-shrink-0 rounded-full bg-vermilion px-3 py-1.5 text-xs font-semibold text-white">
              {isRegenerating ? '生成中' : '重新生成'}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
