'use client';

/**
 * BoardFlow — v31 讲义流式内容区（从 BoardCanvas 拆出，行数限制）。
 *
 * 页首 title 通栏 + 一页两栏（栏内从上到下浏览器原生 flow 追加）；
 * 单个块的三态：write 逐字接力（BoardWrite）/ formula 整块淡入（BoardFormula
 * KaTeX）/ image 内嵌插图（BoardImage）。溢出收缩的 transform 与栏满检测的
 * 栏 ref 由父组件持有（测量 effect 在 BoardCanvas）。
 */

import type { BoardAction } from '@/lib/ai-native/plugins/board-script';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  COLUMN_GAP,
  PAD_BOTTOM,
  PAD_TOP,
  PAD_X,
  fitTitleFontSize,
  lectureFontSize,
  roleBlockStyle,
} from './board-lecture';
import type { ExtraWrite, LectureFlow, LectureFlowItem } from './board-lecture';
import { estimateWriteMs, paceScaleFor } from './board-model';
import { BoardWrite } from './BoardWrite';
import { BoardFormula } from './BoardFormula';
import { BoardImage } from './BoardImage';

/** 流式内容项：write/image 成块；new_column 折成分栏标记；标注不进流 */
export interface FlowItem extends LectureFlowItem {
  action?: BoardAction;
  extra?: ExtraWrite;
}

interface BoardFlowProps {
  flow: LectureFlow<FlowItem>;
  /** write key → wN（标注 DOM 实测锚点） */
  writeIdByKey: Map<string, string>;
  doneWrites: ReadonlySet<string>;
  activeWriteKey: string | null;
  instant: boolean;
  paused: boolean;
  /** v9 音画同步：动作 key → 书写时间窗预算 ms */
  budgets?: Record<string, number>;
  fontFamily?: string;
  /**
   * v32 事件流画布（/teach）：书写倍率直接乘进 paceScale（绕过 0.7 钳制）。
   * 无 TTS 的场景按生成流速显现（如 0.3 ≈ 55ms/字），默认 1 不变。
   */
  writePaceScale?: number;
  onWriteDone: (key: string) => void;
  /** 内容溢出收缩比例（父组件测量后下发） */
  flowScale: number;
  flowViewportRef: React.RefObject<HTMLDivElement>;
  flowContentRef: React.RefObject<HTMLDivElement>;
  firstColumnRef: React.RefObject<HTMLDivElement>;
}

export function BoardFlow({
  flow,
  writeIdByKey,
  doneWrites,
  activeWriteKey,
  instant,
  paused,
  budgets,
  fontFamily,
  writePaceScale = 1,
  onWriteDone,
  flowScale,
  flowViewportRef,
  flowContentRef,
  firstColumnRef,
}: BoardFlowProps) {
  /** 单个流式块（write / formula / image / checkpoint 追加 write）渲染 */
  const renderFlowItem = (item: FlowItem) => {
    const action: BoardAction = item.extra
      ? { type: 'write', text: item.extra.text, role: item.extra.role }
      : (item.action as BoardAction);
    if (action.type === 'image') return <BoardImage key={item.key} action={action} />;
    if (action.type !== 'write') return null;
    const role = action.role;
    const active = instant || doneWrites.has(item.key) || activeWriteKey === item.key;
    // v31 块级公式：LaTeX → KaTeX（整块淡入，不走逐字接力）
    if (role === 'formula') {
      return (
        <div key={item.key} style={roleBlockStyle(role, BOARD_WIDTH, BOARD_HEIGHT)}>
          <BoardFormula
            latex={action.text}
            fontSize={lectureFontSize('formula', BOARD_HEIGHT)}
            writeId={writeIdByKey.get(item.key)}
            active={active}
            onDone={() => onWriteDone(item.key)}
            instant={instant}
            paused={paused}
          />
        </div>
      );
    }
    return (
      <div key={item.key} style={roleBlockStyle(role, BOARD_WIDTH, BOARD_HEIGHT)}>
        <BoardWrite
          action={action}
          flowFontSize={
            role === 'title'
              ? fitTitleFontSize(action.text, BOARD_WIDTH, BOARD_HEIGHT)
              : lectureFontSize(role, BOARD_HEIGHT)
          }
          writeId={writeIdByKey.get(item.key)}
          active={active}
          onDone={() => onWriteDone(item.key)}
          fontFamily={fontFamily}
          instant={instant}
          paused={paused}
          paceScale={
            (item.extra
              ? 1
              : paceScaleFor(action, budgets?.[item.key] ?? estimateWriteMs(action.text, role))) *
            writePaceScale
          }
        />
      </div>
    );
  };

  return (
    <div
      ref={flowViewportRef}
      style={{
        position: 'absolute',
        inset: 0,
        padding: `${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        ref={flowContentRef}
        style={
          flowScale !== 1
            ? { transform: `scale(${flowScale})`, transformOrigin: '0 0' }
            : undefined
        }
      >
        {flow.header.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {flow.header.map(renderFlowItem)}
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: COLUMN_GAP }}>
          {flow.columns.map((columnItems, columnIndex) => (
            <div
              key={columnIndex}
              ref={columnIndex === 0 ? firstColumnRef : undefined}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {columnItems.map(renderFlowItem)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
