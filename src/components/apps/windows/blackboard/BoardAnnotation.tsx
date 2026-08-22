'use client';

/**
 * BoardAnnotation — 标注渲染（circle / underline / arrow / mark）。
 *
 * bounds 走 annotation-measure 实测（目标 write 写完、DOM 稳定后），
 * 预估算 fallback；勾/叉落目标右肩；arrow 端点裁剪到区域边缘不压字。
 */

import type { BoardAction } from '@/lib/ai-native/plugins/board-script';
import { resolveTargetRect } from './board-layout';
import { hashSeed } from './board-model';
import type { BoardPageLayout } from './board-layout';
import type { Rect } from './board-model';
import { CINNABAR, RoughStroke } from './RoughStroke';
import { MeasuredTarget, measureTargetRect } from './annotation-measure';

function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** 从 rect 中心朝 toward 方向走到边缘（略出一点），箭头不压字。 */
function edgePoint(rect: Rect, toward: { x: number; y: number }): { x: number; y: number } {
  const center = centerOf(rect);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scaleX = dx !== 0 ? rect.width / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = dy !== 0 ? rect.height / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(scaleX, scaleY) + 0.1;
  return { x: center.x + dx * t, y: center.y + dy * t };
}

interface BoardAnnotationProps {
  action: BoardAction;
  /** v29 流式画布后可选：仅作 DOM 实测失败时的预估算 fallback（不传则只信实测） */
  layout?: BoardPageLayout;
  /** v29 流式画布：内容溢出收缩比例（实测坐标补偿 + 变化时重测） */
  flowScale?: number;
  /** v32 标注跟随：内容纪元（write 生长/KaTeX 排版/换栏/收缩都会 bump），变化即重测 */
  epoch?: number;
  boardRef: React.RefObject<HTMLDivElement | null>;
  labelFont: string;
  /** 板面虚拟宽度（mark 右肩越界钳制用） */
  boardWidth?: number;
  /** ?debug=bounds：把实测 rect 用细线框画出来 */
  debug?: boolean;
}

export function BoardAnnotation({ action, layout, flowScale, epoch, boardRef, labelFont, boardWidth = 960, debug = false }: BoardAnnotationProps) {
  switch (action.type) {
    case 'circle':
      return (
        <MeasuredTarget debug={debug} target={action.target} layout={layout} flowScale={flowScale} epoch={epoch} boardRef={boardRef}>
          {(rect) => (
            <RoughStroke
              kind="circle"
              rect={{ x: rect.x - 8, y: rect.y - 6, width: rect.width + 16, height: rect.height + 12 }}
              seed={hashSeed(`circle:${String(action.target)}`)}
              durationMs={480}
            />
          )}
        </MeasuredTarget>
      );
    case 'underline':
      return (
        <MeasuredTarget debug={debug} target={action.target} layout={layout} flowScale={flowScale} epoch={epoch} boardRef={boardRef}>
          {(rect) => (
            <RoughStroke
              kind="underline"
              rect={rect}
              seed={hashSeed(`underline:${String(action.target)}`)}
              durationMs={360}
            />
          )}
        </MeasuredTarget>
      );
    case 'arrow':
      return (
        <MeasuredTarget debug={debug} target={[action.from, action.to]} layout={layout} flowScale={flowScale} epoch={epoch} boardRef={boardRef}>
          {() => {
            const fromRect =
              (boardRef.current ? measureTargetRect(boardRef.current, action.from) : null) ??
              (layout ? resolveTargetRect(action.from, layout) : null);
            const toRect =
              (boardRef.current ? measureTargetRect(boardRef.current, action.to) : null) ??
              (layout ? resolveTargetRect(action.to, layout) : null);
            if (!fromRect || !toRect) return null;
            const from = edgePoint(fromRect, centerOf(toRect));
            const to = edgePoint(toRect, centerOf(fromRect));
            return (
              <span>
                <RoughStroke
                  kind="arrow"
                  rect={{
                    x: Math.min(from.x, to.x),
                    y: Math.min(from.y, to.y),
                    width: Math.abs(to.x - from.x) || 1,
                    height: Math.abs(to.y - from.y) || 1,
                  }}
                  from={from}
                  to={to}
                  seed={hashSeed(`arrow:${action.from}>${action.to}`)}
                  durationMs={420}
                />
                {action.label ? (
                  <span
                    className="mm-chalk-char absolute"
                    style={{
                      left: (from.x + to.x) / 2 + 12,
                      // 标签垂直居中在箭头缝（两个 write 块之间的空隙）里——
                      // 原 -24 偏移在短箭头时会把标签压进目标文字（实测 "说明" 叠在 "Jane Bond" 上）
                      top: (from.y + to.y) / 2 - 8,
                      color: CINNABAR,
                      fontSize: 17,
                      fontFamily: labelFont,
                    }}
                  >
                    {action.label}
                  </span>
                ) : null}
              </span>
            );
          }}
        </MeasuredTarget>
      );
    case 'mark':
      return (
        <MeasuredTarget debug={debug} target={action.target} layout={layout} flowScale={flowScale} epoch={epoch} boardRef={boardRef}>
          {(rect) => {
            // 勾/叉落在目标文字实测包围盒的右肩（右侧 +10px、垂直居中）
            const markSize = Math.min(rect.height * 0.95, 46);
            return (
              <RoughStroke
                kind={action.mark}
                rect={{
                  x: Math.min(rect.x + rect.width + 10, boardWidth - markSize - 16),
                  y: rect.y + rect.height / 2 - markSize / 2,
                  width: markSize,
                  height: markSize,
                }}
                seed={hashSeed(`mark:${action.mark}:${action.target}`)}
                durationMs={320}
              />
            );
          }}
        </MeasuredTarget>
      );
    default:
      return null;
  }
}
