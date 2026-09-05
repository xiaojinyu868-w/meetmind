/**
 * board-lecture — v31 白纸讲义画布的纯函数层（可单测）。
 *
 * 从 BoardCanvas 拆出（行数限制）：讲义字阶 / 纸面调色板 / role 块级样式 /
 * 流式动作分栏（splitLectureFlow）/ 标题收缩。黑板时代的预计算布局引擎
 * （board-layout.ts layoutBoardPage 等）保留为标注实测失败时的 fallback，
 * 字号仍走旧 ROLE_FONT_RATIO；flow 渲染一律用本文件的 LECTURE_FONT_RATIO。
 */

import type { BoardAction, BoardPage, BoardWriteRole } from '@/lib/ai-native/plugins/board-script';
import { parseWriteRef } from '@/lib/ai-native/plugins/board-script';
import { isAsciiBoardPunct, isLatinBoardChar } from './board-model';

/** 板面虚拟坐标系（16:9），对外按容器宽度等比缩放 */
export const BOARD_WIDTH = 960;
export const BOARD_HEIGHT = 540;
/** 页面内边距（上 5% 页眉呼吸，下 6% 页脚呼吸，左右 4.5%；v32 字幕区随 BoardCaption 退役） */
export const PAD_TOP = Math.round(BOARD_HEIGHT * 0.05);
export const PAD_BOTTOM = Math.round(BOARD_HEIGHT * 0.06);
export const PAD_X = Math.round(BOARD_WIDTH * 0.045);

/** checkpoint 追加到板上的动态 write（question / hints / demo writes）。 */
export interface ExtraWrite {
  key: string;
  text: string;
  role: BoardWriteRole;
}

// ── 纸面调色板（v32 备课本：淡米色纸底 + 细横格线；黑板时代结束于 v31） ─────

export const PAPER = {
  /** 淡米色纸底（备课本） */
  bg: '#f7f2e4',
  /** 主墨迹（深墨棕黑） */
  ink: '#2e2b26',
  /** 次级墨迹（note / 备课提示） */
  inkSoft: '#6e675c',
  /** 节标题紫（低饱和，对齐参考图的浅紫高亮块） */
  accent: '#6f5fa8',
  /** 节标题浅紫底 */
  accentBg: 'rgba(111,95,168,0.13)',
  /** 马克笔高亮黄（==重点== 横扫） */
  marker: 'rgba(250,214,110,0.5)',
  /** 纸张细边 / 分隔线 */
  hairline: '#e4ddca',
  /** 横格线（淡蓝灰，克制不抢字） */
  rule: 'rgba(96,118,150,0.15)',
} as const;

// ── 讲义字阶（相对板高；v31 密度对齐参考图：一屏 15-25 行结构化内容） ──────

export const LECTURE_FONT_RATIO: Record<BoardWriteRole, number> = {
  title: 0.062, // 33px @540：课题，页首通栏
  term: 0.036, // 19px：节标题（紫底高亮块）
  step: 0.03, // 16px：正文短句
  note: 0.026, // 14px：缩进注释/口诀
  formula: 0.036, // 19px：KaTeX 块级公式基准字号
};

export function lectureFontSize(role: BoardWriteRole, boardH: number): number {
  return Math.round(LECTURE_FONT_RATIO[role] * boardH * 10) / 10;
}

/**
 * v32 横格线行距：对齐正文字号行高（step 16.2 × lineHeight 1.35 ≈ 22px
 * @540 板高），字写在格线上。BoardFlow 的 write 行高与此同源（lineHeight 1.35）。
 */
export const RULE_SPACING = Math.round(lectureFontSize('step', BOARD_HEIGHT) * 1.35);

/** v31 分栏参数：一页最多 2 栏，栏间距与缩进（板宽 960 虚拟坐标）。 */
export const LECTURE_COLUMNS = 2;
export const COLUMN_GAP = 34;
/** note 缩进一档（正文短句不缩进，层级交给 note/字号） */
export const NOTE_INDENT = 18;

/** role → 块级样式（节标题紫底 pill / 缩进 / 呼吸；v29 章法沿用） */
export function roleBlockStyle(role: BoardWriteRole, boardW: number, boardH: number): React.CSSProperties {
  const fontSize = lectureFontSize(role, boardH);
  if (role === 'title') {
    return {
      fontSize,
      textAlign: 'center',
      marginBottom: 10,
      paddingBottom: 8,
      borderBottom: `1.5px solid ${PAPER.hairline}`,
    };
  }
  if (role === 'term') {
    // 节标题：浅紫底 pill，收缩到文字宽（父容器是 flex column，alignSelf 生效）
    return {
      fontSize,
      alignSelf: 'flex-start',
      background: PAPER.accentBg,
      borderRadius: 5,
      padding: '2px 9px',
      marginTop: 9,
      marginBottom: 5,
    };
  }
  if (role === 'formula') {
    return { fontSize, width: '100%', marginTop: 5, marginBottom: 7 };
  }
  return {
    fontSize,
    marginBottom: 3,
    marginLeft: role === 'note' ? NOTE_INDENT : 0,
  };
}

/** 标题字号收缩到一栏/通栏装下（长标题折行孤行比小一号字难看） */
export function fitTitleFontSize(text: string, boardW: number, boardH: number): number {
  const base = lectureFontSize('title', boardH);
  const contentWidth = boardW * (1 - 2 * 0.045);
  const ems = Array.from(text).reduce(
    (width, ch) => width + (isLatinBoardChar(ch) || isAsciiBoardPunct(ch) ? 0.6 : 1.08),
    0,
  );
  const estimated = ems * base;
  if (estimated <= contentWidth) return base;
  return Math.max(base * 0.6, base * (contentWidth / estimated));
}

// ── 流式动作摊平与分栏 ─────────────────────────────────────────────────────

export interface FlatAction {
  key: string;
  action: BoardAction;
}

export function flattenPage(page: BoardPage): FlatAction[] {
  const list: FlatAction[] = [];
  page.segments.forEach((segment, segmentIndex) => {
    if (segment.type === 'checkpoint') return; // checkpoint 由交互态驱动，不走时间轴动作
    segment.actions.forEach((action, actionIndex) => {
      list.push({ key: `s${segmentIndex}a${actionIndex}`, action });
    });
  });
  // BoardClearAction（teach 新引擎 wb_clear）：清板 = 最后一个 clear 之前的动作
  // 全部不渲染（clear 自身也不产生墨迹）；之后的 write 从 w1 重新编号。
  // legacy 词表/备课脚本不含 clear，对它们零行为变化（「页内只增不减」不变）。
  let lastClear = -1;
  list.forEach(({ action }, index) => {
    if (action.type === 'clear') lastClear = index;
  });
  return lastClear >= 0 ? list.slice(lastClear + 1) : list;
}

/** 标注引用的全部 wN（串行链 gating 用）。 */
export function targetRefsOf(action: BoardAction): number[] {
  const raw =
    action.type === 'circle' || action.type === 'underline'
      ? action.target
      : action.type === 'mark'
        ? action.target
        : action.type === 'arrow'
          ? [action.from, action.to]
          : [];
  return (Array.isArray(raw) ? raw : [raw])
    .map(parseWriteRef)
    .filter((ref): ref is number => ref !== null);
}

export interface LectureFlowItem {
  key: string;
  /** write/image 等上板内容；undefined = new_column / 标注等不产生流式块的标记 */
  role?: BoardWriteRole;
  isColumnBreak: boolean;
}

export interface LectureFlow<T extends LectureFlowItem> {
  /** 页首通栏（前导 title） */
  header: T[];
  /** 1~2 栏，栏内从上到下 */
  columns: T[][];
}

/**
 * 流式内容分栏（纯函数）：
 * - 前导 title 块提升为通栏页眉（参考图：课题横贯页首，下方才分栏）；
 * - new_column 显式换栏（agent 主动）；超过 2 栏的换栏标记忽略（内容留在末栏）；
 * - autoBreakAfterKey：栏满兜底——该 key 之后的内容进下一栏（当前正在写的
 *   块不搬家，已写墨迹永不动摇）。
 */
export function splitLectureFlow<T extends LectureFlowItem>(
  items: T[],
  autoBreakAfterKey?: string | null,
): LectureFlow<T> {
  const header: T[] = [];
  let cursor = 0;
  while (cursor < items.length && items[cursor].role === 'title') {
    header.push(items[cursor]);
    cursor += 1;
  }
  const columns: T[][] = [[]];
  let column = 0;
  let hasExplicitBreak = false;
  for (let index = cursor; index < items.length; index += 1) {
    const item = items[index];
    if (item.isColumnBreak) {
      if (column < LECTURE_COLUMNS - 1) {
        column += 1;
        hasExplicitBreak = true;
        if (columns.length <= column) columns.push([]);
      }
      continue;
    }
    columns[column].push(item);
    if (!hasExplicitBreak && autoBreakAfterKey && item.key === autoBreakAfterKey && column < LECTURE_COLUMNS - 1) {
      column += 1;
      if (columns.length <= column) columns.push([]);
    }
  }
  return { header, columns };
}
