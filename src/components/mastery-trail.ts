/**
 * mastery-trail — 「我的上下文」里的掌握轨迹（本机数据读取 + 模型 re-export）。
 *
 * 纯模型在 lib/learning/mastery-trail-model.ts（客户端与服务端共用同一份规则：
 * 服务端 learner-context-provider 用同样的函数把 LearningEvent 表里的检验事件聚成轨迹）。
 * 这里只剩浏览器侧的事：扫这台设备上按课存的会话层结果（review-session-outcomes）。
 *
 * 数据边界：访客只有本机；登录用户的检验也写进服务端事件表（useAppLearningActivity.recordAssessment），
 * 所以换设备后掌握轨迹由服务端切片供给（LearnerContext.source = 'server'）。
 */

import type { StoredAssessment } from '@/components/apps/review-session-outcomes';

export {
  buildMasteryTrail,
  isNegativeOutcome,
  type AssessmentRecord,
  type MasteryStatus,
  type MasteryStep,
  type MasteryTrailEntry,
} from '@/lib/learning/mastery-trail-model';
// 概念展示名统一在 lib/utils/concept-label（课后路径的推荐理由也用它）；这里 re-export 供既有消费方
export { conceptLabel } from '@/lib/utils/concept-label';

const STORAGE_PREFIX = 'mm-review-outcomes:';

/** 扫这台设备上所有课的会话层结果（只读）。 */
export function collectDeviceOutcomes(): StoredAssessment[] {
  if (typeof window === 'undefined') return [];
  const out: StoredAssessment[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (item && typeof (item as StoredAssessment).appKey === 'string' && Array.isArray((item as StoredAssessment).items)) {
          out.push(item as StoredAssessment);
        }
      }
    }
  } catch { /* 隐私模式或配额：没有轨迹就不显示 */ }
  return out;
}
