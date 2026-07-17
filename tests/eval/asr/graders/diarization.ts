export interface SpeakerSegment {
  speakerId: string;
  startMs: number;
  endMs: number;
}

export interface DiarizationResult {
  der: number;
  missedSpeechMs: number;
  falseAlarmMs: number;
  confusionMs: number;
  referenceSpeechMs: number;
  referenceSpeakerCount: number;
  hypothesisSpeakerCount: number;
  speakerCountError: number;
  mapping: Record<string, string>;
}

export interface DiarizationOptions {
  frameMs?: number;
  /** 忽略参考说话人切换边界附近的不确定区间。 */
  collarMs?: number;
}

const DEFAULT_FRAME_MS = 20;
const DEFAULT_COLLAR_MS = 250;

function normalizeSegments(segments: SpeakerSegment[]): SpeakerSegment[] {
  return segments.filter((segment) => (
    segment.speakerId.trim().length > 0
    && Number.isFinite(segment.startMs)
    && Number.isFinite(segment.endMs)
    && segment.endMs > segment.startMs
  ));
}

function activeSpeakersAt(segments: SpeakerSegment[], timeMs: number): string[] {
  return segments
    .filter((segment) => segment.startMs <= timeMs && timeMs < segment.endMs)
    .map((segment) => segment.speakerId);
}

function isInsideCollar(timeMs: number, boundaries: number[], collarMs: number): boolean {
  if (collarMs <= 0) return false;
  return boundaries.some((boundary) => Math.abs(timeMs - boundary) < collarMs);
}

/**
 * 用最大共现时长对齐 hypothesis 与 reference 的匿名声纹编号。
 * 声纹 0/1 本身没有语义，因此不能直接比较字符串编号。
 */
function findBestSpeakerMapping(
  hypothesisSpeakers: string[],
  referenceSpeakers: string[],
  overlap: Map<string, Map<string, number>>,
): Record<string, string> {
  if (hypothesisSpeakers.length === 0 || referenceSpeakers.length === 0) return {};

  // 产品当前最多 10 人；超过 16 人时退化为不重复的贪心匹配，避免 2^N 爆炸。
  if (referenceSpeakers.length > 16) {
    const used = new Set<string>();
    const mapping: Record<string, string> = {};
    for (const hypothesis of hypothesisSpeakers) {
      const best = referenceSpeakers
        .filter((reference) => !used.has(reference))
        .map((reference) => ({ reference, score: overlap.get(hypothesis)?.get(reference) ?? 0 }))
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score > 0) {
        mapping[hypothesis] = best.reference;
        used.add(best.reference);
      }
    }
    return mapping;
  }

  type Candidate = { score: number; mapping: Record<string, string> };
  let states = new Map<number, Candidate>([[0, { score: 0, mapping: {} }]]);

  for (const hypothesis of hypothesisSpeakers) {
    const next = new Map<number, Candidate>();
    for (const [mask, candidate] of states) {
      const unmatched = next.get(mask);
      if (!unmatched || candidate.score > unmatched.score) {
        next.set(mask, candidate);
      }

      referenceSpeakers.forEach((reference, index) => {
        const bit = 1 << index;
        if ((mask & bit) !== 0) return;
        const score = candidate.score + (overlap.get(hypothesis)?.get(reference) ?? 0);
        const nextMask = mask | bit;
        const current = next.get(nextMask);
        if (!current || score > current.score) {
          next.set(nextMask, {
            score,
            mapping: { ...candidate.mapping, [hypothesis]: reference },
          });
        }
      });
    }
    states = next;
  }

  return [...states.values()].sort((a, b) => b.score - a.score)[0]?.mapping ?? {};
}

export function computeDiarizationErrorRate(
  referenceInput: SpeakerSegment[],
  hypothesisInput: SpeakerSegment[],
  options: DiarizationOptions = {},
): DiarizationResult {
  const frameMs = Math.max(1, Math.round(options.frameMs ?? DEFAULT_FRAME_MS));
  const collarMs = Math.max(0, options.collarMs ?? DEFAULT_COLLAR_MS);
  const reference = normalizeSegments(referenceInput);
  const hypothesis = normalizeSegments(hypothesisInput);
  const referenceSpeakers = [...new Set(reference.map((segment) => segment.speakerId))].sort();
  const hypothesisSpeakers = [...new Set(hypothesis.map((segment) => segment.speakerId))].sort();

  const allSegments = [...reference, ...hypothesis];
  if (allSegments.length === 0) {
    return {
      der: 0,
      missedSpeechMs: 0,
      falseAlarmMs: 0,
      confusionMs: 0,
      referenceSpeechMs: 0,
      referenceSpeakerCount: 0,
      hypothesisSpeakerCount: 0,
      speakerCountError: 0,
      mapping: {},
    };
  }

  const startMs = Math.floor(Math.min(...allSegments.map((segment) => segment.startMs)) / frameMs) * frameMs;
  const endMs = Math.ceil(Math.max(...allSegments.map((segment) => segment.endMs)) / frameMs) * frameMs;
  const boundaries = reference.flatMap((segment) => [segment.startMs, segment.endMs]);
  const overlap = new Map<string, Map<string, number>>();

  for (let frameStart = startMs; frameStart < endMs; frameStart += frameMs) {
    const midpoint = frameStart + frameMs / 2;
    if (isInsideCollar(midpoint, boundaries, collarMs)) continue;
    const activeReference = activeSpeakersAt(reference, midpoint);
    const activeHypothesis = activeSpeakersAt(hypothesis, midpoint);
    for (const hypothesisSpeaker of activeHypothesis) {
      const row = overlap.get(hypothesisSpeaker) ?? new Map<string, number>();
      for (const referenceSpeaker of activeReference) {
        row.set(referenceSpeaker, (row.get(referenceSpeaker) ?? 0) + frameMs);
      }
      overlap.set(hypothesisSpeaker, row);
    }
  }

  const mapping = findBestSpeakerMapping(hypothesisSpeakers, referenceSpeakers, overlap);
  let missedSpeechMs = 0;
  let falseAlarmMs = 0;
  let confusionMs = 0;
  let referenceSpeechMs = 0;

  for (let frameStart = startMs; frameStart < endMs; frameStart += frameMs) {
    const midpoint = frameStart + frameMs / 2;
    if (isInsideCollar(midpoint, boundaries, collarMs)) continue;
    const activeReference = new Set(activeSpeakersAt(reference, midpoint));
    const activeHypothesis = activeSpeakersAt(hypothesis, midpoint)
      .map((speaker) => mapping[speaker] ?? `__unmapped:${speaker}`);
    const common = activeHypothesis.filter((speaker) => activeReference.has(speaker)).length;
    const referenceCount = activeReference.size;
    const hypothesisCount = activeHypothesis.length;

    referenceSpeechMs += referenceCount * frameMs;
    missedSpeechMs += Math.max(0, referenceCount - hypothesisCount) * frameMs;
    falseAlarmMs += Math.max(0, hypothesisCount - referenceCount) * frameMs;
    confusionMs += Math.max(0, Math.min(referenceCount, hypothesisCount) - common) * frameMs;
  }

  const totalErrorMs = missedSpeechMs + falseAlarmMs + confusionMs;
  return {
    der: referenceSpeechMs > 0 ? totalErrorMs / referenceSpeechMs : (totalErrorMs > 0 ? 1 : 0),
    missedSpeechMs,
    falseAlarmMs,
    confusionMs,
    referenceSpeechMs,
    referenceSpeakerCount: referenceSpeakers.length,
    hypothesisSpeakerCount: hypothesisSpeakers.length,
    speakerCountError: Math.abs(hypothesisSpeakers.length - referenceSpeakers.length),
    mapping,
  };
}
