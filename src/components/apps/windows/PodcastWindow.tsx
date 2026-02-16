'use client';

import { useMemo, useRef } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';

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

export function PodcastWindow({ result, transcript, onSeek }: PodcastWindowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
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

  if (!result) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">正在生成课堂播客...</div>;
  }

  const seekAudio = (startMs: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, startMs / 1000);
      void audioRef.current.play().catch(() => undefined);
    }
    onSeek?.(startMs);
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]" data-testid="podcast-window">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm font-medium text-slate-600">课堂播客</p>
        {payload.audioUrl ? (
          <audio ref={audioRef} controls src={payload.audioUrl} className="w-full" />
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            未获得可播放音频。{payload.error ? `原因：${payload.error}` : '请点击“重新生成”重试。'}
          </p>
        )}
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

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">查看播客脚本</summary>
          <div className="mt-3 space-y-2">
            {scriptLines.length > 0 ? (
              scriptLines.map((line, index) => (
                <div key={`line-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="font-medium text-slate-800">{line.speaker}</p>
                  <p className="mt-1 leading-6 text-slate-600">{line.line}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">暂无脚本内容。</p>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
