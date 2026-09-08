/**
 * device-outcomes — 读这台设备上按课存的会话层检验结果（review-session-outcomes 写，key 前缀 mm-review-outcomes:）。
 * 浏览器专用、只读；放在 lib 是为了 hooks 也能用（依赖方向 components → hooks → lib）。
 */

import type { AssessmentRecord } from '@/lib/learning/mastery-trail-model';

const STORAGE_PREFIX = 'mm-review-outcomes:';

export function collectDeviceOutcomes(): AssessmentRecord[] {
  if (typeof window === 'undefined') return [];
  const out: AssessmentRecord[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (item && typeof (item as AssessmentRecord).appKey === 'string' && Array.isArray((item as AssessmentRecord).items)) {
          out.push(item as AssessmentRecord);
        }
      }
    }
  } catch { /* 隐私模式或配额：没有轨迹就不显示 */ }
  return out;
}
