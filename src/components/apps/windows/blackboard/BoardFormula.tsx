'use client';

/**
 * BoardFormula — v31 块级公式（write role='formula'，text 为 LaTeX）。
 *
 * KaTeX 真实数学排版（矩阵/分式/根号），深色墨迹居中成行，取代 v30 的
 * 手写模拟结构 token（BoardStructToken 已随黑板形态退役）。KaTeX 无法
 * 逐字接力，出现动画 = 整块快速淡入（mm-formula-in）；data-write-id 锚点
 * 照常参与串行链 gating 与标注 DOM 实测（.mm-struct 进 annotation-measure
 * 的叶子选择器）。LaTeX 写错不崩：throwOnError:false，KaTeX 原样标红兜底。
 */

import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { PAPER } from './board-lecture';
import { useRelayTimer } from './BoardWrite';

/** 整块淡入后即算"写完"（串行链放行下一个动作） */
const FORMULA_REVEAL_MS = 450;

interface BoardFormulaProps {
  latex: string;
  fontSize: number;
  /** 流式画布的 wN id（标注 DOM 实测锚点） */
  writeId?: string;
  active: boolean;
  onDone: () => void;
  instant?: boolean;
  paused?: boolean;
}

export function BoardFormula({ latex, fontSize, writeId, active, onDone, instant = false, paused = false }: BoardFormulaProps) {
  const html = useMemo(
    () =>
      katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
        output: 'html',
        strict: 'ignore',
      }),
    [latex],
  );

  useRelayTimer(FORMULA_REVEAL_MS, paused, instant, active, onDone);

  if (!active) return null;
  return (
    <div
      data-write-id={writeId}
      // mm-struct：进标注实测的叶子选择器（圈/下划线框住整个公式块）
      className={`mm-struct${instant ? '' : ' mm-formula-in'}`}
      style={{
        width: '100%',
        textAlign: 'center',
        color: PAPER.ink,
        fontSize,
        lineHeight: 1.2,
      }}
      // eslint-disable-next-line react/no-danger -- KaTeX 服务端级转义输出，throwOnError:false 不注入
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
