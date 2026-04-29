export interface InlineChoiceOption {
  id: string;
  label: string;
  text: string;
}

export interface InlineChoicePrompt {
  question: string;
  options: InlineChoiceOption[];
}

const OPTION_MARKER_RE = /(^|[\s\n\r，,；;。！？?：:、])([（(]?\s*([A-FＡ-Ｆ])\s*[)）.、:：])/g;

function normalizeOptionLabel(raw: string): string {
  const code = raw.charCodeAt(0);
  const fullWidthA = 'Ａ'.charCodeAt(0);
  const fullWidthF = 'Ｆ'.charCodeAt(0);
  if (code >= fullWidthA && code <= fullWidthF) {
    return String.fromCharCode('A'.charCodeAt(0) + code - fullWidthA);
  }
  return raw.toUpperCase();
}

export function parseInlineChoicePrompt(content: string): InlineChoicePrompt | null {
  const text = content.trim();
  if (!text || text.length > 900) return null;

  const markers = Array.from(text.matchAll(OPTION_MARKER_RE)).map((match) => {
    const prefix = match[1] ?? '';
    const marker = match[2] ?? '';
    const rawLabel = match[3] ?? '';
    const matchIndex = match.index ?? 0;
    return {
      label: normalizeOptionLabel(rawLabel),
      start: matchIndex + prefix.length,
      end: matchIndex + prefix.length + marker.length,
    };
  });
  if (markers.length < 2 || markers.length > 6) return null;

  const firstIndex = markers[0].start;
  if (firstIndex <= 0) return null;

  const question = text
    .slice(0, firstIndex)
    .replace(/[：:\s]+$/, '')
    .trim();
  if (!question || question.length > 180) return null;

  const options = markers.map((marker, index) => {
    const start = marker.end;
    const end = index + 1 < markers.length ? markers[index + 1].start : text.length;
    const optionText = text
      .slice(start, end)
      .replace(/^[\s，,；;、：:]+/, '')
      .replace(/[\s，,；;、。？?]+$/, '')
      .trim();
    return {
      id: marker.label.toLowerCase(),
      label: marker.label,
      text: optionText,
    };
  }).filter((option) => option.text.length > 0);

  if (options.length !== markers.length) return null;
  return { question, options };
}
