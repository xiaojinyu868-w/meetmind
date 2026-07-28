/**
 * lesson-title-client — 课堂标题的客户端触发层
 *
 * 三个动作：
 *   - requestLessonUnderstanding：定稿后触发课后理解（一次 LLM 调用出
 *     标题 + 摘要 + 精选），返回新标题供调用方同步本地列表
 *   - lockLessonTitleByUser：用户手动改名 → 本地加锁 + 服务端加锁
 *   - silentBackfillLessonTitles：进入应用后每次静默回填最多 10 条历史零信息标题
 */

import { db } from '@/lib/db';
import { updateSessionTopic } from '@/lib/db/sessions';
import type { TranscriptSegment } from '@/types';

interface RetitleParams {
  sessionId: string;
  captureId?: string;
  segments: TranscriptSegment[];
  courseTitle?: string;
  occurredAtMs: number;
  accessToken: string;
}

/** 带时间锚点的转录样本（课后理解需要锚点来定位精选片段） */
function buildAnchoredSample(segments: TranscriptSegment[]): string {
  let sample = '';
  for (const segment of segments) {
    if (sample.length >= 40_000) break;
    const totalSec = Math.floor(segment.startMs / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    sample += `[${mm}:${ss}] ${segment.text}\n`;
  }
  return sample.trim();
}

/**
 * 课后理解：定稿后一次 LLM 调用 → 标题（锁保护）+ 摘要 + 精选片段一次落齐。
 * 返回新标题（调用方用它同步 collection 列表等本地状态）；skipped/失败返回 undefined。
 */
export async function requestLessonUnderstanding(params: RetitleParams): Promise<string | undefined> {
  const { sessionId, captureId, segments, courseTitle, occurredAtMs, accessToken } = params;
  if (!sessionId || !captureId || !accessToken || segments.length === 0) return undefined;

  try {
    const transcriptSample = buildAnchoredSample(segments);
    if (transcriptSample.length < 200) return undefined;

    const response = await fetch('/api/classroom/understanding', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        captureId,
        sessionId,
        transcriptSample,
        courseTitle,
        occurredAt: new Date(occurredAtMs).toISOString(),
      }),
    });
    const data = (await response.json().catch(() => null)) as {
      success?: boolean;
      skipped?: boolean;
      title?: string;
    } | null;
    if (!response.ok || !data?.success || data.skipped || !data.title) return undefined;

    // 本地课堂列表标题（不加锁：自动行为，用户之后仍可手动改）
    const session = await db.audioSessions.where('sessionId').equals(sessionId).first();
    if (!session?.topicLocked) {
      await updateSessionTopic(sessionId, data.title);
    }
    return data.title;
  } catch {
    // 课后理解失败永远静默：旧标题和旧摘要还在
    return undefined;
  }
}

/** 用户手动改名：本地加锁 + 通知服务端加锁（自动系统从此不再覆盖） */
export async function lockLessonTitleByUser(params: {
  sessionId: string;
  title: string;
  accessToken?: string | null;
}): Promise<void> {
  const { sessionId, title, accessToken } = params;
  await updateSessionTopic(sessionId, title, { lock: true });
  if (!accessToken) return;
  try {
    await fetch('/api/titles/lock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ sessionId, title }),
    });
  } catch {
    // 服务端锁失败不阻塞本地：本地锁已生效，下次回填/重命名仍会被服务端跳过大部分情况
  }
}

/** 静默回填历史零信息标题（每次进入应用最多 10 条） */
export function silentBackfillLessonTitles(accessToken: string | null | undefined): void {
  if (!accessToken) return;
  void fetch('/api/titles/backfill', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => undefined);
}
