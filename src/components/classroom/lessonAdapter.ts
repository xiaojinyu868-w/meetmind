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

function deriveStatus(
  session: AudioSession,
  hasTranscript: boolean,
): LessonStatus {
  if (session.status === 'recording') return 'recording';
  // 录完了但还没有转录段 → 酿造中
  if (!hasTranscript) return 'processing';
  return 'ready';
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
  };
}
