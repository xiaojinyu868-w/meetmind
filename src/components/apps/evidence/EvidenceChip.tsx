'use client';

import { useMemo, useState } from 'react';
import type { TranscriptSegment } from '@/types';
import type { AppCardCitation } from '@/lib/ai-native/types';
import { EvidencePopoverCard } from './EvidencePopoverCard';

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getSnippet(citation: AppCardCitation, transcript: TranscriptSegment[]): string {
  if (citation.snippet && citation.snippet.trim()) return citation.snippet.trim();
  const matched = transcript
    .filter((segment) => segment.endMs >= citation.startMs && segment.startMs <= citation.endMs)
    .slice(0, 3)
    .map((segment) => segment.text.trim())
    .filter(Boolean);
  if (matched.length > 0) return matched.join(' ');
  return '';
}

interface EvidenceChipProps {
  citation: AppCardCitation;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
}

export function EvidenceChip({ citation, transcript, onSeek }: EvidenceChipProps) {
  const [open, setOpen] = useState(false);
  const snippet = useMemo(() => getSnippet(citation, transcript), [citation, transcript]);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="rounded-full border border-pine/30 bg-pine-fog px-2.5 py-1 text-xs font-medium text-pine hover:bg-pine-mist"
        onClick={() => setOpen((value) => !value)}
      >
        证据 {formatTime(citation.startMs)}
      </button>
      {open ? <EvidencePopoverCard citation={citation} snippet={snippet} onSeek={onSeek} /> : null}
    </span>
  );
}
