/**
 * board-layout — 黑板流式布局引擎与标注坐标（纯函数，可单测）。
 *
 * 从 board-model.ts 拆出（行数限制）：layoutBoardPage / layoutWithExtras
 * （LLM 只按顺序给 write，排版权归播放器）、resolveTargetRect（wN → bounds）、
 * toVirtualRect（视口 → 960×540 虚拟坐标，含 border/缩放）。
 */

import type { BoardPage, BoardWriteRole } from '@/lib/ai-native/plugins/board-script';
import { parseWriteRef } from '@/lib/ai-native/plugins/board-script';
import type { Rect } from './board-model';
import { isLatinBoardChar } from './board-model';

// ── 流式布局引擎 ───────────────────────────────────────────────────────────



/** 按宽度折行：返回每行文本（逐字贪心，不断词——板书按字走）。 */
/** 字号分级（相对板高）。
 *  v25 整体上抬约 15%（title 0.11→0.12 / term 0.08→0.092 / step 0.058→0.066 /
 *  note 0.046→0.052）：保守字号 + 大留白是"低质量草稿本"观感的直接来源
 *  （2026-08-19 用户实测"密度太小"）；写满的页面由收缩路径兜底不溢出。 */
export const ROLE_FONT_RATIO: Record<BoardWriteRole, number> = {
  title: 0.12,
  term: 0.092,
  step: 0.066,
  note: 0.052,
  // v31：formula 在 flow 渲染走 KaTeX（LECTURE_FONT_RATIO.formula），这里只是
  // Record 完整性兜底——旧布局引擎不排版公式块
  formula: 0.05,
};
/** 字号收缩下限（相对板高）。 */
export const MIN_FONT_RATIO = 0.032;
/** 左右边距 7%、上 10%（留 title 区）、下 7.5%（留字幕区）。 */
const MARGIN_X_RATIO = 0.07;
const MARGIN_TOP_RATIO = 0.1;
// 0.1 = 54px 底部留白：字幕区（分隔线 bottom 48 + 两行 40px）实际占 ~46px，
// 原 0.075（40.5px）会让最底行板书探进字幕顶部 ~5px（2026-08-19 用户实测字幕挡字）
const MARGIN_BOTTOM_RATIO = 0.1;
/** 折行宽度 = 板宽 86%。 */
const WRAP_WIDTH_RATIO = 0.86;
/** 行内行高 1.4 + 块后间距 0.5 = 行距 字号 × 1.9。 */
const LINE_HEIGHT = 1.4;
const BLOCK_GAP = 0.5;
/** 溢出收缩时块后间距压到 0.25（先保字号，再压间距）。 */
const COMPACT_BLOCK_GAP = 0.25;
/** term 前后共加 0.6 倍行距呼吸（每侧 0.3）。 */
const TERM_BREATH = 0.3;
/** 缩进一档 = 板宽 4%（step 一档、note 两档）。 */
const INDENT_RATIO = 0.04;

export interface WriteLayout {
  /** 'wN'（本页第 N 个 write，从 1 开始） */
  id: string;
  text: string;
  role: BoardWriteRole;
  rect: Rect;
  fontSize: number;
  /** 折行后的行数 */
  lines: number;
  /** 折行后的每行文本（渲染层必须与此一致） */
  textLines: string[];
  /** v24 板面物理写满时的弃写标记（渲染层跳过，内容仍由口述传达） */
  dropped?: boolean;
}

export interface BoardPageLayout {
  writes: WriteLayout[];
  /** 内容总高度（含 title 区与行距） */
  totalHeight: number;
  /** 按最小字号收缩后仍装不下 */
  overflow: boolean;
  /** 实际应用的字号缩放（1 = 未收缩） */
  scale: number;
}

/** 估算文本宽度：全角字符 ≈ 1em，半角 ≈ 0.5em（手写体拉丁偏窄）。 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    units += char.charCodeAt(0) > 0xff ? 1 : 0.5;
  }
  return units * fontSize;
}

/**
 * 虚拟粉笔手的光标落点（v10，对齐 AmIWrite 的 virtual hand 注意力引导）：
 * 正在写第 charIndex 个字（= 已完成字数）时笔尖所在位置（板面虚拟坐标）。
 * title 行居中需补居中偏移；charIndex 超过全文时落在末行末尾。
 */
export function writeTipPosition(
  layout: WriteLayout,
  charIndex: number,
): { x: number; y: number } {
  const lineAdvance = layout.fontSize * LINE_HEIGHT;
  let remaining = Math.max(0, charIndex);
  let lineIndex = 0;
  for (let index = 0; index < layout.textLines.length; index += 1) {
    const lineLength = Array.from(layout.textLines[index]).length;
    lineIndex = index;
    if (remaining < lineLength) break;
    remaining -= lineLength;
  }
  const line = layout.textLines[lineIndex] ?? '';
  const lineChars = Array.from(line);
  const prefix = lineChars.slice(0, Math.min(remaining, lineChars.length)).join('');
  const centeredOffset =
    layout.role === 'title'
      ? Math.max(0, (layout.rect.width - estimateTextWidth(line, layout.fontSize)) / 2)
      : 0;
  return {
    x:
      layout.rect.x +
      centeredOffset +
      estimateTextWidth(prefix, layout.fontSize) +
      layout.fontSize * 0.35,
    y: layout.rect.y + lineIndex * lineAdvance + layout.fontSize * 0.72,
  };
}

/** 第 charIndex 个字的字符框左上角（板面虚拟坐标；与 writeTipPosition 同一套行/居中估算）。 */
export function writeCharOrigin(
  layout: WriteLayout,
  charIndex: number,
): { x: number; y: number } {
  const lineAdvance = layout.fontSize * LINE_HEIGHT;
  let remaining = Math.max(0, charIndex);
  let lineIndex = 0;
  for (let index = 0; index < layout.textLines.length; index += 1) {
    const lineLength = Array.from(layout.textLines[index]).length;
    lineIndex = index;
    if (remaining < lineLength) break;
    remaining -= lineLength;
  }
  const line = layout.textLines[lineIndex] ?? '';
  const lineChars = Array.from(line);
  const prefix = lineChars.slice(0, Math.min(remaining, lineChars.length)).join('');
  const centeredOffset =
    layout.role === 'title'
      ? Math.max(0, (layout.rect.width - estimateTextWidth(line, layout.fontSize)) / 2)
      : 0;
  return {
    x: layout.rect.x + centeredOffset + estimateTextWidth(prefix, layout.fontSize),
    y: layout.rect.y + lineIndex * lineAdvance,
  };
}

// ── v14 笔画级笔尖追踪 ─────────────────────────────────────────────────────
// 与 hanzi-writer 3.7.3 完全同一套时序/坐标公式（dist/hanzi-writer.js 实测摘出）：
// - 笔画时长 d = (L + 600) / (3 × strokeAnimationSpeed)（ms，L = medians 折线长）
// - 笔画间停顿 delayBetweenStrokes；起笔前 fade = strokeFadeDuration（默认 400ms）
// - 单笔内 progress 经 cosine ease-in-out：ease(x) = -cos(x·π)/2 + 0.5
// - 字符空间 1024×1024（y 范围 -124..900），svg 变换 translate(xOffset, height-yOffset)
//   scale(s, -s)，padding 2 → s = (size-4)/1024，xOffset = 2，yOffset = 124s+2

export interface PenTrackOptions {
  /** 字符 svg 边长（板面虚拟单位，= layout.fontSize） */
  size: number;
  /** hanzi-writer strokeAnimationSpeed（与渲染同一值） */
  speed: number;
  /** hanzi-writer delayBetweenStrokes（与渲染同一值） */
  delayBetweenMs: number;
  /** 起笔前 fade（hanzi-writer strokeFadeDuration 默认 400ms） */
  fadeMs?: number;
}

const HW_FADE_MS = 400;
const HW_PADDING = 2;

function polylineLength(points: number[][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

function pointAtLength(points: number[][], target: number): { x: number; y: number } {
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const segment = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (walked + segment >= target && segment > 0) {
      const ratio = (target - walked) / segment;
      return {
        x: points[i - 1][0] + (points[i][0] - points[i - 1][0]) * ratio,
        y: points[i - 1][1] + (points[i][1] - points[i - 1][1]) * ratio,
      };
    }
    walked += segment;
  }
  const last = points[points.length - 1];
  return { x: last[0], y: last[1] };
}

function charSpaceToSvg(point: { x: number; y: number }, size: number): { x: number; y: number } {
  const scale = (size - HW_PADDING * 2) / 1024;
  return {
    x: HW_PADDING + point.x * scale,
    y: size - 124 * scale - HW_PADDING - point.y * scale,
  };
}

const cosineEase = (x: number): number => -Math.cos(x * Math.PI) / 2 + 0.5;

/**
 * 某一时刻笔尖在字符 svg 内的坐标（0..size，板面虚拟单位）。
 * elapsedMs 从 animateCharacter 调用起算（数据就绪即动，与渲染同一起点）；
 * 超出全字时长返回 null（该字写完）。medians 来自 hanzi-writer-data 的 charJson。
 */
export function penTipAt(
  medians: number[][][],
  elapsedMs: number,
  options: PenTrackOptions,
): { x: number; y: number } | null {
  if (medians.length === 0) return null;
  let t = elapsedMs - (options.fadeMs ?? HW_FADE_MS);
  if (t < 0) {
    // fade 期间：光标等在首笔起点
    return charSpaceToSvg({ x: medians[0][0][0], y: medians[0][0][1] }, options.size);
  }
  for (const stroke of medians) {
    const length = polylineLength(stroke);
    const duration = (length + 600) / (3 * options.speed);
    if (t <= duration) {
      // t<0（笔画间停顿期）：clamp 到 0——笔停在下一笔起点，不提前爬
      const portion = cosineEase(Math.max(0, Math.min(1, t / duration)));
      return charSpaceToSvg(pointAtLength(stroke, portion * length), options.size);
    }
    t -= duration + options.delayBetweenMs;
  }
  return null;
}

/**
 * 板书的拉丁字符（ASCII 字母/数字）——中文手写字体内置拉丁普遍拉胯，
 * 渲染层对这些字符单独分流到 Caveat（见 BoardWrite）。
 */

export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const char of text) {
    if (current && estimateTextWidth(current + char, fontSize) > maxWidth) {
      // 拉丁词中间不断行（原生排版）：行尾是半个拉丁词时整词挪到下一行——
      // "organis|ed" 这种断词在任何排版系统里都是事故
      if (isLatinBoardChar(char)) {
        const lastSpace = current.lastIndexOf(' ');
        const tail = current.slice(lastSpace + 1);
        if (lastSpace > 0 && [...tail].every((c) => isLatinBoardChar(c))) {
          lines.push(current.slice(0, lastSpace));
          current = tail + char;
          continue;
        }
      }
      lines.push(current);
      current = char === ' ' ? '' : char;
    } else {
      current += char;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function roleFontSize(role: BoardWriteRole, boardH: number, scale: number): number {
  return Math.max(boardH * ROLE_FONT_RATIO[role] * scale, boardH * MIN_FONT_RATIO);
}

function layoutWithScale(
  writes: Array<{ text: string; role: BoardWriteRole }>,
  boardW: number,
  boardH: number,
  scale: number,
  options?: { compact?: boolean },
): BoardPageLayout {
  const marginX = boardW * MARGIN_X_RATIO;
  const wrapWidth = boardW * WRAP_WIDTH_RATIO;
  const blockGap = options?.compact ? COMPACT_BLOCK_GAP : BLOCK_GAP;
  let cursor = boardH * MARGIN_TOP_RATIO;

  const layouts: WriteLayout[] = [];
  writes.forEach((write, index) => {
    const fontSize = roleFontSize(write.role, boardH, scale);
    const indent =
      write.role === 'step' ? boardW * INDENT_RATIO : write.role === 'note' ? boardW * INDENT_RATIO * 2 : 0;
    const lineAdvance = fontSize * LINE_HEIGHT;
    const breath =
      write.role === 'term' ? fontSize * (LINE_HEIGHT + blockGap) * TERM_BREATH : 0;

    cursor += breath;
    const lines = wrapText(write.text, fontSize, wrapWidth - indent);
    const width = Math.min(
      Math.max(...lines.map((line) => estimateTextWidth(line, fontSize))),
      wrapWidth - indent,
    );
    const height = lines.length * lineAdvance;
    const x = write.role === 'title' ? (boardW - width) / 2 : marginX + indent;
    layouts.push({
      id: `w${index + 1}`,
      text: write.text,
      role: write.role,
      rect: { x, y: cursor, width, height },
      fontSize,
      lines: lines.length,
      textLines: lines,
    });
    cursor += height + fontSize * blockGap + breath;
  });

  // 末尾的块后间距/呼吸是尾随空白，不计入内容总高
  const last = layouts[layouts.length - 1];
  const trailing = last
    ? last.fontSize * blockGap +
      (last.role === 'term' ? last.fontSize * (LINE_HEIGHT + blockGap) * TERM_BREATH : 0)
    : 0;
  const totalHeight = cursor - trailing + boardH * MARGIN_BOTTOM_RATIO - boardH * MARGIN_TOP_RATIO;
  return { writes: layouts, totalHeight, overflow: false, scale };
}

/**
 * 一页的流式布局：按动作顺序从上到下排，每个 write 占一行（超长折行），
 * title 顶部居中，term 加呼吸，step/note 缩进。内容总高超过可用高度时
 * 按比例收缩字号（下限板高 3.2%），仍装不下标记 overflow。
 * v25 稀疏放大：内容装不满时按比例放大字号——真人老师内容少就写大字、
 * 把黑板有组织地撑满；三两行小字浮在空板上是草稿本不是板书
 * （2026-08-19 用户实测"密度太小，像低质量草稿本"）。
 */
/** 稀疏放大的目标填充率（内容总高 / 可用高度）与字号放大上限。 */
const GROW_TARGET_FILL = 0.8;
const GROW_MAX_SCALE = 1.5;

export function layoutBoardPage(page: BoardPage, boardW: number, boardH: number): BoardPageLayout {
  const writes: Array<{ text: string; role: BoardWriteRole }> = [];
  for (const segment of page.segments) {
    if (segment.type === 'checkpoint') continue; // checkpoint 的动态 write 走 extras 追加
    for (const action of segment.actions) {
      if (action.type === 'write') writes.push({ text: action.text, role: action.role });
    }
  }

  const usableHeight = boardH * (1 - MARGIN_TOP_RATIO - MARGIN_BOTTOM_RATIO);
  const natural = layoutWithScale(writes, boardW, boardH, 1);

  // v25：装得下但装不满 → 放大重排（重折行后仍装得下才采用，否则退回原样）
  if (natural.totalHeight <= usableHeight) {
    if (natural.totalHeight < usableHeight * GROW_TARGET_FILL && writes.length > 0) {
      const grow = Math.min(GROW_MAX_SCALE, (usableHeight * GROW_TARGET_FILL) / natural.totalHeight);
      if (grow > 1.02) {
        const grown = layoutWithScale(writes, boardW, boardH, grow);
        if (grown.totalHeight <= usableHeight) return grown;
      }
    }
    return natural;
  }

  const scale = Math.max(
    usableHeight / natural.totalHeight,
    MIN_FONT_RATIO / ROLE_FONT_RATIO.title, // 下限：最大字号也到底线
  );
  const shrunk = layoutWithScale(writes, boardW, boardH, scale);
  if (shrunk.totalHeight <= usableHeight) return shrunk;

  // 字号到底仍装不下：先保字号，再压行距（块后间距 0.5 → 0.25）
  const compact = layoutWithScale(writes, boardW, boardH, scale, { compact: true });
  return { ...compact, overflow: compact.totalHeight > usableHeight };
}

/** 追加 write（checkpoint extras）的字号：略小于 note——它们是补充内容。
 *  v25 随主字号上抬（0.042→0.048）。 */
const EXTRAS_FONT_RATIO = 0.048;
/** extras 之间的块后间距（相对自身字号）。 */
const EXTRAS_GAP = 1.1;

/**
 * 页级 write + 追加 write（checkpoint 的 question/hints/demo writes）一起布局。
 * 追加式不变式（对齐真人板书）：**已经写在板上的字永远不动**——
 * 页级 write 的 rect 原样来自 layoutBoardPage（每页稳定），extras 从内容底部
 * 向下续排、固定字号、不触发全局收缩；左栏写满换右栏；右栏也到底时只缩小
 * 「还没排的」extras 的字号（逐次 0.88，下限 MIN_FONT_RATIO×0.9），绝不回搬
 * 已排内容。
 * 换栏/避撞判定基于**所有已放置内容**（页级 + 已排 extras）与**折行后的真实
 * 高度**：旧实现右栏起点只避页级 write（宽 extras 越过中线时被右栏新内容
 * 撞车）且换栏只按单行高度判定（多行 extra 底边溢出进字幕区）——
 * 2026-08-19 实拍"题目与示范同一行相撞、另一份压字幕"后根修。
 */
export function layoutWithExtras(
  page: BoardPage,
  extras: Array<{ text: string; role: BoardWriteRole }>,
  boardW: number,
  boardH: number,
): BoardPageLayout {
  const base = layoutBoardPage(page, boardW, boardH);
  if (extras.length === 0) return base;

  const marginX = boardW * MARGIN_X_RATIO;
  const wrapWidth = boardW * WRAP_WIDTH_RATIO;
  const baseLast = base.writes[base.writes.length - 1];
  const fontSize = boardH * EXTRAS_FONT_RATIO;
  const maxBottom = boardH * (1 - MARGIN_BOTTOM_RATIO);
  // 左栏续排不下时换到右栏（流式布局是左单列，右半板通常空着——
  // 真人老师左边写满了就往右边写），列内仍只向下追加
  const rightColX = boardW * 0.55;
  const rightColWrap = boardW - rightColX - marginX;
  const leftColX = marginX + boardW * INDENT_RATIO;
  const leftColWrap = wrapWidth - boardW * INDENT_RATIO;

  // 已放置内容（页级 write + 已排 extras）：右栏排布要跳过所有与右半板
  // x 区间相交的内容——包括越过中线的宽 extras（旧实现只看页级 write，
  // 且右栏起点一刀切到最宽页级行底部，右半板大量空白被浪费）
  const placed: WriteLayout[] = [...base.writes];

  const baseBottom = baseLast
    ? baseLast.rect.y + baseLast.rect.height
    : boardH * MARGIN_TOP_RATIO;
  const minFont = boardH * MIN_FONT_RATIO * 0.9;
  // v24 分区（板书章法：功能区固定）：页级内容已写满上半板时，extras 优先
  // 进右栏从栏顶向下排——提问/提示/示范固定在右栏同列对齐，学生一眼知道
  // 互动内容在哪；不在左栏缝隙里 weave（2026-08-19 用户实拍"整体感觉很乱、
  // 不对齐"）。页级内容少时优先左栏续排（疏朗页的自然延伸）
  const preferRight = baseBottom > boardH * 0.5;
  // v24 双栏候选：左栏从页级内容底部续排、右栏从栏顶向下排，每个 extra 在
  // 两栏各评估一个候选位（右栏避撞 + 缩字号），取字号更大的落位——一栏
  // 塞满时另一栏常常还有空（2026-08-19 超载页实拍：右栏塞满后 demo write
  // 在 clamp 兜底位与 hint 叠影，双栏候选后全部落位无碰撞）
  let leftCursor = baseBottom + fontSize * EXTRAS_GAP;
  let rightCursor = boardH * MARGIN_TOP_RATIO;
  let extrasFontSize = fontSize;
  let clamped = false;

  interface ExtraCandidate {
    font: number;
    y: number;
    lines: string[];
    onRight: boolean;
  }

  const extraLayouts: WriteLayout[] = extras.map((extra, index) => {
    // 右栏候选：从栏游标起排，垂直避撞所有跨界已放置内容，越界缩字号重试
    const evalRight = (): ExtraCandidate | null => {
      let candidateFont = extrasFontSize;
      for (;;) {
        const lines = wrapText(extra.text, candidateFont, rightColWrap);
        const height = lines.length * candidateFont * LINE_HEIGHT;
        let y = rightCursor;
        for (;;) {
          const blocker = placed.find(
            (write) =>
              write.rect.x + write.rect.width > rightColX &&
              write.rect.y < y + height &&
              write.rect.y + write.rect.height > y,
          );
          if (!blocker) break;
          y = blocker.rect.y + blocker.rect.height + candidateFont * EXTRAS_GAP * 0.6;
        }
        if (y + height <= maxBottom) return { font: candidateFont, y, lines, onRight: true };
        if (candidateFont <= minFont) return null;
        candidateFont = Math.max(candidateFont * 0.88, minFont);
      }
    };

    // 左栏候选：页级内容之下的连续区（下方只有已排左栏 extras，无需避撞）
    const evalLeft = (): ExtraCandidate | null => {
      let candidateFont = extrasFontSize;
      for (;;) {
        const lines = wrapText(extra.text, candidateFont, leftColWrap);
        const height = lines.length * candidateFont * LINE_HEIGHT;
        if (leftCursor + height <= maxBottom) {
          return { font: candidateFont, y: leftCursor, lines, onRight: false };
        }
        if (candidateFont <= minFont) return null;
        candidateFont = Math.max(candidateFont * 0.88, minFont);
      }
    };

    const right = evalRight();
    const left = evalLeft();
    // 双栏都可落位时取字号更大者（并列随分区偏好）；一栏落空取另一栏
    let chosen: ExtraCandidate | null = null;
    if (right && left) {
      chosen =
        right.font === left.font
          ? preferRight ? right : left
          : right.font > left.font ? right : left;
    } else {
      chosen = right ?? left;
    }
    // 字幕区红线最后兜底：两栏都装不下，先把底边收进字幕区上沿（绝不压字幕）；
    // 收进后仍与已放置内容相撞则弃写——黑板物理写满时真人老师也不再往上写，
    // 内容照常说出口（2026-08-19 超载页实拍：兜底位叠影成双根修）
    if (!chosen) {
      const lines = wrapText(extra.text, minFont, preferRight ? rightColWrap : leftColWrap);
      const height = lines.length * minFont * LINE_HEIGHT;
      const y = Math.max(boardH * MARGIN_TOP_RATIO, maxBottom - height);
      const x = preferRight ? rightColX : leftColX;
      const width = Math.min(
        Math.max(...lines.map((line) => estimateTextWidth(line, minFont))),
        preferRight ? rightColWrap : leftColWrap,
      );
      const collides = placed.some(
        (write) =>
          write.rect.x < x + width - 1 &&
          x < write.rect.x + write.rect.width - 1 &&
          write.rect.y < y + height - 1 &&
          y < write.rect.y + write.rect.height - 1,
      );
      if (collides) {
        clamped = true;
        extrasFontSize = minFont;
        return {
          id: `w${base.writes.length + index + 1}`,
          text: extra.text,
          role: extra.role,
          rect: { x, y: maxBottom, width: 0, height: 0 },
          fontSize: minFont,
          lines: 0,
          textLines: [],
          dropped: true,
        };
      }
      chosen = { font: minFont, y, lines, onRight: preferRight };
      clamped = true;
    }

    extrasFontSize = chosen.font;
    const colX = chosen.onRight ? rightColX : leftColX;
    const colWrap = chosen.onRight ? rightColWrap : leftColWrap;
    const width = Math.min(
      Math.max(...chosen.lines.map((line) => estimateTextWidth(line, chosen.font))),
      colWrap,
    );
    const height = chosen.lines.length * chosen.font * LINE_HEIGHT;
    const layout: WriteLayout = {
      id: `w${base.writes.length + index + 1}`,
      text: extra.text,
      role: extra.role,
      rect: { x: colX, y: chosen.y, width, height },
      fontSize: chosen.font,
      lines: chosen.lines.length,
      textLines: chosen.lines,
    };
    const advance = chosen.y + height + chosen.font * EXTRAS_GAP * 0.6;
    if (chosen.onRight) rightCursor = advance;
    else leftCursor = advance;
    placed.push(layout);
    return layout;
  });

  const lastExtra = extraLayouts[extraLayouts.length - 1];
  const totalHeight = lastExtra
    ? lastExtra.rect.y + lastExtra.rect.height - boardH * MARGIN_TOP_RATIO
    : base.totalHeight;
  const overflow = clamped || (lastExtra ? lastExtra.rect.y + lastExtra.rect.height > maxBottom + 1 : base.overflow);
  return { writes: [...base.writes, ...extraLayouts], totalHeight, overflow, scale: base.scale };
}

/** target（'w3' 或 ['w2','w4']）→ 布局注册表里的 bounds（多个取并集）。 */
export function resolveTargetRect(
  target: string | string[],
  layout: BoardPageLayout,
): Rect | null {
  const refs = (Array.isArray(target) ? target : [target])
    .map(parseWriteRef)
    .filter((ref): ref is number => ref !== null);
  const rects = refs
    .map((ref) => layout.writes[ref - 1]?.rect)
    .filter((rect): rect is Rect => rect !== undefined);
  if (rects.length === 0) return null;

  const pad = Math.min(...rects.map((rect) => rect.height)) * 0.22;
  const x1 = Math.min(...rects.map((rect) => rect.x)) - pad;
  const y1 = Math.min(...rects.map((rect) => rect.y)) - pad;
  const x2 = Math.max(...rects.map((rect) => rect.x + rect.width)) + pad;
  const y2 = Math.max(...rects.map((rect) => rect.y + rect.height)) + pad * 0.4;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

// ── 标注坐标换算（视口 rect → 板面 960×540 虚拟坐标） ─────────────────────

export const BOARD_VIRTUAL_WIDTH = 960;

/** 纯函数：统一处理 border（clientLeft/clientTop）与 transform 缩放。 */
export function toVirtualRect(
  box: { x: number; y: number; width: number; height: number },
  board: { x: number; y: number; width: number; clientLeft: number; clientTop: number },
): Rect {
  // board.width 是 border-box 的变换后尺寸；clientLeft/clientTop 是布局像素
  // （不受 transform 影响），border 在屏幕上要乘缩放比
  const scale = board.width / BOARD_VIRTUAL_WIDTH;
  const originX = board.x + board.clientLeft * scale;
  const originY = board.y + board.clientTop * scale;
  return {
    x: (box.x - originX) / scale,
    y: (box.y - originY) / scale,
    width: box.width / scale,
    height: box.height / scale,
  };
}
