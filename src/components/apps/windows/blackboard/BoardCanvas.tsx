'use client';

/**
 * BoardCanvas — v32 备课本讲义画布（v31 白纸基础上用户拍板改版）。
 *
 * 呈现是"讲解备课本"：淡米色纸底 + 细横格线（RULE_SPACING 对齐正文行高，
 * 字写在格线上）+ 深色屏显字（v32 手写体全部退役：鸿雷板书 / Caveat /
 * ZCOOL KuaiLe / hanzi-writer 笔顺动画一并移除，文字按生成流速逐 token
 * 显现；字幕组件 BoardCaption 退役——真实课堂没有字幕，讲的话看右栏对话）。
 * 一页两栏，write 在栏内从上到下流式追加（浏览器原生 flow 排版，v29 的
 * 零预计算坐标不变式沿用），new_column 显式换栏、栏满自动切下一栏兜底；
 * 页首 title 通栏。
 *
 * 字阶（board-lecture.LECTURE_FONT_RATIO：title 33 / term 19 /
 * step 16 / note 14 @540 板高），密度对齐参考图（一屏 15-25 行结构化
 * 内容）；节标题是浅紫底 pill（PAPER.accent/accentBg），==重点== 是
 * 马克笔黄横扫，圈点勾画维持朱砂 #D98271。
 * 公式走 write role='formula'（LaTeX → KaTeX 块级排版，BoardFormula，
 * 块完整后 400ms 淡入），数据模型上的 new_column 动作在这里折叠成分栏
 * 标记（不产生墨迹）。
 *
 * 不变式（v29 沿用）：write 严格串行（前一个写完 onDone 才放行下一个），
 * 标注用 target 引用（'wN'）DOM 实测取 bounds，且等目标 write 写完才落笔；
 * 页内只增不减（绝不擦除）；换页整体淡入；内容写满时整板等比收缩兜底。
 *
 * 拆分：流式内容区在 BoardFlow，字阶/调色板/分栏纯函数在 board-lecture，
 * 公式在 BoardFormula。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { COPY } from '@/lib/ui/copy';
import type { BoardAction, BoardPage } from '@/lib/ai-native/plugins/board-script';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  PAD_BOTTOM,
  PAD_TOP,
  PAPER,
  RULE_SPACING,
  flattenPage,
  splitLectureFlow,
  targetRefsOf,
} from './board-lecture';
import type { ExtraWrite } from './board-lecture';
import { BOARD_FONT } from './BoardWrite';
import { BoardAnnotation } from './BoardAnnotation';
import { BoardFlow } from './BoardFlow';
import type { FlowItem } from './BoardFlow';
import { emitBoardTiming } from './board-timing';

export { BOARD_WIDTH, BOARD_HEIGHT };
export type { ExtraWrite };

const log = createLogger('board-canvas');

interface BoardCanvasProps {
  page: BoardPage;
  pageIndex: number;
  triggered: string[];
  /** 段末/翻页硬同步闸门：已触发的页级 write 是否全部写完 */
  onAllWritesDone?: (done: boolean) => void;
  /** v23 反向背压：已触发但未写完的页级 write 数（串行队列积压）变化时上报 */
  onInkBacklog?: (pending: number) => void;
  /** v9 音画同步：动作 key → 书写时间窗预算 ms（buildPageTimeline 给出） */
  budgets?: Record<string, number>;
  /** 中文主字体覆盖（demo 字体评估用；缺省系统屏显栈 BOARD_FONT） */
  fontFamily?: string;
  /** checkpoint 追加 write（接在页级 write 后面，加入串行链） */
  extraWrites?: ExtraWrite[];
  /** checkpoint demo 的标注动作（gating 规则同页级标注） */
  extraAnnotations?: BoardAction[];
  /** 最终态直接呈现（ref 跨页插播用）：无书写动画、全部立即完成 */
  instant?: boolean;
  /** ?debug=bounds：标注实测 rect 画细线框 */
  debugBounds?: boolean;
  /** 冷启动备课态（首段音频合成中）：纸面手写字提示而非空白页 */
  preparing?: boolean;
  /** 播放暂停：整板冻结（书写接力暂停、看门狗冻结） */
  paused?: boolean;
  /** v32 事件流画布（/teach）：书写倍率（无 TTS 按生成流速显现；默认 1） */
  writePaceScale?: number;
}

// 默认参数的数组字面量每渲染都是新引用——依赖它们的 effect 会每帧重跑，
// 叠加 setState 即 update-depth 死循环（RefInterlude 不传这两个 prop，必现）
const EMPTY_EXTRAS: ExtraWrite[] = [];
const EMPTY_ANNOTATIONS: BoardAction[] = [];

export function BoardCanvas({
  page,
  pageIndex,
  triggered,
  onAllWritesDone,
  onInkBacklog,
  budgets,
  fontFamily,
  extraWrites = EMPTY_EXTRAS,
  extraAnnotations = EMPTY_ANNOTATIONS,
  instant = false,
  debugBounds = false,
  preparing = false,
  paused = false,
  writePaceScale,
}: BoardCanvasProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // 串行书写链：已写完的 write key 集合
  const [doneWrites, setDoneWrites] = useState<ReadonlySet<string>>(new Set());
  // v31 栏满自动换栏兜底：该 key 之后的内容进下一栏（已写墨迹不动）
  const [autoBreakAfter, setAutoBreakAfter] = useState<string | null>(null);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const update = () => setScale(outer.clientWidth / BOARD_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(outer);
    return () => observer.disconnect();
  }, []);

  // 换页 / 重播（triggered 从非空清空）重置串行链与分栏
  const prevTriggeredCount = useRef(0);
  useEffect(() => {
    const wasReplay = prevTriggeredCount.current > 0 && triggered.length === 0;
    prevTriggeredCount.current = triggered.length;
    if (wasReplay) {
      setDoneWrites((prev) => (prev.size === 0 ? prev : new Set()));
      setAutoBreakAfter(null);
    }
  }, [triggered]);
  useEffect(() => {
    setDoneWrites((prev) => (prev.size === 0 ? prev : new Set()));
    setAutoBreakAfter(null);
  }, [pageIndex]);

  const flat = useMemo(() => flattenPage(page), [page]);
  const triggeredSet = useMemo(() => new Set(triggered), [triggered]);

  // write 的 wN 身份按页内顺序机械分配（标注 gating 与 DOM 锚点用），
  // 位置不再预计算——浏览器 flow 排版；new_column 不占 wN
  const writeIdByKey = useMemo(() => {
    const map = new Map<string, string>();
    let writeIndex = 0;
    for (const { key, action } of flat) {
      if (action.type === 'write') {
        writeIndex += 1;
        map.set(key, `w${writeIndex}`);
      }
    }
    return map;
  }, [flat]);
  /** 页级 write 的 key 按 wN 顺序（wN → key 查表） */
  const orderedWriteKeys = useMemo(() => {
    const keys: string[] = [];
    for (const { key, action } of flat) {
      if (action.type === 'write') keys.push(key);
    }
    return keys;
  }, [flat]);

  const visible = flat.filter(({ key }) => triggeredSet.has(key));
  // checkpoint demo 标注折叠进 visible（gating 与页级标注一致）
  if (extraAnnotations.length > 0) {
    extraAnnotations.forEach((action, index) => {
      visible.push({ key: `xann${index}`, action });
    });
  }
  const labelFont = fontFamily ?? BOARD_FONT;

  // 串行：页级 write → 追加 write，第一个还没写完的才 active，后面的排队
  const activeWriteKey = (() => {
    if (instant) return null;
    for (const { key, action } of visible) {
      if (action.type === 'write' && !doneWrites.has(key)) return key;
    }
    for (let index = 0; index < extraWrites.length; index += 1) {
      if (!doneWrites.has(extraWrites[index].key)) return extraWrites[index].key;
    }
    return null;
  })();

  const markWriteDone = (key: string) => {
    setDoneWrites((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    emitBoardTiming('write-done', { page: pageIndex, key });
  };

  // 看门狗：一个 write 在 active 位上超过 12s 没写完（CDN 挂起、动画帧冻结等），
  // 强制放行——讲义绝不允许冻住（iOS 低电量、自动播放策略、网络抖动）
  const activeSinceRef = useRef<{ key: string | null; since: number }>({ key: null, since: 0 });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    if (!activeWriteKey) return undefined;
    if (activeSinceRef.current.key !== activeWriteKey) {
      activeSinceRef.current = { key: activeWriteKey, since: Date.now() };
    }
    const timer = setInterval(() => {
      if (pausedRef.current) {
        // 暂停期间看门狗冻结（计时起点随暂停顺延，恢复后不多算）
        if (activeSinceRef.current.key) activeSinceRef.current.since = Date.now();
        return;
      }
      const current = activeSinceRef.current;
      if (current.key && Date.now() - current.since > 12_000) {
        log.error('board write 卡死 12s，强制放行', { key: current.key });
        markWriteDone(current.key);
        activeSinceRef.current = { key: null, since: 0 };
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWriteKey]);

  // 标注等目标 write 全部写完才落笔（讲写同步）
  const annotationReady = (action: BoardAction): boolean =>
    targetRefsOf(action).every((ref) => {
      const targetKey = orderedWriteKeys[ref - 1];
      return targetKey !== undefined && doneWrites.has(targetKey);
    });

  // v31 流式内容分栏：write/image 成块，new_column 折成分栏标记
  const flowItems: FlowItem[] = [];
  for (const { key, action } of visible) {
    if (action.type === 'new_column') {
      flowItems.push({ key, isColumnBreak: true });
    } else if (action.type === 'write') {
      flowItems.push({ key, role: action.role, isColumnBreak: false, action });
    } else if (action.type === 'image') {
      flowItems.push({ key, isColumnBreak: false, action });
    }
  }
  for (const extra of extraWrites) {
    flowItems.push({ key: extra.key, role: extra.role, isColumnBreak: false, extra });
  }
  const flow = splitLectureFlow(flowItems, autoBreakAfter);

  // 溢出兜底：内容超出可视区时整板等比收缩（flow 排版不会重叠，但可能写满）；
  // 同一份测量顺便做栏满检测：首栏超高且没有显式换栏时，后续内容自动进下一栏
  const [flowScale, setFlowScale] = useState(1);
  const flowViewportRef = useRef<HTMLDivElement>(null);
  const flowContentRef = useRef<HTMLDivElement>(null);
  const firstColumnRef = useRef<HTMLDivElement>(null);
  // v32 标注跟随·内容纪元：内容区尺寸每次变化（新 write 换行生长、KaTeX 异步
  // 排版、栏满换栏、收缩）都 bump；标注的实测 effect 依赖它重跑——圈/下划线
  // 跟着目标走，不再留在旧坐标（只扩触发面，测量逻辑不变）
  const [measureEpoch, setMeasureEpoch] = useState(0);
  const lastContentSizeRef = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const viewport = flowViewportRef.current;
    const content = flowContentRef.current;
    if (!viewport || !content) return undefined;
    const frame = requestAnimationFrame(() => {
      // 可用高 = 视口内容盒（clientHeight 含上下 padding，必须减掉——
      // 否则收缩不足，末行探进字幕区）
      const available = viewport.clientHeight - PAD_TOP - PAD_BOTTOM;
      const needed = Math.min(1, available / Math.max(1, content.scrollHeight));
      const next = Math.max(0.55, needed);
      setFlowScale((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));

      // 内容纪元：尺寸没变 = 字墨位置没变（flow 排版只增不改），不重测
      const size = { w: content.scrollWidth, h: content.scrollHeight };
      if (size.w !== lastContentSizeRef.current.w || size.h !== lastContentSizeRef.current.h) {
        lastContentSizeRef.current = size;
        setMeasureEpoch((v) => v + 1);
      }

      // 栏满兜底：仅当 agent 没写 new_column 时介入；正在写的块不搬家，
      // 标记落在它后面，下一个块起进下一栏
      const hasExplicitBreak = flowItems.some((item) => item.isColumnBreak);
      const firstColumn = firstColumnRef.current;
      if (!hasExplicitBreak && !autoBreakAfter && firstColumn && firstColumn.scrollHeight > available) {
        const anchor = activeWriteKey ?? flowItems[flowItems.length - 1]?.key ?? null;
        if (anchor) setAutoBreakAfter(anchor);
      }
    });
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => {
    // dataset.flowScale 保留给外部探针/调试（坐标换算已不再读它——实测即真值）
    if (boardRef.current) boardRef.current.dataset.flowScale = String(flowScale);
  }, [flowScale]);
  // 换页时收缩复位（同页重播内容同构，无需复位）
  useEffect(() => {
    setFlowScale(1);
  }, [pageIndex]);

  // 段末/翻页硬同步：已触发的页级 write 是否全部写完（标注不算——它等 write 后自会落笔；
  // 未触发的不算——它们属于后面的段落，不该挡当前段的推进）
  const allWritesDone = visible
    .filter(({ action }) => action.type === 'write')
    .every(({ key }) => doneWrites.has(key));
  useEffect(() => {
    onAllWritesDone?.(allWritesDone);
  }, [allWritesDone, onAllWritesDone]);

  // v23 反向背压：已触发但未写完的页级 write 数（含正在写的 active 那个）。
  // checkpoint 追加 write 不计——它们由交互态驱动，主时钟此时不在跑
  const inkBacklog = visible
    .filter(({ action }) => action.type === 'write')
    .reduce((count, { key }) => (doneWrites.has(key) ? count : count + 1), 0);
  useEffect(() => {
    onInkBacklog?.(inkBacklog);
  }, [inkBacklog, onInkBacklog]);

  // instant（ref 插播）：所有 write 立即标记完成
  useEffect(() => {
    if (!instant) return;
    setDoneWrites((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const { key, action } of flat) {
        if (action.type === 'write' && !next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      for (const extra of extraWrites) {
        if (!next.has(extra.key)) {
          next.add(extra.key);
          changed = true;
        }
      }
      // 无变化必须回原引用：新 Set 会触发重渲染，deps 不稳时就是死循环
      return changed ? next : prev;
    });
  }, [instant, flat, extraWrites]);

  return (
    <div ref={outerRef} className="w-full" style={{ aspectRatio: '16 / 9' }}>
      <div
        ref={boardRef}
        data-board-inner
        style={{
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          position: 'relative',
          borderRadius: 8,
          overflow: 'hidden',
          background: PAPER.bg,
          border: `1px solid ${PAPER.hairline}`,
          boxSizing: 'border-box',
          boxShadow: '0 10px 30px rgba(80,66,40,0.18)',
        }}
      >
        {/* 横格线纸纹（v32 备课本：细横线，行距对齐正文行高，字写在格线上） */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${RULE_SPACING - 1}px, ${PAPER.rule} ${RULE_SPACING - 1}px, ${PAPER.rule} ${RULE_SPACING}px)`,
            backgroundPosition: `0 ${PAD_TOP + RULE_SPACING}px`,
          }}
        />

        {/* 标注笔画的手绘抖动滤镜（roughjs 之上再叠一点纸面不匀；文字不用滤镜） */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <filter id="mm-chalk-rough" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="11" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" />
            </filter>
          </defs>
        </svg>

        {/* 讲义内容：换页整体淡入 */}
        <div
          key={pageIndex}
          className={`mm-board-page absolute inset-0${paused ? ' mm-board-paused' : ''}`}
        >
          {/* 冷启动备课态：首个动作未触发前，手写字提示取代空白页 */}
          {preparing && visible.length === 0 ? (
            <div
              className="mm-chalk-text"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: PAPER.inkSoft,
                fontFamily: labelFont,
                fontSize: 21,
                letterSpacing: '0.12em',
              }}
            >
              {COPY.apps.explainer.preparing}
            </div>
          ) : null}
          {/* 流式画布：页首 title 通栏，正文一页两栏、栏内从上到下追加。
              包一层抬 z-index：墨迹永远在标注之上（圈/下划线压到相邻行小字时，
              字保持可读——v33 遮挡修复）；横格线在 mm-board-page 之下，标注仍在线之上 */}
          <div className="absolute inset-0" style={{ zIndex: 1 }}>
            <BoardFlow
              flow={flow}
              writeIdByKey={writeIdByKey}
              doneWrites={doneWrites}
              activeWriteKey={activeWriteKey}
              instant={instant}
              paused={paused}
              budgets={budgets}
              fontFamily={fontFamily}
              writePaceScale={writePaceScale}
              onWriteDone={markWriteDone}
              flowScale={flowScale}
              flowViewportRef={flowViewportRef}
              flowContentRef={flowContentRef}
              firstColumnRef={firstColumnRef}
            />
          </div>

          {/* 标注 / 贴图覆盖层：DOM 实测坐标（实测即收缩后真值，不做二次补偿；
              flowScale 仅作为重测信号经 prop 下发）。
              pointerEvents:none——划线提问的文本选择不被标注挡住 */}
          <div className="absolute inset-0" style={{ zIndex: 0, pointerEvents: 'none' }}>
            {visible.map(({ key, action }) => {
              if (action.type === 'write') return null;
              if (action.type === 'pause') return null;
              if (action.type === 'new_column') return null;
              if (!annotationReady(action)) return null;

              return (
                <BoardAnnotation
                  key={key}
                  action={action}
                  flowScale={flowScale}
                  epoch={measureEpoch}
                  boardRef={boardRef}
                  labelFont={labelFont}
                  boardWidth={BOARD_WIDTH}
                  debug={debugBounds}
                />
              );
            })}
          </div>
        </div>

        {/* v32：字幕区退役（BoardCaption 删除）——讲的话看右栏对话 */}

        <style>{`
          .mm-chalk-char {
            display: inline-block;
            opacity: 0;
            animation: mm-chalk-in 0.22s ease-out forwards;
          }
          @keyframes mm-chalk-in {
            from { opacity: 0; transform: translateY(calc(var(--mm-y, 0px) + 3px)) scale(1.04); }
            to { opacity: var(--mm-jitter, 1); transform: translateY(var(--mm-y, 0px)) scale(1); }
          }
          .mm-board-page { animation: mm-page-in 0.45s ease-out; }
          .mm-board-paused .mm-chalk-char { animation-play-state: paused; }
          /* v31 块级公式：KaTeX 无法逐字接力，整块快速淡入 */
          .mm-formula-in { animation: mm-formula-in 0.4s ease-out; }
          @keyframes mm-formula-in {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
          }
          /* KaTeX display 默认 1em 上下外边距：8 个公式就白丢 ~300px 内容高度，
             会把整页逼进收缩兜底——块距由 roleBlockStyle 统一给，这里清零 */
          .mm-board-page .katex-display { margin: 0; }
          /* 马克笔高亮：从左到右横扫一挥 */
          .mm-hl-mark, .mm-hl-mark-instant {
            background-image: linear-gradient(${PAPER.marker}, ${PAPER.marker});
            background-repeat: no-repeat;
            background-position: 0 62%;
          }
          .mm-hl-mark {
            background-size: 0% 78%;
            animation: mm-hl-sweep 0.35s ease-out forwards;
          }
          .mm-hl-mark-instant { background-size: 100% 78%; }
          @keyframes mm-hl-sweep { to { background-size: 100% 78%; } }
          .mm-board-paused .mm-formula-in,
          .mm-board-paused .mm-hl-mark { animation-play-state: paused; }
          @keyframes mm-page-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
