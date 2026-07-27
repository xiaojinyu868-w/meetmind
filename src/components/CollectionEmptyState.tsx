/**
 * CollectionEmptyState — 收集为空时的空态
 *
 * 所有动作都在底部输入栏完成；空状态只建立“随手留下”的心智：
 * 一句心智 + 六种可收类型轻提示 + 微信次入口文案。
 *
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）
 */

'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { COPY } from '@/lib/ui/copy';

// ==================== 组件实现 ====================

export function CollectionEmptyState() {
  return (
    <div className="px-6" style={{ paddingTop: '14vh' }}>
      <EmptyState
        bordered={false}
        compact
        mood="listening"
        title={COPY.collection.emptyTitle}
        description={COPY.collection.emptyBody}
        secondaryAction={COPY.collection.emptyWechatHint}
        className="bg-transparent"
      >
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
          {COPY.collection.emptyTypes.map((typeLabel) => (
            <span
              key={typeLabel}
              className="rounded-full bg-paper-warm px-2.5 py-1 font-mono text-[10.5px] text-ink-secondary"
            >
              {typeLabel}
            </span>
          ))}
        </div>
      </EmptyState>
    </div>
  );
}
