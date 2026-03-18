'use client';

import type { AppCardCitation } from '@/lib/ai-native/types';

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface EvidencePopoverCardProps {
  citation: AppCardCitation;
  snippet: string;
  onSeek?: (startMs: number) => void;
}

export function EvidencePopoverCard({ citation, snippet, onSeek }: EvidencePopoverCardProps) {
  return (
    <div className="absolute z-20 mt-2 w-80 max-w-[86vw] rounded-2xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <span>证据片段</span>
        <span>
          {formatTime(citation.startMs)} - {formatTime(citation.endMs)}
        </span>
      </div>
      <p className="max-h-24 overflow-auto text-sm leading-6 text-slate-700">{snippet || '暂无原文片段。'}</p>
      <button
        type="button"
        className="mt-3 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        onClick={() => onSeek?.(citation.startMs)}
      >
        回放到这里
      </button>
    </div>
  );
}
