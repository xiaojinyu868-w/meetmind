/**
 * Tutor 偏好（同桌对话框）
 *
 * 设计哲学：默认就是产品判断的"对的样子"，不在主舞台让用户做产品决策；
 * 但**保留高级用户的覆盖权利**——所有偏好都在设置页里可调。
 *
 * 偏好两条：
 *  - showTimestamps：AI 回答里是否附 [MM:SS] 可点击时间戳。
 *    默认 true——这是 MeetMind 的「有根」承诺：每句话都能指回真实原件。
 *
 *  - thinkingGuide：AI 是否主动展示推理过程。
 *    默认 false——把"该不该展开思考"的判断权留给模型本身，
 *    依内容复杂度自然展开（Bitter Lesson）。强制开启的高级用户才走 true。
 *
 * 为什么单独抽出来：和 ai-model-preference.ts 同一类——都是只读型偏好；
 * 走 IndexedDB（@/lib/db getPreference/setPreference），跨页面共享。
 */

export const TUTOR_SHOW_TIMESTAMPS_KEY = 'settings_tutor_show_timestamps';
export const TUTOR_THINKING_GUIDE_KEY = 'settings_tutor_thinking_guide';

export interface TutorPreferences {
  /** 复习态 AI 回答里是否附 [MM:SS] chip。默认 true。 */
  showTimestamps: boolean;
  /** AI 是否主动展开推理过程。默认 false（让模型按问题复杂度自己判断）。 */
  thinkingGuide: boolean;
}

export const TUTOR_PREFERENCES_DEFAULT: TutorPreferences = {
  showTimestamps: true,
  thinkingGuide: false,
};

/** 从 IndexedDB 读到的原始字符串值解析为 boolean，缺失/异常时取默认。 */
export function parseTutorBooleanPreference(
  raw: string | null | undefined,
  fallback: boolean,
): boolean {
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  return fallback;
}

export function serializeTutorBooleanPreference(value: boolean): string {
  return value ? 'true' : 'false';
}
