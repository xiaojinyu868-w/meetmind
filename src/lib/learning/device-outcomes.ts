/**
 * device-outcomes — 读这台设备上按课存的会话层检验结果（review-session-outcomes 写，key 前缀 mm-review-outcomes:）。
 * 浏览器专用、只读；放在 lib 是为了 hooks 也能用（依赖方向 components → hooks → lib）。
 *
 * 2026-09-11 起每条记录带上它所属的 sessionId（从 key 里取回）：本机切片据此给每个概念标"证据在哪节课"，
 * prompt 里才能分清「本课」检验过的与别的课的；闪卡到期模型也按它知道一张卡是哪节课的。
 */

import type { AssessmentRecord } from '@/lib/learning/mastery-trail-model';

const STORAGE_PREFIX = 'mm-review-outcomes:';

/**
 * 本机会话层结果写入后广播的 window 事件名（review-session-outcomes 发；useFlashcardsReview 等读方听）。
 * 字符串契约，改名要找全两边。
 */
export const OUTCOMES_UPDATED_EVENT = 'meetmind:outcomes-updated';

export type DeviceAssessmentRecord = AssessmentRecord & { sessionId: string };

export function collectDeviceOutcomes(): DeviceAssessmentRecord[] {
  if (typeof window === 'undefined') return [];
  const out: DeviceAssessmentRecord[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      const sessionId = key.slice(STORAGE_PREFIX.length);
      for (const item of parsed) {
        if (item && typeof (item as AssessmentRecord).appKey === 'string' && Array.isArray((item as AssessmentRecord).items)) {
          out.push({ ...(item as AssessmentRecord), sessionId });
        }
      }
    }
  } catch { /* 隐私模式或配额：没有轨迹就不显示 */ }
  return out;
}
