'use client';

/**
 * TeachBoard — /teach 页左侧画布：备课本讲义（BoardCanvas v32）+
 * 划线引用提问浮层。
 *
 * - 直播态：事件流驱动，动作逐个上板（逐 token 显现接力）
 * - 历史恢复：instant 直出终态（无书写动画）
 * - 划线：useTextSelection 监听容器内选区 → QuoteAskPopover → onQuote
 */

import { useMemo, useRef } from 'react';
import type { BoardPage } from '@/lib/ai-native/plugins/board-script';
import { BoardCanvas } from '@/components/apps/windows/blackboard/BoardCanvas';
import { flattenPage } from '@/components/apps/windows/blackboard/board-lecture';
import { useTextSelection } from '@/hooks/useTextSelection';
import { QuoteAskPopover } from './QuoteAskPopover';

interface TeachBoardProps {
  page: BoardPage;
  pageIndex: number;
  /** 历史恢复：最终态直接呈现 */
  instant?: boolean;
  /** 冷启动备课态（首个动作未上板前） */
  preparing?: boolean;
  /** 划线引用提问：选中文本进输入框引用块 */
  onQuote: (text: string) => void;
  /** 书写倍率（事件流画布无 TTS：按生成流速显现，如 0.3 ≈ 55ms/字） */
  writePaceScale?: number;
}

export function TeachBoard({ page, pageIndex, instant = false, preparing = false, onQuote, writePaceScale }: TeachBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { selection, clearSelection } = useTextSelection(containerRef);

  // 全部动作即触发（事件流到达即上板，书写节奏由 BoardWrite 接力控制）
  const triggered = useMemo(() => flattenPage(page).map(({ key }) => key), [page]);

  return (
    <div ref={containerRef} className="w-full select-text">
      <BoardCanvas
        page={page}
        pageIndex={pageIndex}
        triggered={triggered}
        instant={instant}
        preparing={preparing}
        writePaceScale={writePaceScale}
      />
      {selection ? (
        <QuoteAskPopover selection={selection} onQuote={onQuote} onDismiss={clearSelection} />
      ) : null}
    </div>
  );
}
