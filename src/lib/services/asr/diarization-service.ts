/**
 * 说话人分离 — 客户端服务
 *
 * 录音结束后，用已上传的音频 URL 调用 /api/asr/diarize，
 * 拿到带 speaker_id 的句子，按时间戳合并到已有 TranscriptSegment，
 * 更新 IndexedDB 并通知 UI 刷新。
 *
 * 设计决策：
 *   - 静默执行，失败不打断用户（说话人分离是增强，不是核心功能）
 *   - 合并策略：时间区间最大重叠优先；无重叠时仅允许 1.5 秒近邻兜底
 *   - UI 通知：通过 onSpeakerIdUpdated 回调让父组件刷新 transcript
 */

import { createLogger } from '@/lib/logger';
import { updateTranscriptSpeakerIds } from '@/lib/db/transcripts';
import type { TranscriptSegment } from '@/types';

const log = createLogger('diarization-service');

export interface DiarizationSentence {
  text: string;
  beginTime: number;
  endTime: number;
  speakerId: number;
}

interface DiarizationApiResponse {
  success: boolean;
  sentences: DiarizationSentence[];
  speakerCount: number;
  error?: string;
}

export interface DiarizationEvidence {
  shouldApply: boolean;
  stableSpeakerIds: number[];
  stableSpeakerCount: number;
  totalSpeechMs: number;
}

const MIN_STABLE_SPEAKER_MS = 1500;
const MIN_STABLE_SPEAKER_CHARS = 6;
const MIN_MULTI_SPEAKER_TOTAL_MS = 6000;

/**
 * 判断说话人结果是否真的值得展示。
 *
 * 说话人标签属于高信任信息：一个短噪声被聚成“第二个人”，比不显示更伤体验。
 * 因此只有至少两位发言者都留下足够语音与文本证据时才应用；未确定的 -1 永远忽略。
 */
export function assessDiarizationEvidence(
  sentences: DiarizationSentence[],
): DiarizationEvidence {
  const stats = new Map<number, { speechMs: number; chars: number }>();

  for (const sentence of sentences) {
    if (!Number.isInteger(sentence.speakerId) || sentence.speakerId < 0) continue;
    const text = sentence.text.trim();
    const durationMs = Math.max(0, sentence.endTime - sentence.beginTime);
    if (!text || durationMs <= 0) continue;

    const current = stats.get(sentence.speakerId) ?? { speechMs: 0, chars: 0 };
    current.speechMs += durationMs;
    current.chars += text.replace(/\s/g, '').length;
    stats.set(sentence.speakerId, current);
  }

  const stableSpeakerIds = [...stats.entries()]
    .filter(([, stat]) => (
      stat.speechMs >= MIN_STABLE_SPEAKER_MS
      && stat.chars >= MIN_STABLE_SPEAKER_CHARS
    ))
    // Map 保留首次出现顺序，用户看到的 A/B 与课堂时间线一致。
    .map(([speakerId]) => speakerId);
  const totalSpeechMs = [...stats.values()].reduce((sum, stat) => sum + stat.speechMs, 0);

  return {
    shouldApply: stableSpeakerIds.length >= 2 && totalSpeechMs >= MIN_MULTI_SPEAKER_TOTAL_MS,
    stableSpeakerIds,
    stableSpeakerCount: stableSpeakerIds.length,
    totalSpeechMs,
  };
}

/**
 * Batch 定稿之后是否还需要补说话人标签。
 *
 * 续录片段的时间戳带有整节课 offset，而 diarization 返回的是当前音频 blob
 * 内的相对时间；在没有完成 offset 映射前不能冒险错标上一段课堂。
 */
export function shouldRunPostBatchDiarization(
  segments: TranscriptSegment[],
  baseOffsetMs: number,
): boolean {
  const hasResolvedSpeaker = segments.some((segment) => (
    typeof segment.speakerId === 'string'
    && /^\d+$/.test(segment.speakerId)
  ));
  return (
    segments.length > 0
    && baseOffsetMs === 0
    && !hasResolvedSpeaker
  );
}

/**
 * 调用说话人分离 API，合并结果到已有转录段
 *
 * @param audioBlob 录音 blob（直接传给 /api/asr/diarize，不需要预先上传）
 * @param sessionId 录音会话 ID
 * @param existingSegments 当前已有的转录段（用于合并）
 * @param onSpeakerIdUpdated 合并完成后的回调（父组件刷新 transcript）
 */
export async function runDiarizationForSession(
  audioBlob: Blob,
  sessionId: string,
  existingSegments: TranscriptSegment[],
  onSpeakerIdUpdated?: (updatedSegments: TranscriptSegment[]) => void,
): Promise<{ success: boolean; speakerCount: number; applied?: boolean; error?: string }> {
  log.info('Starting diarization', { sessionId, blobSize: audioBlob.size, segmentCount: existingSegments.length });

  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('language', 'zh');

    const response = await fetch('/api/asr/diarize', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      log.warn('Diarization API failed', { status: response.status, error: errorBody.error });
      return { success: false, speakerCount: 0, error: errorBody.error };
    }

    const result = (await response.json()) as DiarizationApiResponse;

    if (!result.success || result.sentences.length === 0) {
      log.warn('Diarization returned empty', { error: result.error });
      return { success: false, speakerCount: 0, error: result.error };
    }

    log.info('Diarization succeeded', {
      sentenceCount: result.sentences.length,
      speakerCount: result.speakerCount,
    });

    const evidence = assessDiarizationEvidence(result.sentences);
    if (!evidence.shouldApply) {
      log.info('Diarization hidden: insufficient multi-speaker evidence', {
        reportedSpeakerCount: result.speakerCount,
        stableSpeakerCount: evidence.stableSpeakerCount,
        totalSpeechMs: evidence.totalSpeechMs,
      });
      return {
        success: true,
        speakerCount: evidence.stableSpeakerCount,
        applied: false,
      };
    }

    const stableSpeakerIds = new Set(evidence.stableSpeakerIds);
    const speakerOrdinal = new Map(
      evidence.stableSpeakerIds.map((speakerId, index) => [speakerId, index]),
    );
    const stableSentences = result.sentences
      .filter((sentence) => stableSpeakerIds.has(sentence.speakerId))
      .map((sentence) => ({
        ...sentence,
        // 远端声纹编号可能不从 0 连续递增；落盘前收口为 A/B/C 顺序。
        speakerId: speakerOrdinal.get(sentence.speakerId)!,
      }));

    // 构建 startMs → speakerId 映射
    const speakerMap = stableSentences.map((s) => ({
      startMs: s.beginTime,
      endMs: s.endTime,
      speakerId: String(s.speakerId),
    }));

    // 更新 IndexedDB
    const updatedCount = await updateTranscriptSpeakerIds(sessionId, speakerMap);
    log.info('Updated speakerId in IndexedDB', { updatedCount, total: existingSegments.length });

    // 合并到内存中的 segments（用于回调）
    const updatedSegments = mergeSpeakerIds(existingSegments, stableSentences);

    // 通知 UI 刷新
    onSpeakerIdUpdated?.(updatedSegments);

    return { success: true, speakerCount: evidence.stableSpeakerCount, applied: true };
  } catch (error) {
    log.error('Diarization failed', error);
    return {
      success: false,
      speakerCount: 0,
      error: error instanceof Error ? error.message : '说话人分离失败',
    };
  }
}

/**
 * 把 diarization 结果合并到内存中的 TranscriptSegment 数组
 *
 * 匹配策略：时间区间最大重叠优先；无重叠时只允许小范围时间轴偏差
 */
export function mergeSpeakerIds(
  segments: TranscriptSegment[],
  diarizationSentences: DiarizationSentence[],
): TranscriptSegment[] {
  return segments.map((seg) => {
    let bestMatch: { speakerId: number } | null = null;
    let bestOverlap = 0;
    let bestDist = Infinity;

    for (const ds of diarizationSentences) {
      const overlap = Math.max(0, Math.min(seg.endMs, ds.endTime) - Math.max(seg.startMs, ds.beginTime));
      const dist = Math.abs(seg.startMs - ds.beginTime);
      if (overlap > bestOverlap || (overlap === bestOverlap && dist < bestDist)) {
        bestOverlap = overlap;
        bestDist = dist;
        bestMatch = ds;
      }
    }

    // 优先采用时间重叠最大的发言；无重叠时只容忍 1.5 秒的小时间轴偏差。
    if (bestMatch && (bestOverlap > 0 || bestDist < 1500)) {
      return { ...seg, speakerId: String(bestMatch.speakerId) };
    }

    return seg;
  });
}

/**
 * 获取说话人显示标签
 *
 * 返回匿名“发言者 A / B”，不假设谁是老师，也不自动猜真实姓名——
 * 声纹聚类编号的顺序不保证 0 是主讲人。
 */
export function getSpeakerLabel(speakerId: string | undefined): string {
  if (!speakerId) return '';
  if (!/^\d+$/.test(speakerId)) return '';
  const id = Number(speakerId);
  if (!Number.isInteger(id) || id < 0 || id > 25) return '';
  return `发言者 ${String.fromCharCode(65 + id)}`;
}

/**
 * 获取说话人对应的 v7 色系
 *
 * speakerId 0 = pine（墨松绿，场景上下文色）
 * speakerId 1+ = vermilion（朱批红，个人上下文色）
 * （颜色选择是视觉约定，不代表 0 一定是老师）
 */
export function getSpeakerColorClass(speakerId: string | undefined): string {
  if (!speakerId) return '';
  if (!/^\d+$/.test(speakerId)) return '';
  const id = Number(speakerId);
  if (!Number.isInteger(id) || id < 0) return '';
  if (id === 0) return 'text-pine';
  if (id === 1) return 'text-vermilion';
  return 'text-ink-secondary';
}
