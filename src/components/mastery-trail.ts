/**
 * mastery-trail — 「我的上下文」掌握轨迹的组件侧入口（纯 re-export）。
 *
 * 模型在 lib/learning/mastery-trail-model.ts（客户端与服务端共用同一份规则），本机读取在 lib/learning/device-outcomes.ts，
 * 本机 + 服务端合并由 hooks/useMasteryTrail 负责（登录用户换设备也看到同一个自己）。这里保留既有 import 路径。
 */

export {
  buildMasteryTrail,
  isNegativeOutcome,
  mergeMasteryTrails,
  trailFromLearnerMastery,
  type AssessmentRecord,
  type MasteryStatus,
  type MasteryStep,
  type MasteryTrailEntry,
} from '@/lib/learning/mastery-trail-model';
export { collectDeviceOutcomes } from '@/lib/learning/device-outcomes';
// 概念展示名统一在 lib/utils/concept-label（课后路径的推荐理由也用它）；这里 re-export 供既有消费方
export { conceptLabel } from '@/lib/utils/concept-label';
