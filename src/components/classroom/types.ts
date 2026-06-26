/**
 * Classroom 子模块共享类型
 *
 * 围绕「一节课」为单位的数据模型。
 * 一节课有三种时态：课前（预习）、课中（录音中）、课后（已理解）。
 */

import type { AppExecutionResult } from '@/lib/ai-native/types';

export type LessonStatus =
  | 'upcoming'    // 课前：排在日程里，还没开始
  | 'recording'   // 课中：正在录音
  | 'processing'  // 课后-酿造中：录完了，AI 正在理解
  | 'failed'      // 课后-转写失败：原声已保留，但没有可用文字
  | 'ready';      // 课后-已理解：可以复习了

export interface Lesson {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  /** 时长（分钟），课前状态可为 undefined */
  durationMin?: number;
  /** AI 提取的重点数，处理中 = undefined */
  keyPoints?: number;
  /** 是否已生成回声卡 */
  hasEcho: boolean;
  /** 是否复习过 */
  reviewed: boolean;
  /** 关联的预习资料数（来自「收集」tab） */
  linkedMaterials?: number;
  status: LessonStatus;
  /** 转写失败/兜底态的短说明 */
  statusText?: string;
}

/** 左侧面板的视图态 */
export type ClassroomPaneState = 'list' | 'recording';

/** 右侧同桌面板的消息类型 */
export type CompanionMessageRole = 'companion' | 'user';

export interface CompanionMessage {
  id: string;
  role: CompanionMessageRole;
  content: string;
  /** 可选的"来源"标注，让消息"有根" */
  source?: string;
  /** 可选的附带卡片（比如课前要点） */
  card?: CompanionCard;
  /**
   * 可选的时间戳引用——AI 基于课堂原文作答时指出的证据片段。
   * 由 companion-markdown-utils.extractCitationsFromMarkdown 从 [MM:SS] 标记里抽出。
   * 当前 UI 不渲染（课堂场景禁止时间戳），但数据留在 message 对象里，
   * 未来复习态可以拿出来用。
   */
  citations?: Array<{ startMs: number; endMs: number; label: string }>;
  /**
   * 可选的"内联动作"——让同学气泡自己带一两个 CTA。
   * 典型：停止录音时的"这节课听完了"气泡 → [整速查表] [看转录]。
   */
  actions?: Array<{
    label: string;
    kind: 'open_app' | 'focus_transcript' | 'say';
    /** open_app: appKey; focus_transcript: 无；say: utterance */
    payload?: string;
  }>;
  /**
   * 可选的"内联应用产物"——chip 点"考我一下"、"做闪卡"、"整速查表"等
   * 本应该打开 WorkshopWindow 的动作，在课堂 listening 态改为把产物直接
   * 渲染进对话流。不再弹窗打断用户上课的注意力。
   *
   * status=loading：还在生成中，显示三阶段骨架
   * status=ready  ：生成完毕，result 是完整 AppExecutionResult；payload 仅兼容旧缓存
   * status=error  ：失败，error 是人话描述
   */
  inlineApp?: {
    appKey: 'quiz' | 'flashcards' | 'cheatsheet' | 'mindmap';
    status: 'loading' | 'ready' | 'error';
    /** 生成完毕时的完整应用执行结果，直接交给应用矩阵 UI 渲染 */
    result?: AppExecutionResult;
    /** 兼容旧消息：原插件 render.payload */
    payload?: unknown;
    /** 失败时的人话描述 */
    error?: string;
  };
  createdAt: number;
}

export interface CompanionCard {
  type: 'pre-class-brief' | 'live-concept' | 'echo-preview';
  title: string;
  lines: string[];
}
