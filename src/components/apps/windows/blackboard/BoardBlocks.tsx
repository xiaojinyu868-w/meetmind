'use client';

/**
 * BoardBlocks — teach-engine 全量词表（P3）结构化板书块的备课本粉笔风渲染。
 *
 * shape / table / line / code 都是栏内流式块（排版收归播放器：vendor 的
 * 绝对坐标不进版面，shape 只取宽高比、line 归一端点到块内包围盒）。
 * 块外包装（margin 容器）带 data-board-block：BlockAnnotation 的局部墨迹
 * 测量在这些无字块上以它为兜底（圈注框住整个块），laser 的 DOM 锚点是
 * BoardFlow 外层的 data-element-id。
 */

import type {
  BoardCodeAction,
  BoardLineAction,
  BoardShapeAction,
  BoardTableAction,
} from '@/lib/ai-native/plugins/board-script';
import { BOARD_HEIGHT, BOARD_WIDTH, PAPER, lectureFontSize } from './board-lecture';
import { BOARD_FONT } from './BoardWrite';

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
/** vendor 坐标系 → 板面虚拟像素（1000×562 → 960×540） */
const VENDOR_SX = BOARD_WIDTH / 1000;
const VENDOR_SY = BOARD_HEIGHT / 562;

export function BoardShapeBlock({ action }: { action: BoardShapeAction }) {
  const aspect =
    action.aspect && Number.isFinite(action.aspect) && action.aspect > 0
      ? Math.min(4, Math.max(0.25, action.aspect))
      : 1.6;
  return (
    <div data-board-block style={{ margin: '8px 0 10px', textAlign: 'center' }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={action.label ?? action.shape}
        style={{
          width: '56%',
          maxWidth: 240,
          aspectRatio: String(aspect),
          filter: 'url(#mm-chalk-rough)',
          overflow: 'visible',
        }}
      >
        {action.shape === 'circle' ? (
          <ellipse cx={50} cy={50} rx={46} ry={46} {...shapeStroke(action.fill)} />
        ) : action.shape === 'triangle' ? (
          <polygon points="50,5 95,95 5,95" {...shapeStroke(action.fill)} />
        ) : (
          <rect x={4} y={4} width={92} height={92} rx={5} {...shapeStroke(action.fill)} />
        )}
      </svg>
      {action.label ? (
        <div style={{ marginTop: 4, fontFamily: BOARD_FONT, fontSize: lectureFontSize('note', BOARD_HEIGHT), color: PAPER.inkSoft }}>
          {action.label}
        </div>
      ) : null}
    </div>
  );
}

/** 粉笔形描边：墨棕描边 + 浅紫底填充（fillColor 透传时尊重模型指定） */
function shapeStroke(fill?: string) {
  return {
    fill: fill ?? PAPER.accentBg,
    stroke: PAPER.ink,
    strokeWidth: 3,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinejoin: 'round' as const,
  };
}

export function BoardTableBlock({ action }: { action: BoardTableAction }) {
  const [header, ...rows] = action.data;
  const fontSize = lectureFontSize('note', BOARD_HEIGHT);
  const cellStyle: React.CSSProperties = {
    border: `1px solid rgba(46,43,38,0.35)`,
    padding: '3px 9px',
    textAlign: 'left',
    lineHeight: 1.35,
  };
  return (
    <div data-board-block style={{ margin: '8px 0 10px' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: BOARD_FONT,
          fontSize,
          color: PAPER.ink,
          background: 'rgba(255,255,255,0.45)',
        }}
      >
        {header ? (
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th key={index} style={{ ...cellStyle, background: PAPER.accentBg, fontWeight: 600 }}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={cellStyle}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BoardLineBlock({ action }: { action: BoardLineAction }) {
  const minX = Math.min(action.start.x, action.end.x);
  const minY = Math.min(action.start.y, action.end.y);
  const spanX = Math.max(4, Math.abs(action.end.x - action.start.x));
  const spanY = Math.max(4, Math.abs(action.end.y - action.start.y));
  const width = Math.min(Math.max(28, Math.round(spanX * VENDOR_SX)), 560);
  const height = Math.min(Math.max(28, Math.round(spanY * VENDOR_SY)), 280);
  const arrow = action.arrow ?? 'none';
  return (
    <div data-board-block style={{ margin: '6px 0 8px' }}>
      <svg
        viewBox={`-6 -6 ${spanX + 12} ${spanY + 12}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={action.label ?? '连线'}
        style={{ display: 'block', width, maxWidth: '100%', height, overflow: 'visible' }}
      >
        <defs>
          <marker id="mm-line-arrow" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke={PAPER.ink} strokeWidth={1.6} strokeLinecap="round" />
          </marker>
        </defs>
        <line
          x1={action.start.x - minX}
          y1={action.start.y - minY}
          x2={action.end.x - minX}
          y2={action.end.y - minY}
          stroke={PAPER.ink}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeDasharray={action.dashed ? '9 7' : undefined}
          markerStart={arrow === 'start' || arrow === 'both' ? 'url(#mm-line-arrow)' : undefined}
          markerEnd={arrow === 'end' || arrow === 'both' ? 'url(#mm-line-arrow)' : undefined}
        />
      </svg>
      {action.label ? (
        <div style={{ marginTop: 2, fontFamily: BOARD_FONT, fontSize: lectureFontSize('note', BOARD_HEIGHT), color: PAPER.inkSoft }}>
          {action.label}
        </div>
      ) : null}
    </div>
  );
}

export function BoardCodeBlock({ action }: { action: BoardCodeAction }) {
  return (
    <div
      data-board-block
      style={{
        margin: '8px 0 10px',
        border: `1.5px solid ${PAPER.hairline}`,
        borderRadius: 6,
        background: '#ffffff',
        boxShadow: '0 2px 8px rgba(80,66,40,0.10)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '4px 10px',
          borderBottom: `1px solid ${PAPER.hairline}`,
          fontFamily: MONO_FONT,
          fontSize: 12,
          color: PAPER.inkSoft,
        }}
      >
        {action.fileName ? <span>{action.fileName}</span> : null}
        <span>{action.language}</span>
      </div>
      <div
        style={{
          padding: '6px 0',
          fontFamily: MONO_FONT,
          fontSize: 13,
          lineHeight: 1.5,
          color: PAPER.ink,
        }}
      >
        {action.lines.map((line, index) => (
          <div key={line.id} style={{ display: 'flex' }}>
            <span
              aria-hidden="true"
              style={{
                width: 32,
                flexShrink: 0,
                textAlign: 'right',
                paddingRight: 10,
                color: PAPER.inkSoft,
                opacity: 0.65,
                userSelect: 'none',
              }}
            >
              {index + 1}
            </span>
            <span style={{ flex: 1, paddingRight: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {line.content || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
