import { getContextConfig } from '@/lib/config/context';
import type { LearningEventInput } from '@/types/learning-event';
import type { ContextEventReceipt } from '@/types/context';
import { appendLearningEvent, triggerLearningEventProcessing } from './learning-event-service';
import { appendEducationObservation } from './context/education-adapter';

export interface LearningObservationResult {
  /** 本地事件表的一行（结构化事实：assessment → 掌握轨迹；对话类 → P0 画像蒸馏）；输入不合法为 null */
  eventId: string | null;
  /** Context 开启时的通用观察回执（原始经历 → Hindsight 整理，由 worker 投递） */
  receipt: ContextEventReceipt | null;
}

/**
 * 一条学习观察，两处落地（2026-09-09 起双写，不再二选一）：
 *
 * - `LearningEvent` 表始终写：它是结构化事实的唯一入口——assessment 事件聚成掌握轨迹（learner-context-provider），
 *   对话类事件蒸馏成 P0 画像；关掉 Context 也不影响这些读侧。
 * - Context 开启时再把同一份观察经 education-adapter 变成通用原始经历（ContextEvent），由 worker 投给 Hindsight
 *   做记忆提取与整理，供 prepare 召回——这一半承担"有来源的理解"，前一半承担"可核对的事实"。
 *
 * 只等待落库（durable acceptance），模型侧处理都在学习流之外。Context 侧失败不回滚事实表：事实先于理解。
 */
export async function recordLearningObservation(userId: string, input: LearningEventInput): Promise<LearningObservationResult> {
  const event = await appendLearningEvent(userId, input);
  if (event) void triggerLearningEventProcessing(event);
  let receipt: ContextEventReceipt | null = null;
  if (getContextConfig().enabled) {
    receipt = await appendEducationObservation(userId, input);
  }
  return { eventId: event?.id ?? null, receipt };
}
