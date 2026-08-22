'use client';

/**
 * StudentInkLayer — 学生板演层。
 *
 * 「板演」开启后覆盖板面：pointer 事件采集笔画，粉笔蓝 #9EC5E8 渲染为
 * 带粉笔滤镜的手绘 polyline（与粉笔白板书、朱砂标注视觉区分）。
 * 「擦掉重写」清空；「写完了」由父级关层并恢复播放；换页由父级清空。
 */

import { useRef, useState } from 'react';
import { hashSeed } from './board-model';

export const INK_BLUE = '#9EC5E8';

export interface InkStroke {
  seed: number;
  points: string; // "x1,y1 x2,y2 …"（960×540 虚拟坐标）
}

interface StudentInkLayerProps {
  strokes: InkStroke[];
  onStrokeAdd(stroke: InkStroke): void;
}

/** 静态笔迹层（无采集）：批改后学生的字留在板上，勾叉落在旁边才有意义。 */
export function StaticInkLayer({ strokes }: { strokes: InkStroke[] }) {
  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 4, pointerEvents: 'none' }}
      viewBox="0 0 960 540"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <filter id="mm-chalk-ink-static" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="5" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8" />
        </filter>
      </defs>
      <g filter="url(#mm-chalk-ink-static)">
        {strokes.map((stroke) => (
          <polyline
            key={stroke.seed}
            points={stroke.points}
            fill="none"
            stroke={INK_BLUE}
            strokeWidth={3.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.92}
          />
        ))}
      </g>
    </svg>
  );
}

export function StudentInkLayer({ strokes, onStrokeAdd }: StudentInkLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<InkStroke | null>(null);
  const drawingRef = useRef<Array<[number, number]> | null>(null);

  const toVirtual = (event: React.PointerEvent): [number, number] => {
    const box = hostRef.current!.getBoundingClientRect();
    return [
      ((event.clientX - box.x) / box.width) * 960,
      ((event.clientY - box.y) / box.height) * 540,
    ];
  };

  const serialize = (points: Array<[number, number]>) =>
    points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <div
      ref={hostRef}
      style={{ position: 'absolute', inset: 0, zIndex: 4, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawingRef.current = [toVirtual(event)];
        setDraft({ seed: hashSeed(String(event.pointerId) + String(event.timeStamp)), points: '' });
      }}
      onPointerMove={(event) => {
        if (!drawingRef.current) return;
        drawingRef.current.push(toVirtual(event));
        setDraft((prev) => (prev ? { ...prev, points: serialize(drawingRef.current!) } : prev));
      }}
      onPointerUp={() => {
        if (drawingRef.current && drawingRef.current.length > 1 && draft) {
          onStrokeAdd({ ...draft, points: serialize(drawingRef.current) });
        }
        drawingRef.current = null;
        setDraft(null);
      }}
    >
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 960 540" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <filter id="mm-chalk-ink" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="5" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8" />
          </filter>
        </defs>
        <g filter="url(#mm-chalk-ink)">
          {[...strokes, ...(draft && draft.points ? [draft] : [])].map((stroke) => (
            <polyline
              key={stroke.seed}
              points={stroke.points}
              fill="none"
              stroke={INK_BLUE}
              strokeWidth={3.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.92}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
