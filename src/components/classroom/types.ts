/**
 * Classroom 子模块共享类型
 *
 * 围绕「一节课」为单位的数据模型。
 * 一节课有三种时态：课前（预习）、课中（录音中）、课后（已理解）。
 */

export type LessonStatus =
  | 'upcoming'    // 课前：排在日程里，还没开始
  | 'recording'   // 课中：正在录音
  | 'processing'  // 课后-酿造中：录完了，AI 正在理解
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
  createdAt: number;
}

export interface CompanionCard {
  type: 'pre-class-brief' | 'live-concept' | 'echo-preview';
  title: string;
  lines: string[];
}
