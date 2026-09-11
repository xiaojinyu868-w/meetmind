import type { TeachBackJudgeId, TeachBackTurn } from './types';

/**
 * teach-back-panel — 「讲给同桌听」评委席的纯逻辑（前后端共用，禁止 Node 侧依赖）。
 *
 * - 评委名册：三位评委的 id / 座位 / 声音（名字与性格说明是用户面字符串，在 copy-apps.ts）
 * - 评委回合的流式契约：模型输出第一行是开口者代号（direct / guide / probe / none），
 *   从第二行起是这位评委的话；`JudgeStreamParser` 边收边解析，头一行没齐之前不吐文字
 * - SSE 事件类型（/api/apps/teach-back/turn）与客户端解析
 * - 历史裁剪：给模型的本场记录按字数预算保留最近的部分
 */

export const TEACH_BACK_JUDGE_IDS: readonly TeachBackJudgeId[] = ['direct', 'guide', 'probe'];

export interface TeachBackJudgeSpec {
  id: TeachBackJudgeId;
  /** 百炼 qwen3-tts 音色（三位评委三种声音；/api/teach/tts 白名单里都有） */
  voice: string;
  /** 合成语气指令 */
  ttsInstruct: string;
}

export const TEACH_BACK_JUDGES: readonly TeachBackJudgeSpec[] = [
  { id: 'direct', voice: 'Ethan', ttsInstruct: '你是一位直言的评委，语气冷静、干脆，不拖泥带水' },
  { id: 'guide', voice: 'Serena', ttsInstruct: '你是一位循循善诱的评委，语气温和、耐心，像在带着人往前走' },
  { id: 'probe', voice: 'Chelsie', ttsInstruct: '你是一位爱追问细节的评委，语气好奇、轻快' },
];

export function isTeachBackJudgeId(value: unknown): value is TeachBackJudgeId {
  return typeof value === 'string' && (TEACH_BACK_JUDGE_IDS as readonly string[]).includes(value);
}

export function judgeSpecOf(id: TeachBackJudgeId): TeachBackJudgeSpec {
  return TEACH_BACK_JUDGES.find((judge) => judge.id === id) ?? TEACH_BACK_JUDGES[1];
}

/** 评委回合 SSE 事件（服务端 → 客户端，每条 `data: <json>`） */
export type TeachBackPanelEvent =
  | { type: 'judge'; judgeId: TeachBackJudgeId }
  | { type: 'delta'; text: string }
  | { type: 'done'; judgeId: TeachBackJudgeId; text: string }
  | { type: 'silent' }
  | { type: 'error'; message: string };

export interface JudgeHeader {
  /** null = 大家都不开口 */
  judge: TeachBackJudgeId | null;
  /** 代号后面同一行里跟着的正文（模型把话写在同一行时不能丢） */
  rest: string;
}

const HEADER_PATTERN = new RegExp(
  '^\\s*[\\[【（(「*_`#]*\\s*(?:评委|judge|speaker|开口者?|谁开口)?\\s*[:：]?\\s*' +
  '(direct|guide|probe|none|null|无|没人|沉默|安静|不开口|pass)' +
  '\\s*[\\]】）)」*_`]*\\s*[:：,，。.\\-—]*\\s*(.*)$',
  'i',
);

/**
 * 模型第一行 → 开口者。容忍 `评委：direct` / `[guide]` / `probe: 你刚才说…`（同一行带正文）这类写法；
 * none / 无 / 沉默 / 不开口 → judge=null（大家都不开口）；认不出 → undefined（由调用方决定怎么兜）。
 */
export function parseJudgeHeader(line: string): JudgeHeader | undefined {
  const match = HEADER_PATTERN.exec(line);
  if (!match) return undefined;
  const token = match[1].toLowerCase();
  const rest = match[2] ?? '';
  if (isTeachBackJudgeId(token)) return { judge: token, rest };
  return { judge: null, rest };
}

/**
 * 模型没按契约写头行时的归属：把话给最近没开口的那位（不是模板反馈——话是模型说的，只是补个座位）。
 */
export function fallbackJudge(recentSpeakers: TeachBackJudgeId[]): TeachBackJudgeId {
  const recent = new Set(recentSpeakers.slice(-2));
  return TEACH_BACK_JUDGE_IDS.find((id) => !recent.has(id)) ?? 'guide';
}

export interface JudgeStreamChunk {
  /** 头行解析完成时给一次：谁开口（null = 沉默） */
  judge?: TeachBackJudgeId | null;
  /** 可以直接展示 / 送 TTS 的文字增量 */
  text?: string;
}

/**
 * 增量解析模型输出：头一行（开口者）没齐之前 buffer，之后逐字透传。
 * 头行超过 24 个字符还没换行 → 认定模型直接开讲没写头行，用 fallback 归属并把 buffer 当正文吐出。
 */
export class JudgeStreamParser {
  private buffer = '';
  private headerDone = false;
  private judge: TeachBackJudgeId | null = null;
  private readonly fallback: TeachBackJudgeId;

  constructor(recentSpeakers: TeachBackJudgeId[] = []) {
    this.fallback = fallbackJudge(recentSpeakers);
  }

  get judgeId(): TeachBackJudgeId | null {
    return this.judge;
  }

  get resolved(): boolean {
    return this.headerDone;
  }

  push(delta: string): JudgeStreamChunk[] {
    if (this.headerDone) {
      return delta ? [{ text: delta }] : [];
    }
    this.buffer += delta;
    const newline = this.buffer.indexOf('\n');
    if (newline === -1) {
      // 头行还没换行：代号最长 6 个字母加装饰，超过 24 字符还没换行 = 模型直接开讲没写头行
      if (this.buffer.trim().length < 24) return [];
      const inline = parseJudgeHeader(this.buffer);
      if (inline) return this.resolveHeader(inline.judge, inline.rest);
      return this.resolveHeader(this.fallback, this.buffer);
    }
    const header = this.buffer.slice(0, newline);
    const rest = this.buffer.slice(newline + 1);
    const parsed = parseJudgeHeader(header);
    if (!parsed) return this.resolveHeader(this.fallback, `${header}\n${rest}`);
    return this.resolveHeader(parsed.judge, parsed.rest ? `${parsed.rest}\n${rest}` : rest);
  }

  /** 流结束：头行都没凑齐的短输出也要给个说法 */
  flush(): JudgeStreamChunk[] {
    if (this.headerDone) return [];
    if (!this.buffer.trim()) return this.resolveHeader(null, '');
    const parsed = parseJudgeHeader(this.buffer);
    if (parsed) {
      // 整个输出就一行代号（如 "none" / "probe"）——有代号没正文按沉默处理
      return this.resolveHeader(parsed.rest.trim() ? parsed.judge : null, parsed.rest);
    }
    return this.resolveHeader(this.fallback, this.buffer);
  }

  private resolveHeader(judge: TeachBackJudgeId | null, rest: string): JudgeStreamChunk[] {
    this.headerDone = true;
    this.buffer = '';
    this.judge = judge;
    if (judge === null) return [{ judge: null }];
    const body = rest.replace(/^\s+/, '');
    return body ? [{ judge }, { text: body }] : [{ judge }];
  }
}

/**
 * 单条评委发言的上限（保险丝，不是目标）：v2 prompt 要的是一句话 + 一个问题，二三十个字读出来五六秒；
 * 90 字 ≈ 三句话，超过它基本是模型开始讲课了（服务端截断，客户端照单全收）。v1 是 220（1-3 句 + 追问，实测 TTS 10-13 秒）。
 */
export const JUDGE_SAY_MAX_CHARS = 90;

/**
 * 给模型看的本场记录：按字数预算从最近往前保留，至少保留最后两条用户发言；
 * `maxUserTurns` 再从回合数上封顶（评委席只看最近两回合——它回应的是刚讲的这段，不翻旧账）。
 */
export function trimPanelHistory(turns: TeachBackTurn[], maxChars = 6_000, maxUserTurns = Number.POSITIVE_INFINITY): TeachBackTurn[] {
  const kept: TeachBackTurn[] = [];
  let used = 0;
  let userKept = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const length = turn.text.length + 4;
    if (userKept >= maxUserTurns) break; // 再往前的评委发言回应的是更早的回合
    if (used + length > maxChars && userKept >= 2) break;
    kept.unshift(turn);
    used += length;
    if (turn.role === 'user') userKept += 1;
  }
  return kept;
}

export interface TranscriptWindowSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptWindowOptions {
  /** 总字数预算 */
  maxChars?: number;
  /** 命中的段带前后各几段邻居（老师讲一个概念不会只在一句里） */
  neighbors?: number;
}

export interface TranscriptWindow {
  segments: TranscriptWindowSegment[];
  /** 是节选（有段被略去）还是整节课都给了 */
  windowed: boolean;
}

const QUERY_STOP_CHARS = /[\s，。！？；、,.!?;:：""''「」『』（）()《》〈〉【】\-—…·]/g;

/** 讲述文本 → 匹配用的特征：汉字二元组 + 拉丁 / 数字整词（"f""Rf""x²"这类符号在数学课里是关键词） */
export function transcriptQueryFeatures(text: string): Set<string> {
  const features = new Set<string>();
  const cleaned = text.replace(QUERY_STOP_CHARS, ' ');
  for (const token of cleaned.split(' ')) {
    if (!token) continue;
    const latin = token.match(/[A-Za-z0-9²³⁻¹]+/g) ?? [];
    for (const word of latin) features.add(word.toLowerCase());
    const cjk = token.replace(/[A-Za-z0-9²³⁻¹]+/g, '');
    for (let i = 0; i + 1 < cjk.length; i += 1) features.add(cjk.slice(i, i + 2));
  }
  return features;
}

/**
 * 评委看的原文窗口：不是整节课，是"与他刚讲这段最相关的几段（带邻居）+ 目标点的证据段"，按课堂顺序拼、总字数 ≤ maxChars。
 * 相关度 = 讲述特征（transcriptQueryFeatures）在段里命中的个数。整节课装得下就原样全给；
 * 什么都对不上（讲的与这节课无关）→ 退回开头的几段——评委仍要知道这节课在讲什么，沉默才有依据。
 * 为什么不逐段压缩（buildPromptTranscriptContext 超预算时的做法）：每段都剩半截，老师的每句话都被截断，评委反而没法核对。
 */
export function selectRelevantTranscript(
  transcript: TranscriptWindowSegment[],
  segment: string,
  targets: Array<{ evidence?: { startMs: number; endMs: number } | null }> = [],
  options: TranscriptWindowOptions = {},
): TranscriptWindow {
  const maxChars = Math.max(200, options.maxChars ?? 5_000);
  const neighbors = Math.max(0, options.neighbors ?? 1);
  const total = transcript.reduce((sum, item) => sum + item.text.length, 0);
  if (total <= maxChars) return { segments: transcript, windowed: false };

  const features = transcriptQueryFeatures(segment);
  const scores = transcript.map((item) => {
    let hits = 0;
    const lower = item.text.toLowerCase();
    // 单个字母（f / g / x / y）满课都是，只算四分之一票；一段至少要凑够一票才算相关
    for (const feature of features) if (lower.includes(feature)) hits += feature.length >= 2 ? 1 : 0.25;
    return hits >= 1 ? hits : 0;
  });

  const picked = new Set<number>();
  let used = 0;
  const tryAdd = (index: number): boolean => {
    if (index < 0 || index >= transcript.length || picked.has(index)) return true;
    const length = transcript[index].text.length;
    if (used + length > maxChars) return false;
    picked.add(index);
    used += length;
    return true;
  };

  // 目标点的证据段先进（手卡上那几点是这一场要覆盖的）
  for (const target of targets) {
    const evidence = target.evidence;
    if (!evidence) continue;
    transcript.forEach((item, index) => {
      if (item.endMs >= evidence.startMs && item.startMs <= evidence.endMs) tryAdd(index);
    });
  }

  const order = scores
    .map((score, index) => ({ score, index }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const { index } of order) {
    if (!tryAdd(index)) break;
    for (let offset = 1; offset <= neighbors; offset += 1) {
      tryAdd(index - offset);
      tryAdd(index + offset);
    }
  }

  // 一段都没对上：给开头，让评委至少知道这节课讲什么
  if (order.length === 0) {
    for (let index = 0; index < transcript.length; index += 1) if (!tryAdd(index)) break;
  }

  const segments = [...picked].sort((a, b) => a - b).map((index) => transcript[index]);
  return { segments, windowed: segments.length < transcript.length };
}

/** 最近开口过的评委（新→旧），供 prompt 提示"刚说过话的人"与 fallback 归属 */
export function recentJudgeIds(turns: TeachBackTurn[], limit = 3): TeachBackJudgeId[] {
  const out: TeachBackJudgeId[] = [];
  for (let index = turns.length - 1; index >= 0 && out.length < limit; index -= 1) {
    const turn = turns[index];
    if (turn.role === 'assistant' && turn.judgeId) out.push(turn.judgeId);
  }
  return out;
}

/**
 * 客户端 SSE 解析：把新到的字节段拼进 carry，切出完整的 `data:` 行，返回事件与剩余。
 * 兼容 `: ping` 注释行与 `data: [DONE]`。
 */
export function parseSseChunk(carry: string, chunk: string): { events: TeachBackPanelEvent[]; carry: string } {
  const buffer = carry + chunk;
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: TeachBackPanelEvent[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as Partial<TeachBackPanelEvent> & { type?: string };
      if (parsed.type === 'judge' && isTeachBackJudgeId(parsed.judgeId)) {
        events.push({ type: 'judge', judgeId: parsed.judgeId });
      } else if (parsed.type === 'delta' && typeof parsed.text === 'string') {
        events.push({ type: 'delta', text: parsed.text });
      } else if (parsed.type === 'done' && isTeachBackJudgeId(parsed.judgeId) && typeof parsed.text === 'string') {
        events.push({ type: 'done', judgeId: parsed.judgeId, text: parsed.text });
      } else if (parsed.type === 'silent') {
        events.push({ type: 'silent' });
      } else if (parsed.type === 'error') {
        events.push({ type: 'error', message: typeof parsed.message === 'string' ? parsed.message : '' });
      }
    } catch {
      /* 半截 JSON 不该出现在完整行里；出现了就跳过这一行 */
    }
  }
  return { events, carry: rest };
}
