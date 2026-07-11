/**
 * upload-recording-audio
 *
 * 档位2：录音停止后，把音频 blob 后台上传到服务端持久化，拿到真实 URL，
 * 再把 capture.mediaUrl + 本地 IndexedDB.mediaUrl 从临时 blob: URL 换成真实 URL。
 *
 * 这样任何设备登录都能播放这段音频，后台也能看到/兜底转写。
 *
 * 后台静默执行：失败不打扰用户（音频本地仍在），下次进入可重试。
 */

import { db } from '@/lib/db';

export interface UploadRecordingAudioParams {
  blob: Blob;
  sessionId: string;
  authToken: string;
  /** 上传成功后用真实 URL 更新 capture 的回调（通常是 persistCaptureToWorkspace 再 upsert）
   *  @param realMediaUrl 相对路径（用于页面播放）
   *  @param absoluteUrl  公网绝对 URL（用于 DashScope Fun-ASR 说话人分离）
   */
  onUploaded?: (realMediaUrl: string, absoluteUrl?: string) => void;
}

export interface UploadRecordingAudioResult {
  ok: boolean;
  mediaUrl?: string;
  /** 公网可访问的绝对 URL（用于 DashScope Fun-ASR 说话人分离） */
  absoluteUrl?: string;
  error?: string;
}

/** 小于此值基本是静音/噪声，不值得上传 */
const MIN_UPLOAD_BYTES = 8 * 1024;

export async function uploadRecordingAudio(
  params: UploadRecordingAudioParams,
): Promise<UploadRecordingAudioResult> {
  const { blob, sessionId, authToken, onUploaded } = params;

  if (!blob || blob.size < MIN_UPLOAD_BYTES) {
    return { ok: false, error: 'blob 过小，跳过上传' };
  }
  if (!sessionId || !authToken) {
    return { ok: false, error: '缺少 sessionId 或鉴权' };
  }

  try {
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    formData.append('sessionId', sessionId);

    const resp = await fetch('/api/workspace/upload-audio', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    });
    const data = (await resp.json().catch(() => ({}))) as {
      success?: boolean;
      mediaUrl?: string;
      absoluteUrl?: string;
      error?: string;
    };

    if (!resp.ok || !data.success || !data.mediaUrl) {
      return { ok: false, error: data.error || `HTTP ${resp.status}` };
    }

    const realUrl = data.mediaUrl;
    const absoluteUrl = data.absoluteUrl || realUrl;

    // 更新本地 IndexedDB 的 mediaUrl（从 blob: 临时 URL → 真实 URL）
    try {
      await db.audioSessions.where('sessionId').equals(sessionId).modify({
        mediaUrl: realUrl,
        updatedAt: new Date(),
      });
    } catch {
      // 本地更新失败不影响上传成功
    }

    onUploaded?.(realUrl, absoluteUrl);
    return { ok: true, mediaUrl: realUrl, absoluteUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
