import type { Anchor, TranscriptSegment } from '@/types';

export interface PromptTranscriptContext {
  text: string;
  totalSegments: number;
  usedSegments: number;
  truncated: boolean;
}

interface TranscriptContextOptions {
  maxChars?: number;
  includeIndex?: boolean;
  includeTimestamp?: boolean;
  minCharsPerSegment?: number;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withEllipsis(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, maxChars - 1)}…`;
}

export function buildPromptTranscriptContext(
  transcript: TranscriptSegment[],
  options: TranscriptContextOptions = {}
): PromptTranscriptContext {
  const maxChars = Math.max(2000, options.maxChars ?? 24_000);
  const includeIndex = options.includeIndex ?? true;
  const includeTimestamp = options.includeTimestamp ?? false;
  const minCharsPerSegment = Math.max(24, options.minCharsPerSegment ?? 48);

  const rows = transcript
    .map((segment, index) => {
      const text = normalizeText(segment.text || '');
      if (!text) return null;

      const prefixParts: string[] = [];
      if (includeIndex) {
        prefixParts.push(`段${String(index + 1).padStart(3, '0')}`);
      }
      if (includeTimestamp) {
        prefixParts.push(`[${formatTimestamp(segment.startMs)}-${formatTimestamp(segment.endMs)}]`);
      }
      if (segment.sourceItemId && (index === 0 || transcript[index - 1]?.sourceItemId !== segment.sourceItemId)) {
        prefixParts.push(`【来源：${normalizeText(segment.sourceTitle || segment.sourceItemId)}】`);
      }
      const prefix = prefixParts.length > 0 ? `${prefixParts.join(' ')} ` : '';
      return { prefix, text };
    })
    .filter((row): row is { prefix: string; text: string } => Boolean(row));

  if (rows.length === 0) {
    return {
      text: '',
      totalSegments: transcript.length,
      usedSegments: 0,
      truncated: false,
    };
  }

  const full = rows.map((row) => `${row.prefix}${row.text}`).join('\n');
  if (full.length <= maxChars) {
    return {
      text: full,
      totalSegments: transcript.length,
      usedSegments: rows.length,
      truncated: false,
    };
  }

  const prefixCost = rows.reduce((sum, row) => sum + row.prefix.length + 1, 0);
  const contentBudget = Math.max(minCharsPerSegment * rows.length, maxChars - prefixCost);
  const perSegmentBudget = Math.max(minCharsPerSegment, Math.floor(contentBudget / rows.length));

  const compressed = rows.map((row) => `${row.prefix}${withEllipsis(row.text, perSegmentBudget)}`).join('\n');
  const finalText = withEllipsis(compressed, maxChars);

  return {
    text: finalText,
    totalSegments: transcript.length,
    usedSegments: rows.length,
    truncated: true,
  };
}

export function buildPromptAnchorContext(anchors: Anchor[], maxItems: number = 12): string {
  const list = anchors
    .filter((anchor) => !anchor.cancelled)
    .slice(0, Math.max(1, maxItems))
    .map((anchor, index) => {
      const state = anchor.resolved ? '已解决' : '待澄清';
      const note = normalizeText(anchor.note || '');
      return `${index + 1}. ${state}：${note || '课堂中出现理解阻塞，请解释原因并给出应用建议。'}`;
    });

  return list.join('\n');
}

/**
 * Build a compact terminology hint block for injection into AI prompts.
 * Returns empty string if no hint is available.
 */
export function buildTerminologyHintBlock(terminologyHint: string | undefined): string {
  if (!terminologyHint?.trim()) return '';
  return `\n关键术语表（请在输出中使用正规写法，避免 ASR 误识别变体）：\n${terminologyHint.trim()}`;
}
