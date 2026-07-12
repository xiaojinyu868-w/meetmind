/**
 * AudioSession → Lesson 适配器
 *
 * 课堂 Tab 的 UI 用的是 `Lesson` 这个视图模型，
 * 真实数据源是 IndexedDB 的 `audioSessions` 表（+ 一些关联表）。
 *
 * 这个适配器只做"折叠"——不改 schema，不引入新字段：
 *   - title       ← session.topic ?? 默认占位
 *   - durationMin ← Math.round(session.duration / 60000)
 *   - keyPoints   ← highlightTopics 的数量（异步，可选）
 *   - hasEcho     ← 暂时由调用方传入（来自 useEchoStore）
 *   - reviewed    ← AudioSession 里没有，先全部 false（未来加 preferences 持久化）
 *   - status      ← 由 transcript 段数 + session.status 综合判断：
 *                   recording / no-transcript = processing / has-transcript = ready
 *
 * 不在这里发起 IndexedDB 查询，由调用方（hook）负责拉数据然后传进来，
 * 这样保证 adapter 是纯函数，便于测试。
 */

import type { AudioSession } from '@/lib/db/schema';
import { resolvePendingAudioFailureStatus } from '@/lib/utils/page-utils';
import type { Lesson, LessonStatus } from './types';

export interface LessonExtras {
  /** 该 session 是否有转录段（>0） */
  hasTranscript: boolean;
  /** highlightTopics 的数量（用作 keyPoints） */
  highlightCount?: number;
  /** 是否有回声（来自 useEchoStore.workspaceEchoes） */
  hasEcho?: boolean;
  /** 关联预习材料数（来自 collection） */
  linkedMaterials?: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 判断一条 session 是否是"真的正在录音"还是"stale"（历史卡住的 recording 态）。
 *
 * 历史遗留问题：早期版本在录音结束时没有正确把 session.status 翻到 'completed'，
 * 或者浏览器被异常关闭导致状态卡在 recording。这些 stale session 会在 UI 上
 * 假装"正在录音"，但实际进程根本没在录——这会误导用户也误导同桌 AI。
 *
 * 防御策略：recording 态如果创建时间距今超过阈值（默认 2 小时），
 * 就认定为 stale，降级为 processing（酿造中）。
 *
 * 注意：这是 UI 层的"软修复"——只影响显示，不改底层数据。
 * 真正的数据清理可以通过复习界面或后台 job 完成。
 */
const STALE_RECORDING_AFTER_MS = 2 * 60 * 60 * 1000; // 2 小时
const STALE_TRANSCRIPTION_AFTER_MS = 45 * 60 * 1000; // 45 分钟：长音频也不应无限“整理中”

function isStaleRecording(session: AudioSession): boolean {
  if (session.status !== 'recording') return false;
  const createdAt = session.createdAt instanceof Date
    ? session.createdAt
    : new Date(session.createdAt);
  const ageMs = Date.now() - createdAt.getTime();
  return ageMs > STALE_RECORDING_AFTER_MS;
}

function getSessionUpdatedAtMs(session: AudioSession): number {
  const updatedAt = session.updatedAt instanceof Date
    ? session.updatedAt
    : new Date(session.updatedAt || session.createdAt);
  const value = updatedAt.getTime();
  return Number.isFinite(value) ? value : 0;
}

function hasRecoverableAudio(session: AudioSession): boolean {
  return Boolean(session.blob || session.mediaUrl);
}

function isStaleTranscription(session: AudioSession): boolean {
  if (session.status !== 'completed') return false;
  if (session.transcriptionStatus === 'pending') return Date.now() - getSessionUpdatedAtMs(session) > STALE_TRANSCRIPTION_AFTER_MS;
  if (session.transcriptionStatus) return false;
  return Date.now() - getSessionUpdatedAtMs(session) > STALE_TRANSCRIPTION_AFTER_MS;
}

function deriveStatus(
  session: AudioSession,
  hasTranscript: boolean,
): LessonStatus {
  if (hasTranscript || session.transcriptionStatus === 'completed') return 'ready';
  if (session.transcriptionStatus === 'failed') return 'failed';
  if (isStaleTranscription(session)) return 'failed';
  // 防御：recording 但创建时间很久以前 → 视为 stale，降级为 processing
  if (session.status === 'recording' && isStaleRecording(session)) {
    return 'processing';
  }
  if (session.status === 'recording') return 'recording';
  // 录完了但还没有转录段 → 酿造中
  return 'processing';
}

function deriveStatusText(session: AudioSession, status: LessonStatus): string | undefined {
  if (status !== 'failed') return undefined;
  if (session.transcriptionStatus === 'failed') {
    return resolvePendingAudioFailureStatus(session.transcriptionError || '');
  }
  if (!hasRecoverableAudio(session)) return '没有留下可用内容';
  return resolvePendingAudioFailureStatus(session.transcriptionError || '');
}

function deriveTitle(session: AudioSession): string {
  if (session.topic && session.topic.trim()) return session.topic;
  // fallback：用创建时间生成"X 月 X 日 X 点录的课"
  const d = session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日的课`;
}

export function audioSessionToLesson(
  session: AudioSession,
  extras: LessonExtras,
): Lesson {
  const created = session.createdAt instanceof Date
    ? session.createdAt
    : new Date(session.createdAt);

  const durationMin = session.duration > 0
    ? Math.max(1, Math.round(session.duration / 60000))
    : undefined;

  const status = deriveStatus(session, extras.hasTranscript);

  return {
    id: session.sessionId,
    title: deriveTitle(session),
    date: formatDate(created),
    time: formatTime(created),
    durationMin: status === 'recording' ? undefined : durationMin,
    keyPoints: extras.highlightCount && extras.highlightCount > 0
      ? extras.highlightCount
      : undefined,
    hasEcho: extras.hasEcho ?? false,
    reviewed: false, // TODO: 接 preferences 表持久化
    linkedMaterials: extras.linkedMaterials,
    status,
    statusText: deriveStatusText(session, status),
  };
}
