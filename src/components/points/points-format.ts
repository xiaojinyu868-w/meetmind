/**
 * points-format — 积分流水的展示格式化（PointsChip / PointsSettingsSection 共用）
 */

import { COPY } from '@/lib/ui/copy';

/** 流水的 reason → 人类可读文案。后端真扣费流水带功能前缀（如 tutor:review / apps:quiz），映射时取冒号前的主类 */
export function pointsReasonLabel(reason: string): string {
  const labels = COPY.points.reasonLabels as Record<string, string>;
  const mainKind = reason.split(':')[0];
  return labels[reason] || labels[mainKind] || COPY.points.reasonFallback;
}

/** 流水时间：M月D日 HH:mm；非法日期返回空串（调用方不渲染） */
export function formatPointsRecordTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
