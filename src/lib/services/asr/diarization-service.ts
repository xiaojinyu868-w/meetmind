/**
 * 说话人分离 — 客户端服务
 *
 * 录音结束后，用已上传的音频 URL 调用 /api/asr/diarize，
 * 拿到带 speaker_id 的句子，按时间戳合并到已有 TranscriptSegment，
 * 更新 IndexedDB 并通知 UI 刷新。
 *
 * 设计决策：
 *   - 静默执行，失败不打断用户（说话人分离是增强，不是核心功能）
 *   - 合并策略：按 startMs 时间戳最近匹配（容忍 3 秒偏差）
 *   - UI 通知：通过 onSpeakerIdUpdated 回调让父组件刷新 transcript
 */

import { createLogger } from '@/lib/logger';
import { updateTranscriptSpeakerIds } from '@/lib/db/transcripts';
import type { TranscriptSegment } from '@/types';

const log = createLogger('diarization-service');

interface DiarizationApiResponse {
  success: boolean;
  sentences: Array<{
    text: string;
    beginTime: number;
    endTime: number;
    speakerId: number;
  }>;
  speakerCount: number;
  error?: string;
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
): Promise<{ success: boolean; speakerCount: number; error?: string }> {
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

    // 构建 startMs → speakerId 映射
    const speakerMap = result.sentences.map((s) => ({
      startMs: s.beginTime,
      speakerId: String(s.speakerId),
    }));

    // 更新 IndexedDB
    const updatedCount = await updateTranscriptSpeakerIds(sessionId, speakerMap);
    log.info('Updated speakerId in IndexedDB', { updatedCount, total: existingSegments.length });

    // 合并到内存中的 segments（用于回调）
    const updatedSegments = mergeSpeakerIds(existingSegments, result.sentences);

    // 通知 UI 刷新
    onSpeakerIdUpdated?.(updatedSegments);

    return { success: true, speakerCount: result.speakerCount };
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
 * 匹配策略：按 startMs 最接近原则，容忍 3 秒偏差
 */
function mergeSpeakerIds(
  segments: TranscriptSegment[],
  diarizationSentences: Array<{ text: string; beginTime: number; endTime: number; speakerId: number }>,
): TranscriptSegment[] {
  return segments.map((seg) => {
    let bestMatch: { speakerId: number } | null = null;
    let bestDist = Infinity;

    for (const ds of diarizationSentences) {
      const dist = Math.abs(seg.startMs - ds.beginTime);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = ds;
      }
    }

    // 容忍 3 秒偏差
    if (bestMatch && bestDist < 3000) {
      return { ...seg, speakerId: String(bestMatch.speakerId) };
    }

    return seg;
  });
}

/**
 * 获取说话人显示标签
 *
 * 返回 "说话人N"（N = speakerId + 1），不假设谁是老师——
 * 声纹聚类的编号顺序不保证 0 是主讲人。
 */
export function getSpeakerLabel(speakerId: string | undefined): string {
  if (!speakerId) return '';
  const id = parseInt(speakerId, 10);
  if (isNaN(id)) return '';
  return `说话人${id + 1}`;
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
  const id = parseInt(speakerId, 10);
  if (isNaN(id)) return '';
  if (id === 0) return 'text-pine';
  return 'text-vermilion';
}
