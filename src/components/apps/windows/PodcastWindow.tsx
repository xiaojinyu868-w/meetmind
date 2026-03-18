'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';

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

type PodcastView = 'overview' | 'script' | 'chapters';

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

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function PodcastWindow({ result, transcript, taskState, onSeek, onRegenerate }: PodcastWindowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scriptContainerRef = useRef<HTMLDivElement>(null);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioTime, setAudioTime] = useState(0);
  const payload = (result?.render?.payload || {}) as PodcastPayload;
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

  const [activeView, setActiveView] = useState<PodcastView>('overview');

  useEffect(() => {
    if (payload.audioUrl) {
      setActiveView('overview');
      return;
    }
    if (scriptLines.length > 0) {
      setActiveView('script');
      return;
    }
    setActiveView('chapters');
  }, [payload.audioUrl, scriptLines.length]);

  const chapterCitations = useMemo(
    () => result?.cards.map((card) => card.citations?.[0] || null) || [],
    [result?.cards]
  );

  const summaryText = useMemo(() => {
    const description = sanitizeNarration(result?.render?.description || '');
    if (description) return description;
    const firstSection = sanitizeNarration(sections[0]?.body || '');
    if (firstSection) return firstSection;
    const firstLines = scriptLines
      .slice(0, 2)
      .map((item) => item.line)
      .join(' ')
      .trim();
    return firstLines || '课堂内容已经整理成可收听播客，建议先播放一遍把课堂脉络快速过一遍。';
  }, [result?.render?.description, scriptLines, sections]);

  const chapterPreview = useMemo(
    () => sections.map((section) => ({ ...section, body: sanitizeNarration(section.body || '') })).filter((section) => section.title || section.body).slice(0, 4),
    [sections]
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
      if (activeView !== 'script') return;
      const lineEl = scriptContainerRef.current?.querySelector(`[data-line-index="${lineIndex}"]`);
      lineEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLineIndex, activeView, scriptLines.length]);

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
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              {payload.audioUrl ? '已生成可播放播客' : '已生成脚本草稿'}
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">先拿到播客结果，再决定要不要继续细看脚本</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">{truncateText(summaryText, 180)}</p>
            </div>
          </div>
          {audioDuration > 0 ? (
            <div className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">播放进度</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {formatDuration(audioTime)} / {formatDuration(audioDuration)}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          {payload.audioUrl ? (
            <audio ref={audioRef} controls src={payload.audioUrl} className="w-full rounded-lg" />
          ) : (
            <div className="space-y-3">
              <p className="rounded-xl border border-[#E9E9E7] bg-[#FDF3C0]/50 px-4 py-3 text-sm leading-6 text-[#232322]">
                这次先拿到了播客脚本，还没有拿到可播放音频。{payload.error ? `原因：${payload.error}` : '你可以直接重试。'}
              </p>
              {onRegenerate ? (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="inline-flex rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  重新生成播客
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveView('overview')}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeView === 'overview' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            先听播客
          </button>
          <button
            type="button"
            onClick={() => setActiveView('script')}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeView === 'script' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            查看脚本
          </button>
          <button
            type="button"
            onClick={() => setActiveView('chapters')}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeView === 'chapters' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            章节定位
          </button>
          {scriptPlainText ? (
            <button
              type="button"
              onClick={copyScript}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              复制脚本
            </button>
          ) : null}
        </div>
      </div>

      {activeView === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">建议用法</p>
            <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600">
              <p>如果你只是想快速复盘，这里就够了：先直接播放整段播客，再按章节跳去听你最关心的部分。</p>
              <p>如果你想细修表达，再切到 <span className="font-medium text-slate-800">查看脚本</span>，逐段确认主持人口播内容。</p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">快速定位</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {chapterPreview.length > 0 ? (
                chapterPreview.map((section, index) => {
                  const citation = chapterCitations[index];
                  return (
                    <button
                      key={section.id || `preview-${index}`}
                      type="button"
                      onClick={() => citation && seekAudio(citation.startMs)}
                      disabled={!citation}
                      className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-default disabled:opacity-50"
                    >
                      {section.title || `章节 ${index + 1}`}
                    </button>
                  );
                })
              ) : (
                <p className="text-sm text-slate-500">暂无章节信息，建议直接播放整段播客。</p>
              )}
            </div>
            {chapterPreview.length > 0 ? (
              <div className="mt-4 space-y-3">
                {chapterPreview.map((section, index) => (
                  <div key={section.id || `summary-${index}`} className="rounded-xl bg-slate-50 px-3 py-3">
                    <p className="text-sm font-semibold text-slate-800">{section.title || `章节 ${index + 1}`}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{truncateText(section.body || '暂无章节摘要。', 88)}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeView === 'script' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">播客脚本</p>
              <p className="mt-1 text-sm text-slate-500">默认不打扰你；只有想确认话术时再来看脚本。</p>
            </div>
            {scriptLines.length > 0 ? <span className="text-xs text-slate-400">{scriptLines.length} 段</span> : null}
          </div>

          <div ref={scriptContainerRef} className="max-h-[560px] space-y-2 overflow-y-auto">
            {scriptLines.length > 0 ? (
              scriptLines.map((line, index) => {
                const isActive = index === activeLineIndex;
                return (
                  <button
                    key={`line-${index}`}
                    type="button"
                    data-line-index={index}
                    onClick={() => seekToLine(index)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                      isActive
                        ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-200'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${isActive ? 'text-blue-700' : 'text-slate-500'}`}>
                      {line.speaker}
                    </p>
                    <p className={`mt-2 text-sm leading-7 ${isActive ? 'text-slate-900' : 'text-slate-600'}`}>{line.line}</p>
                  </button>
                );
              })
            ) : (
              <p className="text-sm text-slate-500">暂无脚本内容。</p>
            )}
          </div>
        </div>
      ) : null}

      {activeView === 'chapters' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <p className="text-sm font-semibold text-slate-900">章节定位</p>
            <p className="mt-1 text-sm text-slate-500">只有在你需要回到某段课堂证据时，再看这一层信息。</p>
          </div>

          <div className="grid gap-3">
            {sections.length > 0 ? (
              sections.map((section, index) => {
                const citation = chapterCitations[index];
                return (
                  <article key={section.id || `section-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{section.title || `章节 ${index + 1}`}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{sanitizeNarration(section.body || '') || '暂无章节摘要。'}</p>
                      </div>
                      {citation ? (
                        <button
                          type="button"
                          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
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
              })
            ) : (
              <p className="text-sm text-slate-500">暂无章节信息。</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
