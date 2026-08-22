/**
 * board-script-sanitize-actions — 动作 / 段级形状清洗（纯函数）。
 *
 * 只做形状校验，不做越界校验（wN / page 是否越界需要页级、script 级上下文，
 * 见 board-script-sanitize.ts 的二次 / 三次清洗）。
 */

import {
  extractCues,
  HINT_COUNT,
  MAX_ACTIONS_PER_SEGMENT,
  MAX_PAUSE_MS,
  parseWriteRef,
} from './board-script';
import type {
  BoardAction,
  BoardArrowAction,
  BoardCue,
  BoardSegment,
  BoardWriteRole,
  CheckpointSegment,
  NarrationSegment,
} from './board-script';

function normalizeTargets(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set<number>();
  const targets: string[] = [];
  for (const item of raw) {
    const ref = parseWriteRef(item);
    if (ref === null || seen.has(ref)) continue;
    seen.add(ref);
    targets.push(`w${ref}`);
  }
  return targets;
}

/** write 文本：去控制字符、压缩空白；空串判非法。 */
export function cleanBoardText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const WRITE_ROLES: readonly string[] = ['title', 'term', 'step', 'note', 'formula'];

// ── sanitize ───────────────────────────────────────────────────────────────

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function toStartMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return undefined;
}

/** 形状清洗（不校验 wN / page 是否越界——那些需要上下文，见页级/script 级清洗）。 */
function sanitizeActionShape(raw: unknown): BoardAction | null {
  const record = asRecord(raw);
  if (!record) return null;

  switch (record.type) {
    case 'write': {
      const text = cleanBoardText(record.text);
      const role = typeof record.role === 'string' ? record.role : '';
      if (!text || !WRITE_ROLES.includes(role)) return null;
      return { type: 'write', text, role: role as BoardWriteRole };
    }
    case 'circle': {
      const targets = normalizeTargets(record.target);
      if (targets.length === 0) return null;
      return { type: 'circle', target: targets.length === 1 ? targets[0] : targets };
    }
    case 'underline': {
      const targets = normalizeTargets(record.target);
      if (targets.length === 0) return null;
      return { type: 'underline', target: targets.length === 1 ? targets[0] : targets };
    }
    case 'arrow': {
      const from = parseWriteRef(record.from);
      const to = parseWriteRef(record.to);
      if (from === null || to === null) return null;
      const label = cleanBoardText(record.label);
      const arrow: BoardArrowAction = { type: 'arrow', from: `w${from}`, to: `w${to}` };
      if (label) arrow.label = label;
      return arrow;
    }
    case 'mark': {
      const target = parseWriteRef(record.target);
      if (target === null) return null;
      if (record.mark !== 'check' && record.mark !== 'cross') return null;
      return { type: 'mark', mark: record.mark, target: `w${target}` };
    }
    case 'ref': {
      const page = toStartMs(record.page);
      const target = parseWriteRef(record.target);
      if (page === undefined || page < 1 || target === null) return null;
      return { type: 'ref', page, target: `w${target}` };
    }
    case 'pause': {
      const ms = toStartMs(record.ms);
      if (ms === undefined || ms <= 0) return null;
      return { type: 'pause', ms: Math.min(ms, MAX_PAUSE_MS) };
    }
    case 'new_column':
      // v31 分栏布局标记：无字段可校验，形状对就放行
      return { type: 'new_column' };
    case 'image': {
      // v28 贴图：url（生成后回填）或 prompt（待生成）至少其一；caption 可选
      const url = cleanBoardText(record.url);
      const prompt = cleanBoardText(record.prompt);
      if (!url && !prompt) return null;
      const caption = cleanBoardText(record.caption);
      return {
        type: 'image',
        url,
        ...(prompt ? { prompt } : {}),
        ...(caption ? { caption } : {}),
      };
    }
    default:
      return null;
  }
}

function sanitizeActionList(raw: unknown): { actions: BoardAction[]; dropped: number } {
  let dropped = 0;
  const actions: BoardAction[] = [];
  const rawActions = Array.isArray(raw) ? raw : [];
  for (const rawAction of rawActions) {
    if (actions.length >= MAX_ACTIONS_PER_SEGMENT) {
      dropped += 1;
      continue;
    }
    const action = sanitizeActionShape(rawAction);
    if (action) actions.push(action);
    else dropped += 1;
  }
  return { actions, dropped };
}

/**
 * 数据态 cue（导演 pass 注入，不经 narration 标记）校验：
 * actionIndex/charIndex 越界丢弃、按 actionIndex 去重（先赢）；
 * 不是数组或过滤后为空 → null（调用方回退到 narration 内联 cue 提取）。
 */
function sanitizeDataCues(raw: unknown, actionCount: number, displayLength: number): BoardCue[] | null {
  if (!Array.isArray(raw)) return null;
  const cues: BoardCue[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const record = asRecord(item);
    const actionIndex = typeof record?.actionIndex === 'number' ? record.actionIndex : -1;
    const charIndex = typeof record?.charIndex === 'number' ? record.charIndex : -1;
    if (actionIndex < 0 || actionIndex >= actionCount) continue;
    if (seen.has(actionIndex)) continue;
    if (charIndex < 0 || charIndex > displayLength) continue;
    seen.add(actionIndex);
    cues.push({ actionIndex, charIndex: Math.round(charIndex) });
  }
  return cues.length > 0 ? cues : null;
}

/** breathMs（导演 pass 段后呼吸）：数字 clamp 到 [0, 2500]，非数字丢弃。 */
function sanitizeBreathMs(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.min(2500, Math.max(0, Math.round(raw)));
}

function sanitizeNarrationSegment(record: Record<string, unknown>): {
  segment: NarrationSegment | null;
  dropped: number;
} {
  const narration = cleanBoardText(record.narration);
  if (!narration) return { segment: null, dropped: 1 };

  const { actions, dropped } = sanitizeActionList(record.actions);
  const cuesResult = extractCues(narration, actions.length);
  // 数据态 cue（导演注入）优先；没有才回退 narration 内联 [aN] 提取
  const dataCues = sanitizeDataCues(record.cues, actions.length, cuesResult.display.length);
  const breathMs = sanitizeBreathMs(record.breathMs);
  return {
    segment: {
      type: 'narration',
      narration,
      narrationDisplay: cuesResult.display,
      cues: dataCues ?? cuesResult.cues,
      ...(breathMs !== undefined ? { breathMs } : {}),
      actions,
    },
    dropped: dropped + cuesResult.dropped,
  };
}

function sanitizeCheckpointSegment(record: Record<string, unknown>): {
  segment: CheckpointSegment | null;
  dropped: number;
} {
  const narration = cleanBoardText(record.narration);
  const question = asRecord(record.question);
  const questionText = cleanBoardText(question?.text);
  const questionRole = question?.role;
  const answer = cleanBoardText(record.answer);
  const rawHints = Array.isArray(record.hints) ? record.hints : [];
  const hints = rawHints.map((hint) => cleanBoardText(hint)).filter((hint) => hint.length > 0);

  // hints 必须恰好 3 级；question/answer 缺字段 → 整段丢弃
  if (
    !narration ||
    !questionText ||
    (questionRole !== 'term' && questionRole !== 'step') ||
    hints.length !== HINT_COUNT ||
    !answer
  ) {
    return { segment: null, dropped: 1 };
  }

  const { actions: demoActions, dropped } = sanitizeActionList(record.demoActions);
  const cuesResult = extractCues(narration, demoActions.length);
  // 答案的 cue 指向 demoActions（解析念到哪，示范写到哪）——不提取的话
  // [aN] 会被 TTS 逐字念出、字幕外露（2026-08-19 用户实测）
  const answerCuesResult = extractCues(answer, demoActions.length);
  // hints / question.text 没有动作可指：标记一律剥除（actionCount=0 → 全部丢弃并剥掉）
  const hintResults = hints.map((hint) => extractCues(hint, 0));
  const questionCuesResult = extractCues(questionText, 0);
  const markerDrops =
    questionCuesResult.dropped + hintResults.reduce((sum, result) => sum + result.dropped, 0);
  return {
    segment: {
      type: 'checkpoint',
      narration,
      narrationDisplay: cuesResult.display,
      cues: cuesResult.cues,
      question: { text: questionCuesResult.display || questionText, role: questionRole },
      hints: hintResults.map((result) => result.display) as CheckpointSegment['hints'],
      answer,
      answerDisplay: answerCuesResult.display,
      answerCues: answerCuesResult.cues,
      demoActions,
    },
    dropped: dropped + cuesResult.dropped + answerCuesResult.dropped + markerDrops,
  };
}

/** 段级清洗入口：无 type 字段的旧数据按 narration 兼容。 */
export function sanitizeSegment(raw: unknown): { segment: BoardSegment | null; dropped: number } {
  const record = asRecord(raw);
  if (!record) return { segment: null, dropped: 1 };
  if (record.type === 'checkpoint') return sanitizeCheckpointSegment(record);
  return sanitizeNarrationSegment(record);
}
