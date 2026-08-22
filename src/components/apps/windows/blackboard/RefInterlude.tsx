'use client';

/**
 * RefInterlude — ref 跨页引用插播（AmIWrite 多页画布回看）。
 *
 * 触发时：淡出当前页 → 目标页最终态直接呈现（不重放动画）→ 目标 write
 * 外圈 rough 脉冲高亮（呼吸 2 次 ~1.2s）→ 停留后由父级关闭淡回。
 * 播放器主线 timeline 不受影响（父级负责暂停/恢复）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardPage } from '@/lib/ai-native/plugins/board-script';
import { hashSeed } from './board-model';
import type { Rect } from './board-model';
import { measureWriteGlyphRect } from './annotation-measure';
import { BoardCanvas } from './BoardCanvas';
import { RoughStroke } from './RoughStroke';

interface RefInterludeProps {
  page: BoardPage;
  /** 目标 write 序号（'w3'） */
  target: string;
  fontFamily?: string;
}

export function RefInterlude({ page, target, fontFamily }: RefInterludeProps) {
  // 目标页全部动作 key（最终态呈现）
  const allTriggered = useMemo(() => {
    const keys: string[] = [];
    page.segments.forEach((segment, segmentIndex) => {
      if (segment.type === 'checkpoint') return;
      segment.actions.forEach((action, actionIndex) => {
        if (action.type !== 'pause') keys.push(`s${segmentIndex}a${actionIndex}`);
      });
    });
    return keys;
  }, [page]);

  // v29 流式画布：脉冲高亮圈也走 DOM 实测（与 BoardCanvas 流式排版一致，
  // 不再用旧布局引擎预估算——两套排版必然漂移）
  const hostRef = useRef<HTMLDivElement>(null);
  const [pulseRect, setPulseRect] = useState<Rect | null>(null);
  useEffect(() => {
    let alive = true;
    const measure = () => {
      const board = hostRef.current?.querySelector('[data-board-inner]');
      if (!(board instanceof HTMLDivElement) || !alive) return;
      const rect = measureWriteGlyphRect(board, target);
      if (rect) setPulseRect(rect);
    };
    const frame = requestAnimationFrame(measure);
    const retry = setTimeout(measure, 300); // instant 渲染 + 字体 swap 后复测
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      clearTimeout(retry);
    };
  }, [target, page]);

  return (
    <div
      ref={hostRef}
      className="mm-ref-interlude"
      style={{ position: 'absolute', inset: 0, zIndex: 6, background: '#10181b' }}
    >
      <BoardCanvas
        page={page}
        pageIndex={-1}
        triggered={allTriggered}
        fontFamily={fontFamily}
        instant
      />
      {pulseRect ? (
        <div className="mm-ref-pulse" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <RoughStroke
            kind="circle"
            rect={{
              x: pulseRect.x - 10,
              y: pulseRect.y - 8,
              width: pulseRect.width + 20,
              height: pulseRect.height + 16,
            }}
            seed={hashSeed(`ref:${target}`)}
            durationMs={300}
          />
        </div>
      ) : null}
      <style>{`
        .mm-ref-interlude { animation: mm-ref-in 0.35s ease-out; }
        @keyframes mm-ref-in { from { opacity: 0; } to { opacity: 1; } }
        .mm-ref-pulse { animation: mm-ref-pulse 0.6s ease-in-out 2; }
        @keyframes mm-ref-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
