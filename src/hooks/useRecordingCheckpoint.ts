'use client';

/**
 * useRecordingCheckpoint — 录课期间持续落盘 + 服务端检查点（2026-09-10 录课不丢）。
 *
 * 之前一节课只在「结束这节课」那一刻持久化：音频分片在 Recorder 的内存数组里、实时字幕在
 * store / ref 里，关页 / 崩溃 / 手机被系统回收 = 整节课消失（生产实测 before/02-03）。
 *
 * 现在录音期间：
 *   - 每片原声（默认 1s）进内存缓冲，每 5s 批量追加到 IndexedDB.recordingChunks
 *   - 每 5s 把已定稿的实时字幕整段快照覆盖到 IndexedDB.transcripts（不改 transcriptionStatus）
 *   - 每次落盘顺手写 audioSessions.checkpointAt / lastCheckpointDurationMs（恢复条据此说「已录 N 分钟」）
 *   - 登录用户：开始时立刻、开头几句 15s 一次、之后每 60s（有变化才发）向 /api/workspace/recording-checkpoint
 *     写「录制中」检查点，另一台设备在录课期间就能看到这节课；页面隐藏 / 卸载时用 keepalive 发一次心跳
 *   - 访客只落本地
 *
 * 正常结束时 handleRecordingStop 写最终 blob 与转录并删掉分片；这里在录音结束时只丢掉迟到的分片缓冲，
 * 不再写任何东西。所有失败只 console.warn，录音本身永不受影响。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import {
  appendRecordingChunks,
  markSessionCheckpoint,
  replaceSessionTranscripts,
  ANONYMOUS_USER_ID,
} from '@/lib/db';
import { buildLiveRecordingTitle } from '@/lib/capture/live-recording-capture';
import type { RecorderAudioChunkMeta } from '@/components/recorder/recorder-types';
import type { TranscriptSegment } from '@/types';

export const LOCAL_CHECKPOINT_INTERVAL_MS = 5_000;
/** 服务端检查点节奏：开头几句 15s 一次（短课 / 刚开始就关页也有字），之后 60s 一次 */
export const SERVER_CHECKPOINT_EARLY_INTERVAL_MS = 15_000;
export const SERVER_CHECKPOINT_INTERVAL_MS = 60_000;
const SERVER_CHECKPOINT_EARLY_SEGMENTS = 30;
/** 缓冲超过这么多片就不等定时器，直接落盘（1s 一片 → 8s） */
const CHUNK_FLUSH_THRESHOLD = 8;

/** 距上次服务端检查点该不该再发一次：段数少时勤一点，段数多了放慢 */
export function isServerCheckpointDue(params: { lastServerAt: number; segmentCount: number; now: number }): boolean {
  if (params.lastServerAt === 0) return true;
  const interval = params.segmentCount < SERVER_CHECKPOINT_EARLY_SEGMENTS
    ? SERVER_CHECKPOINT_EARLY_INTERVAL_MS
    : SERVER_CHECKPOINT_INTERVAL_MS;
  return params.now - params.lastServerAt >= interval;
}

export interface UseRecordingCheckpointDeps {
  isRecording: boolean;
  sessionId: string;
  userId?: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
}

export interface UseRecordingCheckpointRefs {
  /** 本次录音已定稿的实时字幕（useTranscriptHandlers 维护） */
  liveSegmentsRef: MutableRefObject<TranscriptSegment[]>;
}

interface PendingChunk {
  seq: number;
  blob: Blob;
  mimeType: string;
}

/** 字幕快照的廉价签名：段数 + 末段结束时刻 + 总字数，任一变化就重写 */
export function buildTranscriptSignature(segments: TranscriptSegment[]): string {
  let textLength = 0;
  for (const seg of segments) textLength += (seg.text || '').length;
  const last = segments[segments.length - 1];
  return `${segments.length}:${last?.endMs ?? 0}:${textLength}`;
}

function finalizedSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.filter((seg) => !seg.provisional && typeof seg.text === 'string' && seg.text.trim().length > 0);
}

export function useRecordingCheckpoint(
  deps: UseRecordingCheckpointDeps,
  refs: UseRecordingCheckpointRefs,
) {
  const { isRecording, sessionId, userId, accessToken, isAuthenticated } = deps;
  const { liveSegmentsRef } = refs;

  const pendingChunksRef = useRef<Map<string, PendingChunk[]>>(new Map());
  const mimeTypeBySessionRef = useRef<Map<string, string>>(new Map());
  const startedAtRef = useRef<number>(0);
  const activeSessionRef = useRef<string>('');
  const lastLocalSignatureRef = useRef<string>('');
  const lastServerSignatureRef = useRef<string>('');
  const lastServerAtRef = useRef<number>(0);
  const serverInFlightRef = useRef(false);
  const authRef = useRef({ accessToken, isAuthenticated, userId });
  authRef.current = { accessToken, isAuthenticated, userId };

  const elapsedMs = useCallback(() => (startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0), []);

  // ── 音频分片：先进内存缓冲，批量落盘 ──
  const flushChunks = useCallback(async (targetSessionId: string) => {
    const pending = pendingChunksRef.current.get(targetSessionId);
    if (!pending || pending.length === 0) return;
    pendingChunksRef.current.set(targetSessionId, []);
    try {
      await appendRecordingChunks(targetSessionId, pending);
    } catch (error) {
      // 落盘失败把分片放回去，下一轮再试；内存里的 Recorder 副本仍在，结束时不受影响
      const current = pendingChunksRef.current.get(targetSessionId) || [];
      pendingChunksRef.current.set(targetSessionId, [...pending, ...current]);
      console.warn('[recording-checkpoint] append chunks failed:', error);
    }
  }, []);

  const handleAudioChunk = useCallback((chunk: Blob, meta: RecorderAudioChunkMeta) => {
    if (!meta.sessionId || !chunk || chunk.size === 0) return;
    const bucket = pendingChunksRef.current.get(meta.sessionId) || [];
    bucket.push({ seq: meta.seq, blob: chunk, mimeType: meta.mimeType });
    pendingChunksRef.current.set(meta.sessionId, bucket);
    if (!mimeTypeBySessionRef.current.has(meta.sessionId)) {
      mimeTypeBySessionRef.current.set(meta.sessionId, meta.mimeType);
      void markSessionCheckpoint(meta.sessionId, { mimeType: meta.mimeType }).catch(() => undefined);
    }
    if (bucket.length >= CHUNK_FLUSH_THRESHOLD) void flushChunks(meta.sessionId);
  }, [flushChunks]);

  // ── 字幕快照 + 心跳字段 ──
  const flushLocal = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId) return;
    await flushChunks(targetSessionId);
    const segments = finalizedSegments(liveSegmentsRef.current);
    const signature = buildTranscriptSignature(segments);
    try {
      if (signature !== lastLocalSignatureRef.current && segments.length > 0) {
        await replaceSessionTranscripts(targetSessionId, authRef.current.userId || ANONYMOUS_USER_ID, segments.map((seg) => ({
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          speakerId: seg.speakerId,
          confidence: seg.confidence || 1.0,
          isFinal: true,
        })));
        lastLocalSignatureRef.current = signature;
      }
      await markSessionCheckpoint(targetSessionId, { durationMs: Math.max(elapsedMs(), segments[segments.length - 1]?.endMs || 0) });
    } catch (error) {
      console.warn('[recording-checkpoint] local flush failed:', error);
    }
  }, [elapsedMs, flushChunks, liveSegmentsRef]);

  // ── 服务端检查点（仅登录） ──
  const sendServerCheckpoint = useCallback(async (
    targetSessionId: string,
    kind: 'checkpoint' | 'heartbeat',
    options: { keepalive?: boolean; force?: boolean } = {},
  ) => {
    const auth = authRef.current;
    if (!auth.isAuthenticated || !auth.accessToken || !targetSessionId) return;
    const segments = finalizedSegments(liveSegmentsRef.current);
    const signature = buildTranscriptSignature(segments);
    if (kind === 'checkpoint' && !options.force && signature === lastServerSignatureRef.current) return;
    if (serverInFlightRef.current && !options.keepalive) return;
    serverInFlightRef.current = true;
    const duration = Math.max(elapsedMs(), segments[segments.length - 1]?.endMs || 0);
    const startedAt = startedAtRef.current > 0 ? startedAtRef.current : Date.now() - duration;
    const body = {
      sessionId: targetSessionId,
      kind,
      durationMs: duration,
      startedAt: new Date(startedAt).toISOString(),
      title: buildLiveRecordingTitle(new Date(startedAt)),
      ...(kind === 'checkpoint'
        ? {
            segments: segments.map((seg) => ({
              id: seg.id,
              text: seg.text,
              startMs: seg.startMs,
              endMs: seg.endMs,
              speakerId: seg.speakerId,
              confidence: seg.confidence,
              isFinal: true,
            })),
          }
        : {}),
    };
    try {
      const response = await fetch('/api/workspace/recording-checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify(body),
        keepalive: Boolean(options.keepalive),
      });
      if (response.ok) {
        lastServerAtRef.current = Date.now();
        if (kind === 'checkpoint') lastServerSignatureRef.current = signature;
      } else {
        console.warn('[recording-checkpoint] server rejected checkpoint:', response.status);
      }
    } catch (error) {
      console.warn('[recording-checkpoint] server checkpoint failed (will retry next tick):', error);
    } finally {
      serverInFlightRef.current = false;
    }
  }, [elapsedMs, liveSegmentsRef]);

  // ── 录音生命周期：开始时立刻打一次服务端检查点，之后定时；结束时最后 flush 一次本地 ──
  useEffect(() => {
    if (!isRecording || !sessionId) {
      const previous = activeSessionRef.current;
      if (previous) {
        // 录音已（正常）结束：最终 blob 与转录由 handleRecordingStop 落库并删分片，
        // 这里只丢掉迟到的分片缓冲，不再写任何东西，避免和结束路径的写入互相覆盖
        activeSessionRef.current = '';
        mimeTypeBySessionRef.current.delete(previous);
        pendingChunksRef.current.delete(previous);
      }
      startedAtRef.current = 0;
      lastLocalSignatureRef.current = '';
      lastServerSignatureRef.current = '';
      lastServerAtRef.current = 0;
      return;
    }

    activeSessionRef.current = sessionId;
    startedAtRef.current = Date.now();
    lastLocalSignatureRef.current = '';
    lastServerSignatureRef.current = '';
    lastServerAtRef.current = 0;
    // 开始就让服务端知道"这节课正在录"：另一台设备立刻能看到，关页也有痕迹
    void sendServerCheckpoint(sessionId, 'checkpoint', { force: true });

    const timer = window.setInterval(() => {
      void flushLocal(sessionId).then(() => {
        const segmentCount = finalizedSegments(liveSegmentsRef.current).length;
        if (isServerCheckpointDue({ lastServerAt: lastServerAtRef.current, segmentCount, now: Date.now() })) {
          void sendServerCheckpoint(sessionId, 'checkpoint', { force: lastServerAtRef.current === 0 });
        }
      });
    }, LOCAL_CHECKPOINT_INTERVAL_MS);

    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      void flushLocal(sessionId);
      void sendServerCheckpoint(sessionId, 'heartbeat', { keepalive: true });
    };
    const onPageHide = () => {
      void flushLocal(sessionId);
      void sendServerCheckpoint(sessionId, 'heartbeat', { keepalive: true });
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [isRecording, sessionId, flushLocal, sendServerCheckpoint, liveSegmentsRef]);

  return { handleAudioChunk };
}
