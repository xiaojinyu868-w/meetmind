/**
 * board-script-sanitize — BoardScript 清洗层（纯函数）。
 *
 * 清洗原则（AmIWrite）：坏动作跳过记 trace 不崩——非法 target 引用、未知
 * type、空 text、缺失字段一律丢弃并计数；页数 / 段数超限截断；
 * target 引用本页不存在的 wN 在页级二次清洗丢弃。
 * v3：cue 提取剥除（board-script.extractCues）、checkpoint 段型校验
 * （hints 必须恰好 3 级、缺字段整段丢弃）、ref 跨页引用校验（script 级）、
 * 无 type 字段的旧数据按 narration 兼容。
 */

import { MAX_PAGES, MAX_SEGMENTS_PER_PAGE, parseWriteRef } from './board-script';
import type { BoardAction, BoardPage, BoardQuote, BoardScript, BoardSegment } from './board-script';
import {
  asRecord,
  cleanBoardText,
  sanitizeSegment,
  toStartMs,
} from './board-script-sanitize-actions';

/** 收集动作引用的全部 wN（越界校验用）。 */
function actionRefs(action: BoardAction): number[] {
  switch (action.type) {
    case 'circle':
    case 'underline':
      return (Array.isArray(action.target) ? action.target : [action.target])
        .map(parseWriteRef)
        .filter((ref): ref is number => ref !== null);
    case 'arrow':
      return [parseWriteRef(action.from), parseWriteRef(action.to)].filter(
        (ref): ref is number => ref !== null,
      );
    case 'mark': {
      const ref = parseWriteRef(action.target);
      return ref === null ? [] : [ref];
    }
    default:
      return [];
  }
}

function filterActionsByWriteCount(actions: BoardAction[], writeCount: number): {
  actions: BoardAction[];
  dropped: number;
} {
  let dropped = 0;
  const kept = actions.filter((action) => {
    // ref 的 page 越界校验在 script 级（需要全部页），这里只放行
    if (action.type === 'ref') return true;
    const refs = actionRefs(action);
    if (refs.length === 0) return true;
    const inRange = refs.every((ref) => ref >= 1 && ref <= writeCount);
    if (!inRange) dropped += 1;
    return inRange;
  });
  return { actions: kept, dropped };
}

/** 页级二次清洗：标注引用本页不存在的 wN → 丢弃；demoActions 只允许引用页级 write。 */
function dropOutOfRangeAnnotations(page: BoardPage): { page: BoardPage; dropped: number } {
  let writeCount = 0;
  for (const segment of page.segments) {
    if (segment.type === 'checkpoint') continue;
    for (const action of segment.actions) {
      if (action.type === 'write') writeCount += 1;
    }
  }

  let dropped = 0;
  const segments = page.segments.map((segment) => {
    if (segment.type === 'checkpoint') {
      const result = filterActionsByWriteCount(segment.demoActions, writeCount);
      dropped += result.dropped;
      return { ...segment, demoActions: result.actions };
    }
    const result = filterActionsByWriteCount(segment.actions, writeCount);
    dropped += result.dropped;
    return { ...segment, actions: result.actions };
  });

  return { page: { segments }, dropped };
}

/** script 级三次清洗：ref 的 page / target 必须存在（target 页 write 序号）。 */
function dropOutOfRangeRefs(pages: BoardPage[]): { pages: BoardPage[]; dropped: number } {
  let dropped = 0;
  const writeCounts = pages.map((page) => {
    let count = 0;
    for (const segment of page.segments) {
      if (segment.type === 'checkpoint') continue;
      for (const action of segment.actions) {
        if (action.type === 'write') count += 1;
      }
    }
    return count;
  });

  const cleaned = pages.map((page, pageIndex) => ({
    segments: page.segments.map((segment) => {
      if (segment.type === 'checkpoint') return segment;
      const actions = segment.actions.filter((action) => {
        if (action.type !== 'ref') return true;
        const targetCount = writeCounts[action.page - 1] ?? 0;
        const targetRef = parseWriteRef(action.target);
        // 不允许引用当前页自己（原地跳转没有意义）
        const valid =
          action.page >= 1 &&
          action.page <= pages.length &&
          action.page !== pageIndex + 1 &&
          targetRef !== null &&
          targetRef >= 1 &&
          targetRef <= targetCount;
        if (!valid) dropped += 1;
        return valid;
      });
      return { ...segment, actions };
    }),
  }));

  return { pages: cleaned.map((page) => ({ segments: page.segments })), dropped };
}

function sanitizeQuotes(raw: unknown): BoardQuote[] {
  if (!Array.isArray(raw)) return [];
  const quotes: BoardQuote[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const text = cleanBoardText(record.text);
    if (!text) continue;
    const startMs = toStartMs(record.startMs);
    quotes.push(startMs === undefined ? { text } : { text, startMs });
  }
  return quotes;
}

/**
 * 把 LLM 的原始输出清洗成合法 BoardScript。
 * 不合规动作 / 段 / 页跳过并计数（dropped），绝不抛异常。
 * 一页都留不住时返回 1 个空段页，保证播放器有最低限度的可渲染结构。
 */
export function sanitizeBoardScript(raw: unknown): { script: BoardScript; dropped: number } {
  const record = asRecord(raw);
  let dropped = 0;

  const title = cleanBoardText(record?.title) || '这节课的板书';
  const quotes = sanitizeQuotes(record?.quotes);

  let pages: BoardPage[] = [];
  const rawPages = Array.isArray(record?.pages) ? record.pages : [];
  for (const rawPage of rawPages) {
    if (pages.length >= MAX_PAGES) {
      dropped += 1;
      continue;
    }
    const pageRecord = asRecord(rawPage);
    const rawSegments = Array.isArray(pageRecord?.segments) ? pageRecord.segments : [];
    const segments: BoardSegment[] = [];
    for (const rawSegment of rawSegments) {
      if (segments.length >= MAX_SEGMENTS_PER_PAGE) {
        dropped += 1;
        continue;
      }
      const { segment, dropped: segmentDropped } = sanitizeSegment(rawSegment);
      dropped += segmentDropped;
      if (segment) segments.push(segment);
    }
    if (segments.length > 0) {
      const result = dropOutOfRangeAnnotations({ segments });
      dropped += result.dropped;
      pages.push(result.page);
    } else {
      dropped += 1;
    }
  }

  const refsResult = dropOutOfRangeRefs(pages);
  pages = refsResult.pages;
  dropped += refsResult.dropped;

  if (pages.length === 0) {
    pages.push({
      segments: [
        { type: 'narration', narration: '这节课的内容还在整理。', narrationDisplay: '这节课的内容还在整理。', cues: [], actions: [] },
      ],
    });
  }

  return { script: { title, pages, quotes }, dropped };
}
