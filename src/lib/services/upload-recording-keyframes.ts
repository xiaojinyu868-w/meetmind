/**
 * upload-recording-keyframes
 *
 * 课中「截取这一页」的课后上传：读 IndexedDB 里本节课未上传的关键帧，
 * 逐张 POST /api/workspace/upload-image 拿 mediaUrl，再批量写进
 * /api/workspace/captures/[captureId]/artifacts（kind='keyframe'，
 * payload 含 timestampSec，与转录同一根录音时间轴）。
 *
 * 与 upload-recording-audio 同构：后台静默执行，失败不打扰用户
 * （帧本地仍在，uploaded=false），下次进入课堂时 retry 兜底。
 */

import { getPendingKeyframes, markKeyframeUploaded } from '@/lib/db/keyframes';

export interface UploadRecordingKeyframesParams {
  sessionId: string;
  captureId: string;
  authToken: string;
}

export interface UploadRecordingKeyframesResult {
  ok: boolean;
  uploaded: number;
  total: number;
  error?: string;
}

/** 单帧超过 5 小时的课大概率是计时异常，不上传 */
const MAX_FRAME_TIMESTAMP_MS = 5 * 60 * 60 * 1000;

export async function uploadRecordingKeyframes(
  params: UploadRecordingKeyframesParams,
): Promise<UploadRecordingKeyframesResult> {
  const { sessionId, captureId, authToken } = params;
  if (!sessionId || !captureId || !authToken) {
    return { ok: false, uploaded: 0, total: 0, error: '缺少 sessionId / captureId / 鉴权' };
  }

  const pending = (await getPendingKeyframes(sessionId).catch(() => [])).filter(
    // 云端回填的帧没有 blob（只有 mediaUrl，已 uploaded），本地待上传的帧必须有原图
    (frame) => frame.id != null && frame.blob && frame.timestampMs <= MAX_FRAME_TIMESTAMP_MS,
  );
  if (pending.length === 0) {
    return { ok: true, uploaded: 0, total: 0 };
  }

  const artifacts: Array<{ kind: string; artifactKey: string; payload: Record<string, unknown> }> = [];
  const uploadedIds: Array<{ id: number; mediaUrl: string }> = [];

  for (const frame of pending) {
    if (!frame.blob) continue;
    const formData = new FormData();
    formData.append('image', frame.blob, `keyframe-${frame.id}.jpg`);
    formData.append('imageKey', `kf-${sessionId}-${frame.id}`);
    const resp = await fetch('/api/workspace/upload-image', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    }).catch(() => null);
    const data = resp ? ((await resp.json().catch(() => ({}))) as {
      success?: boolean;
      mediaUrl?: string;
    }) : {};
    if (!resp?.ok || !data.success || !data.mediaUrl) {
      // 单帧失败不阻塞其他帧；未标 uploaded 的帧下次重试
      continue;
    }
    const timestampSec = Math.round(frame.timestampMs / 1000);
    artifacts.push({
      kind: 'keyframe',
      artifactKey: `kf-${frame.id}`,
      payload: { mediaUrl: data.mediaUrl, timestampSec },
    });
    uploadedIds.push({ id: frame.id as number, mediaUrl: data.mediaUrl });
  }

  if (artifacts.length === 0) {
    return { ok: false, uploaded: 0, total: pending.length, error: '全部帧上传失败' };
  }

  // artifacts 路由单次上限 100 条：分批写入，全部成功才算成功
  const BATCH_SIZE = 100;
  for (let offset = 0; offset < artifacts.length; offset += BATCH_SIZE) {
    const batch = artifacts.slice(offset, offset + BATCH_SIZE);
    const resp = await fetch(`/api/workspace/captures/${captureId}/artifacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ sessionId, artifacts: batch }),
    }).catch(() => null);
    const data = resp ? ((await resp.json().catch(() => ({}))) as { success?: boolean }) : {};
    if (!resp?.ok || !data.success) {
      return { ok: false, uploaded: 0, total: pending.length, error: 'artifacts 写入失败' };
    }
  }

  for (const { id, mediaUrl } of uploadedIds) {
    await markKeyframeUploaded(id, mediaUrl).catch(() => {});
  }
  return { ok: true, uploaded: uploadedIds.length, total: pending.length };
}
