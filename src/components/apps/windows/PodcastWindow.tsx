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

export function PodcastWindow({ result, transcript, onSeek }: PodcastWindowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const payload = (result?.render?.payload || {}) as PodcastPayload;
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const scriptLines = Array.isArray(payload.lines) ? payload.lines : [];
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
                <p className="mt-1 text-sm leading-6 text-slate-600">{section.body || '暂无章节摘要。'}</p>
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
                  <p className="font-medium text-slate-800">{line.speaker || '角色'}</p>
                  <p className="mt-1 leading-6 text-slate-600">{line.line || ''}</p>
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
