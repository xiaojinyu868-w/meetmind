'use client';

/**
 * TranscriptDrift — 等待态的"有根"部分：这节课真实的原话按时间顺序缓缓掠过。
 *
 * 为什么：应用生成要 10-40 秒。一只静止的章鱼 + 秒数只是"在等"；而学生看到的是
 * 自己这节课的句子——带 [MM:SS] 朱批时间戳——从头到尾被翻过一遍，等待就变成了
 * "它在读的是我的课"。这不是假进度条：不声称模型读到了哪一句，只把材料本身可视化。
 *
 * 行为：
 *   - 从整节课均匀取样 ≤ 24 句（长课也能看见"从开头翻到结尾"），每 1.8s 推进一句
 *   - 三行窗口：最新一句实色，上两句渐淡上移；容器定高，不引起布局抖动
 *   - prefers-reduced-motion：不轮播，静态显示开头三句
 */

import * as React from 'react';

export interface DriftLine {
  text: string;
  startMs: number;
}

interface TranscriptDriftProps {
  transcript: ReadonlyArray<DriftLine>;
  /** 推进间隔（毫秒） */
  intervalMs?: number;
  className?: string;
}

const MAX_SAMPLES = 24;
const MIN_CHARS = 8;
const WINDOW = 3;

function formatStamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 均匀取样：保序，长课从头到尾都能翻到 */
export function sampleDriftLines(transcript: ReadonlyArray<DriftLine>, max = MAX_SAMPLES): DriftLine[] {
  const usable = transcript
    .filter((line) => typeof line.text === 'string' && line.text.replace(/\s+/g, ' ').trim().length >= MIN_CHARS)
    .map((line) => ({ text: line.text.replace(/\s+/g, ' ').trim(), startMs: Math.max(0, line.startMs || 0) }));
  if (usable.length <= max) return usable;
  const step = usable.length / max;
  const picked: DriftLine[] = [];
  for (let index = 0; index < max; index += 1) {
    picked.push(usable[Math.min(usable.length - 1, Math.floor(index * step))]);
  }
  return picked;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

export function TranscriptDrift({ transcript, intervalMs = 1_800, className }: TranscriptDriftProps) {
  const lines = React.useMemo(() => sampleDriftLines(transcript), [transcript]);
  const reduced = usePrefersReducedMotion();
  const [cursor, setCursor] = React.useState(WINDOW - 1);

  React.useEffect(() => {
    if (reduced || lines.length <= WINDOW) return;
    const timer = window.setInterval(() => {
      setCursor((prev) => (prev + 1 >= lines.length ? WINDOW - 1 : prev + 1));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [reduced, lines.length, intervalMs]);

  if (lines.length === 0) return null;

  const visible = lines.slice(Math.max(0, cursor - (WINDOW - 1)), cursor + 1);

  return (
    <div
      aria-hidden
      className={['mm-drift relative w-full max-w-[440px] overflow-hidden', className].filter(Boolean).join(' ')}
      style={{ height: `${WINDOW * 30}px` }}
    >
      {/* 上沿渐隐：句子像从纸外翻进来 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-paper to-transparent" />
      <ol className="flex h-full flex-col justify-end gap-1.5">
        {visible.map((line, index) => {
          const isLatest = index === visible.length - 1;
          const depth = visible.length - 1 - index; // 0 = 最新
          return (
            <li
              key={`${line.startMs}-${line.text.slice(0, 12)}`}
              className={`mm-drift-line flex items-baseline gap-2 text-[12.5px] leading-[1.5] ${isLatest ? 'text-ink' : 'text-ink-secondary'}`}
              style={{ opacity: isLatest ? 1 : depth === 1 ? 0.7 : 0.42 }}
            >
              <span className="cite-ts mono shrink-0" style={{ fontSize: '10.5px', padding: '0 5px' }}>
                {formatStamp(line.startMs)}
              </span>
              <span className="min-w-0 truncate">{line.text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
