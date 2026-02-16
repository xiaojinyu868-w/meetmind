'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';

interface PodcastWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
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

export function PodcastWindow({ result, transcript, onSeek }: PodcastWindowProps) {
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

  const chapterCitations = useMemo(
    () => result?.cards.map((card) => card.citations?.[0] || null) || [],
    [result?.cards]
  );

  // Audio timeupdate → 脚本行高亮联动
  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    const currentTime = audioRef.current.currentTime;
    setAudioTime(currentTime);

    if (scriptLines.length === 0) return;
    // 均匀分配每行对应的时间区间
    const lineCount = scriptLines.length;
    const duration = audioRef.current.duration || 1;
    const lineIndex = Math.min(Math.floor((currentTime / duration) * lineCount), lineCount - 1);

    if (lineIndex !== activeLineIndex && lineIndex >= 0) {
      setActiveLineIndex(lineIndex);
      // 自动滚动到当前行
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

  if (!result) {
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
    <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]" data-testid="podcast-window">
      {/* 左侧：播放器 + 章节 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-600">课堂播客</p>
          {audioDuration > 0 ? (
            <p className="text-xs text-slate-400">
              {formatDuration(audioTime)} / {formatDuration(audioDuration)}
            </p>
          ) : null}
        </div>

        {payload.audioUrl ? (
          <audio ref={audioRef} controls src={payload.audioUrl} className="w-full rounded-lg" />
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            未获得可播放音频。{payload.error ? `原因：${payload.error}` : '请点击"重新生成"重试。'}
          </p>
        )}

        {/* 章节快速跳转按钮组 */}
        {sections.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sections.map((section, index) => {
              const citation = chapterCitations[index];
              return (
                <button
                  key={section.id || `ch-${index}`}
                  type="button"
                  onClick={() => citation && seekAudio(citation.startMs)}
                  disabled={!citation}
                  className="rounded-full border border-lavender-200 bg-lavender-50 px-2.5 py-1 text-xs font-medium text-lavender-700 transition-colors hover:bg-lavender-100 disabled:cursor-default disabled:opacity-50"
                >
                  {section.title || `章节 ${index + 1}`}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* 章节详情 */}
        <div className="mt-4 grid gap-3">
          {sections.map((section, index) => {
            const citation = chapterCitations[index];
            return (
              <article key={section.id || `section-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">{section.title || `章节 ${index + 1}`}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{sanitizeNarration(section.body || '') || '暂无章节摘要。'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {citation ? <EvidenceChip citation={citation} transcript={transcript} onSeek={seekAudio} /> : null}
                  {citation ? (
                    <button
                      type="button"
                      className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      onClick={() => seekAudio(citation.startMs)}
                    >
                      跳到本章
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* 右侧：脚本面板（默认展开） */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">播客脚本</p>
          {scriptLines.length > 0 ? (
            <span className="text-xs text-slate-400">{scriptLines.length} 行</span>
          ) : null}
        </div>

        <div ref={scriptContainerRef} className="max-h-[500px] space-y-1.5 overflow-y-auto">
          {scriptLines.length > 0 ? (
            scriptLines.map((line, index) => {
              const isActive = index === activeLineIndex;
              return (
                <button
                  key={`line-${index}`}
                  type="button"
                  data-line-index={index}
                  onClick={() => seekToLine(index)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-all duration-200 ${
                    isActive
                      ? 'border-lavender-300 bg-lavender-50 shadow-sm ring-1 ring-lavender-200'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <p className={`text-xs font-medium ${isActive ? 'text-lavender-700' : 'text-slate-500'}`}>
                    {line.speaker}
                  </p>
                  <p className={`mt-0.5 leading-6 ${isActive ? 'text-slate-900' : 'text-slate-600'}`}>
                    {line.line}
                  </p>
                </button>
              );
            })
          ) : (
            <p className="text-sm text-slate-500">暂无脚本内容。</p>
          )}
        </div>
      </div>
    </section>
  );
}
