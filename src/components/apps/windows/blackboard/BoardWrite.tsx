'use client';

/**
 * BoardWrite — 讲义文字显现（v32：手写体退役，统一屏显字体）。
 *
 * v32 用户拍板：鸿雷板书 / Caveat 手写体全部弃用，hanzi-writer 笔顺动画
 * 体系随字体退役——所有 token 统一走字体逐 token 显现接力（文字按生成
 * 流速出现，自然的"写字"感），formula role 不走本组件（见 BoardFormula，
 * KaTeX 块完整后 400ms 淡入）。
 *
 * 保留的接力骨架（播放器音画同步依赖它）：
 * - 串行：第 i 个 token 显现完才放行第 i+1 个（useRelayTimer，可暂停/瞬时）
 * - v19 人性化节奏：buildWritePaceForTokens 给出每 token 耗时与抬笔停顿
 * - token 分型：CJK 逐字 / 拉丁按词 / 标点逐字 / 空格瞬时 / ==重点== 马克笔
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardWriteAction } from '@/lib/ai-native/plugins/board-script';
import { buildWritePaceForTokens, tokenizeBoardText } from './board-model';
import type { BoardToken } from './board-model';
import { PAPER } from './board-lecture';

/** v32 板面屏显字体（系统栈；手写体 HongleiBanShu / Caveat / ZCOOL KuaiLe 全部退役） */
export const BOARD_FONT =
  "-apple-system, 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'Source Han Sans SC', sans-serif";

/** 纸面墨色 */
export const INK_MAIN = PAPER.ink;
/** 节标题紫（term；浅紫高亮块里的紫字） */
export const INK_ACCENT = PAPER.accent;
/** 注释灰（note） */
export const INK_SOFT = PAPER.inkSoft;

/** role → 墨色（讲义章法：节标题紫、注释灰、正文深墨；圈划朱砂在 RoughStroke） */
export function inkColorFor(role: BoardWriteAction['role']): string {
  if (role === 'term') return INK_ACCENT;
  if (role === 'note') return INK_SOFT;
  return INK_MAIN;
}

/** 可暂停的接力定时器：暂停时冻结剩余时间，恢复后续跑；instant 立即完成。 */
export function useRelayTimer(
  ms: number,
  paused: boolean,
  instant: boolean,
  active: boolean,
  onComplete: () => void,
): void {
  const remainingRef = useRef(ms);
  const startedAtRef = useRef(0);
  const firedRef = useRef(false);
  useEffect(() => {
    if (!active || firedRef.current) return undefined;
    if (instant) {
      firedRef.current = true;
      onComplete();
      return undefined;
    }
    if (paused) {
      // 冻结：结算已经走过去的时间
      if (startedAtRef.current > 0) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
        startedAtRef.current = 0;
      }
      return undefined;
    }
    startedAtRef.current = Date.now();
    const timer = setTimeout(() => {
      firedRef.current = true;
      onComplete();
    }, remainingRef.current);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, instant, active]);
}

/** 节奏计划取值（writeMs/restMs 与 flatTokens 等长；防御性兜底 0） */
function planAt(arr: number[], index: number): number {
  return arr[index] ?? 0;
}

// ── token 组件（统一屏显字体，逐 token 显现接力） ──────────────────────────

interface TimedTokenProps {
  durationMs: number;
  instant?: boolean;
  paused?: boolean;
  onComplete: () => void;
}

/** CJK 逐字 / 标点逐字 */
function CharToken({ char, size, durationMs, instant = false, paused = false, onComplete }: TimedTokenProps & { char: string; size: number }) {
  useRelayTimer(durationMs, paused, instant, true, onComplete);
  return (
    <span className="mm-chalk-char" style={{ fontSize: size, lineHeight: 1 }}>
      {char}
    </span>
  );
}

/** 拉丁词单元（词内字距交给字体本身，white-space: pre 原生词宽） */
function WordToken({ word, size, durationMs, instant = false, paused = false, onComplete }: TimedTokenProps & { word: string; size: number }) {
  useRelayTimer(durationMs, paused, instant, true, onComplete);
  return (
    <span className="mm-chalk-char" style={{ fontSize: size, lineHeight: 1, whiteSpace: 'pre' }}>
      {word}
    </span>
  );
}

/** ==重点== 马克笔高亮（唯一行内结构 token；黄横扫） */
function HighlightToken({ text, size, durationMs, instant = false, paused = false, onComplete }: TimedTokenProps & { text: string; size: number }) {
  useRelayTimer(durationMs, paused, instant, true, onComplete);
  return (
    <span
      // mm-struct：进标注实测的叶子选择器（圈/下划线把高亮块整段框住）
      className={instant ? 'mm-hl-mark-instant mm-struct' : 'mm-hl-mark mm-struct'}
      style={{
        padding: '0 0.14em',
        margin: '0 0.04em',
        borderRadius: 3,
        fontSize: size,
        whiteSpace: 'pre',
      }}
    >
      {text}
    </span>
  );
}

/** 空格 token：字体原生空格宽度（white-space: pre），零人工补偿 */
function SpaceToken({ size, durationMs, instant = false, paused = false, onComplete }: TimedTokenProps & { size: number }) {
  useRelayTimer(durationMs, paused, instant, true, onComplete);
  return (
    <span className="mm-chalk-char" style={{ fontSize: size, lineHeight: 1, whiteSpace: 'pre' }}>
      {' '}
    </span>
  );
}

// ── write 动作整体（token 接力） ────────────────────────────────────────────

interface BoardWriteProps {
  action: BoardWriteAction;
  /** flow 模式字号（v28 起浏览器原生 flow 排版：单逻辑行自然折行、无占位） */
  flowFontSize: number;
  /** wN id（标注 DOM 实测锚点） */
  writeId?: string;
  /** 串行链：前一个 write 写完后才 true */
  active: boolean;
  onDone: () => void;
  /** 最终态直接呈现（ref 插播 / 历史恢复）：无延迟逐 token 显现 */
  instant?: boolean;
  /** 播放暂停：整板冻结（当前 token 显现完即停） */
  paused?: boolean;
  /** v9 音画同步：书写速度倍率（时间窗预算 / 自然书写时长） */
  paceScale?: number;
  /** 主字体覆盖（demo 字体历史对比用；缺省 BOARD_FONT 系统屏显栈） */
  fontFamily?: string;
}

export function BoardWrite({ action, flowFontSize, writeId, active, onDone, instant = false, paused = false, paceScale = 1, fontFamily }: BoardWriteProps) {
  const strokeMode = action.role === 'title' || action.role === 'term';
  const fontSize = flowFontSize;

  // 整段一个逻辑行，折行交给浏览器 flex-wrap（拉丁词不折——词是单个 flex item）
  const flatTokens = useMemo<BoardToken[]>(() => tokenizeBoardText(action.text), [action.text]);
  const totalTokens = flatTokens.length;

  // v19 人性化书写节奏：每个 token 的书写耗时（含确定性抖动）+ 写完后的
  // 抬笔停顿（词间/标点/短语换气），全文坐标系用原文做 seed 保证稳定
  const pacePlan = useMemo(
    () => buildWritePaceForTokens(flatTokens, strokeMode, action.text),
    [flatTokens, strokeMode, action.text],
  );

  // 已完成的 token 数；flatTokens[0..doneCount-1] 已完成，[doneCount] 正在写
  const [doneCount, setDoneCount] = useState(0);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // 抬笔停顿闸：token 写完后不立刻开写下一个——先停顿 restMs（暂停时冻结），
  // 停顿结束才放行下一个 token。这就是"写一下、停一下、接着写"的本体。
  const [restTarget, setRestTarget] = useState<number | null>(null);
  const restRemainRef = useRef(0);
  const restStartRef = useRef(0);

  const handleTokenDone = (index: number) => {
    const next = index + 1;
    if (instant || next >= totalTokens) {
      setDoneCount((prev) => (index < prev ? prev : next));
      return;
    }
    const rest = Math.round((pacePlan.restMs[index] ?? 0) * paceScale);
    if (pausedRef.current || rest > 40) {
      restRemainRef.current = rest;
      restStartRef.current = 0;
      setRestTarget(next);
      return;
    }
    setDoneCount((prev) => (index < prev ? prev : next));
  };

  // 停顿计时（可暂停：暂停时结算已走时间并冻结，恢复后续跑）
  useEffect(() => {
    if (restTarget === null) return undefined;
    if (paused) {
      if (restStartRef.current > 0) {
        restRemainRef.current = Math.max(0, restRemainRef.current - (Date.now() - restStartRef.current));
        restStartRef.current = 0;
      }
      return undefined;
    }
    restStartRef.current = Date.now();
    const timer = setTimeout(() => {
      setRestTarget(null);
      setDoneCount((prev) => (restTarget - 1 < prev ? prev : restTarget));
    }, restRemainRef.current);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restTarget, paused]);

  // instant（ref 插播 / 历史恢复）：全部直接呈现，挂载即完成
  useEffect(() => {
    if (!active || !instant || doneRef.current) return;
    doneRef.current = true;
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, instant]);

  useEffect(() => {
    if (!active || instant) return;
    if (doneCount >= totalTokens && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [active, doneCount, totalTokens, onDone, instant]);

  if (!active) return null;

  // 要渲染的 token：已完成的 + 正在写的那个（未写 token 不渲染——当前块
  // 永远是最末块，行随书写自然生长、已放置 token 永不移动）
  const renderCount = instant ? totalTokens : Math.min(doneCount + 1, totalTokens);
  const inkColor = inkColorFor(action.role);

  return (
    <div
      className="mm-chalk-text"
      data-write-id={writeId}
      style={{
        width: '100%',
        lineHeight: 1.35,
        color: inkColor,
        fontFamily: fontFamily ?? BOARD_FONT,
        fontWeight: action.role === 'title' ? 600 : action.role === 'term' ? 500 : 400,
        letterSpacing: strokeMode ? '0.04em' : '0.01em',
      }}
    >
      <div
        className="flex flex-wrap items-baseline"
        style={{
          justifyContent: action.role === 'title' ? 'center' : 'flex-start',
          rowGap: Math.round(fontSize * 0.35),
        }}
      >
        {flatTokens.slice(0, renderCount).map((token, tokenIndex) => {
          const durationMs = planAt(pacePlan.writeMs, tokenIndex) * paceScale;
          const key = tokenIndex;
          if (token.kind === 'hl') {
            return (
              <HighlightToken
                key={key}
                text={token.text}
                size={fontSize}
                instant={instant}
                paused={paused}
                durationMs={durationMs}
                onComplete={() => handleTokenDone(tokenIndex)}
              />
            );
          }
          if (token.kind === 'word') {
            return (
              <WordToken
                key={key}
                word={token.text}
                size={fontSize}
                instant={instant}
                paused={paused}
                durationMs={durationMs}
                onComplete={() => handleTokenDone(tokenIndex)}
              />
            );
          }
          if (token.kind === 'space') {
            return (
              <SpaceToken
                key={key}
                size={fontSize}
                instant={instant}
                paused={paused}
                durationMs={durationMs}
                onComplete={() => handleTokenDone(tokenIndex)}
              />
            );
          }
          // cjk / punct 逐字
          return (
            <CharToken
              key={key}
              char={token.text}
              size={fontSize}
              instant={instant}
              paused={paused}
              durationMs={durationMs}
              onComplete={() => handleTokenDone(tokenIndex)}
            />
          );
        })}
      </div>
    </div>
  );
}
