import type { SourceIngestItem } from '@/types/page-types';
import type { TranscriptSegment } from '@/types';
import type { WorkshopAppKey, WorkshopReadinessAssessment } from '@/lib/ai-native/types';

/** 移动首页按资料收件箱呈现；复制后排序，避免改动桌面收集流共享顺序。 */
export function sortCollectionNewestFirst(items: SourceIngestItem[]): SourceIngestItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const timeDifference = new Date(b.item.addedAt).getTime() - new Date(a.item.addedAt).getTime();
      return timeDifference || b.index - a.index;
    })
    .map(({ item }) => item);
}

/**
 * 服务端明确返回 null 代表“当前没有值得强推的一项”，移动端不能再用本地规则覆盖。
 * 只有判断尚未返回时才使用轻量 fallback，避免首屏没有排序依据。
 */
export function resolveMobileWorkshopRecommendation(
  assessment: Pick<WorkshopReadinessAssessment, 'recommendedAppKey'> | null | undefined,
  fallbackKey: WorkshopAppKey | null,
): WorkshopAppKey | null {
  return assessment ? assessment.recommendedAppKey : fallbackKey;
}

/** 推荐优先；未被推荐时，课堂播客作为高成本再听方式稳定放在末尾。 */
export function sortMobileWorkshopApps<T extends { key: WorkshopAppKey }>(
  apps: T[],
  recommendedKey: WorkshopAppKey | null,
): T[] {
  return [...apps].sort((left, right) => {
    if (left.key === recommendedKey) return -1;
    if (right.key === recommendedKey) return 1;
    if (left.key === 'audio-overview') return 1;
    if (right.key === 'audio-overview') return -1;
    return 0;
  });
}

export type ClassroomTimelineItem =
  | { type: 'seg'; data: TranscriptSegment; key: string; timestampMs: number }
  | { type: 'photo'; data: SourceIngestItem; key: string; timestampMs: number };

function normalizeTimelineText(text: string): string {
  return text.trim().replace(/[\s,，。.!！？？、]/g, '');
}

/** 把实时转录与课中板书放进同一条课堂时钟，避免板书固定堆在文字末尾。 */
export function buildClassroomTimeline(
  segments: TranscriptSegment[],
  photos: SourceIngestItem[],
  options: { maxSegments?: number; maxItems?: number } = {},
): ClassroomTimelineItem[] {
  const maxSegments = options.maxSegments ?? 15;
  const maxItems = options.maxItems ?? 20;
  const recentSegments = segments.slice(-maxSegments).filter((segment, index, items) => (
    index === 0 || normalizeTimelineText(segment.text) !== normalizeTimelineText(items[index - 1].text)
  ));
  const timeline: ClassroomTimelineItem[] = [
    ...recentSegments.map((segment) => ({
      type: 'seg' as const,
      data: segment,
      key: segment.id,
      timestampMs: Math.max(0, segment.startMs),
    })),
    ...photos.map((photo) => ({
      type: 'photo' as const,
      data: photo,
      key: photo.id,
      timestampMs: Number.isFinite(photo.capturedAtMs)
        ? Math.max(0, photo.capturedAtMs ?? 0)
        : Number.MAX_SAFE_INTEGER,
    })),
  ];

  return timeline
    .sort((left, right) => (
      left.timestampMs - right.timestampMs
      || (left.type === right.type ? 0 : left.type === 'seg' ? -1 : 1)
    ))
    .slice(-maxItems);
}

/**
 * 优先用照片文件的实际拍摄时刻；系统没有提供可信时间时，退回文件返回时的课堂时钟。
 * 这样打开相机后停留几十秒再拍，也不会继续使用点按钮那一刻的旧锚点。
 */
export function resolveClassroomPhotoTimestamp(input: {
  requestedAtMs: number;
  recordingStartedAtEpochMs: number | null;
  fileLastModifiedEpochMs: number;
  capturedAtEpochMs: number;
}): number {
  const requestedAtMs = Number.isFinite(input.requestedAtMs) ? Math.max(0, input.requestedAtMs) : 0;
  const startedAt = input.recordingStartedAtEpochMs;
  if (!Number.isFinite(startedAt) || startedAt === null) return requestedAtMs;

  const nowElapsedMs = Math.max(0, input.capturedAtEpochMs - startedAt);
  const fileTimeIsCredible = Number.isFinite(input.fileLastModifiedEpochMs)
    && input.fileLastModifiedEpochMs >= startedAt
    && input.fileLastModifiedEpochMs <= input.capturedAtEpochMs + 5_000;
  if (!fileTimeIsCredible) return nowElapsedMs || requestedAtMs;

  return Math.min(nowElapsedMs, Math.max(0, input.fileLastModifiedEpochMs - startedAt));
}
