/**
 * CollectionEmptyState — 收集为空时的引导页 v6
 *
 * 所有动作都在底部输入栏完成；空状态只建立“随手留下”的心智，
 * 不再重复列举录音、链接和文件，也不把收集误写成课堂专属入口。
 *
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）
 */

'use client';

import { COPY } from '@/lib/ui/copy';

// ==================== 组件实现 ====================

export function CollectionEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6" style={{ paddingTop: '22vh' }}>
      <p className="text-[16px] font-medium tracking-[-0.01em] text-ink-secondary">
        {COPY.collection.emptyTitle}
      </p>
    </div>
  );
}
