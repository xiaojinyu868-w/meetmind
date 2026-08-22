/**
 * board-tts-service — 板书 narration 语音合成（DashScope CosyVoice，SSE 流式 + 字级时间戳）。
 *
 * 端点：POST /api/v1/services/audio/tts/SpeechSynthesizer（X-DashScope-SSE: enable），
 * 鉴权复用 DASHSCOPE_API_KEY（与 qwen/ASR 同一把 key，零新增凭证）。
 *
 * 坐标系实测结论（2026-08，scripts/try-dashscope-tts.ts 验证）：
 * - 字级时间戳在 sentence-begin 事件里：output.sentence.words[] =
 *   { text, begin_index, end_index, begin_time, end_time(ms) }
 * - begin_index/end_index 对应**归一化后文本**（空格被剥、数字 TN 展开如 2025→二零二五），
 *   不是输入文本下标——所以这里做 alignTimingsToInput 单调对齐映射回输入文本；
 *   中英混合处引擎可能产出重叠/合并的词（如 "字Jane"），对齐时跳过无法匹配的项。
 *
 * 未配置 / 失败一律返回 null（调用方走 speechSynthesis / timer fallback）。
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('board-tts');

const ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
// 2026-08 选型（scripts/try-tts-voices.ts 实测，试听样本 public/demo/tts-samples/）：
// cosyvoice-v3-flash 自然度/情感增强代；longanhuan 的 Instruct 官方支持「课堂教学」场景；
// 字级时间戳实测可用（qwen-audio-3.0-tts-flash 无时间戳、plus 加 instruction 后丢时间戳，均排除）。
const DEFAULT_MODEL = 'cosyvoice-v3-flash';
/** 龙安欢：欢脱元气女，配课堂教学指令后是候选里最像真人老师的 */
const DEFAULT_VOICE = 'longanhuan';
/** cosyvoice v3 系统音色指令必须用官方固定格式（场景+情感） */
const DEFAULT_INSTRUCTION = '你正在进行课堂教学，你说话的情感是neutral。';
const TIMEOUT_MS = 30_000;

export interface WordTiming {
  text: string;
  /** 相对输入文本的字符下标 */
  charStart: number;
  charEnd: number;
  beginMs: number;
  endMs: number;
}

interface RawWord {
  text: string;
  begin_index: number;
  end_index: number;
  begin_time: number;
  end_time: number;
}

const CJK_NUMERAL_RE = /^[零〇一二三四五六七八九十百千万亿两]+$/;

/**
 * 把引擎归一化坐标系的字级时间戳单调对齐回输入文本：
 * - 顺序消费 words，在输入文本里从游标处找 word.text（找不到就剥空格再找）
 * - 数字段：引擎把数字 TN 成中文数词（2025→"二""零""二""五" 多个词），
 *   连续数词词按序均分输入里的数字段
 * - 对不上的词（引擎合并/重叠产物）直接跳过，保持单调
 */
export function alignTimingsToInput(text: string, words: RawWord[]): WordTiming[] {
  // 剥空白坐标系：引擎会剥空格、合并跨语言词（如 "字Jane"），
  // 统一在剥空白后的文本上匹配，再用 idxMap 映回输入文本下标
  const stripped: string[] = [];
  const idxMap: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) {
      stripped.push(text[i]);
      idxMap.push(i);
    }
  }
  const haystack = stripped.join('');

  const out: WordTiming[] = [];
  let cursor = 0; // 剥空白坐标系游标
  // 数字段均分状态：遇中文数词词时开启，按序把输入里的数字段切给连续数词词
  let numeralRun: { start: number; end: number; total: number } | null = null;
  let numeralSeq = 0;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const needle = word.text.replace(/\s+/g, '');
    if (!needle) continue;

    // 数字 TN：中文数词词 → 输入里的数字段
    if (CJK_NUMERAL_RE.test(needle)) {
      if (!numeralRun) {
        const digitMatch = /\d+/.exec(haystack.slice(cursor));
        if (!digitMatch) continue;
        const start = cursor + digitMatch.index;
        let total = 1;
        while (
          i + total < words.length &&
          CJK_NUMERAL_RE.test(words[i + total].text.replace(/\s+/g, ''))
        ) {
          total += 1;
        }
        numeralRun = { start, end: start + digitMatch[0].length, total };
        numeralSeq = 0;
      }
      const slot = (numeralRun.end - numeralRun.start) / numeralRun.total;
      const charStart = idxMap[Math.round(numeralRun.start + slot * numeralSeq)];
      const endIdx = Math.min(numeralRun.end - 1, Math.round(numeralRun.start + slot * (numeralSeq + 1)) - 1);
      out.push({
        text: word.text,
        charStart,
        charEnd: idxMap[Math.max(Math.round(numeralRun.start + slot * numeralSeq), endIdx)] + 1,
        beginMs: word.begin_time,
        endMs: word.end_time,
      });
      numeralSeq += 1;
      if (numeralSeq >= numeralRun.total) {
        cursor = numeralRun.end;
        numeralRun = null;
      }
      continue;
    }
    numeralRun = null;

    // 常规：剥空白坐标系里精确查找（大小写不敏感）；
    // 引擎合并词会与前一个词重叠（如 "字Jane" 吃掉前一个 "字"），允许回退重查
    let hit = haystack.indexOf(needle, cursor);
    if (hit < 0) hit = haystack.toLowerCase().indexOf(needle.toLowerCase(), cursor);
    if (hit < 0) {
      const backtrack = Math.max(0, cursor - needle.length);
      hit = haystack.indexOf(needle, backtrack);
      if (hit < 0) hit = haystack.toLowerCase().indexOf(needle.toLowerCase(), backtrack);
      // 只允许词尾越过游标的重叠命中，保证游标单调前进
      if (hit >= 0 && hit + needle.length <= cursor) hit = -1;
    }
    if (hit < 0) continue; // 对不上的引擎产物，跳过保持单调

    const charStart = idxMap[hit];
    const charEnd = idxMap[hit + needle.length - 1] + 1;
    out.push({ text: word.text, charStart, charEnd, beginMs: word.begin_time, endMs: word.end_time });
    cursor = hit + needle.length;
  }

  return out;
}

/** 按播放时刻把 timings 插值成当前字符下标（与 speechSynthesis boundary 同坐标系）。 */
export function charIndexAtMs(timings: WordTiming[], ms: number, textLength: number): number {
  if (timings.length === 0) return 0;
  for (const timing of timings) {
    if (ms < timing.beginMs) return timing.charStart;
    if (ms < timing.endMs) {
      const span = Math.max(1, timing.endMs - timing.beginMs);
      const ratio = (ms - timing.beginMs) / span;
      return Math.min(timing.charEnd, Math.floor(timing.charStart + ratio * (timing.charEnd - timing.charStart)));
    }
  }
  return textLength;
}

interface SpeechSynthesizerEvent {
  output?: {
    sentence?: { words?: RawWord[]; index?: number };
    audio?: { data?: string };
    finish_reason?: string;
    type?: string;
  };
  code?: string;
  message?: string;
}

/** 解析 SSE 事件流文本 → 音频块 + 字级时间戳（纯函数，可单测）。
 *  words 事件在同一句内是累积数组（5→13→26…），每句只保留最长的一份。 */
export function parseSseStream(raw: string): { audio: Buffer; words: RawWord[]; error: string | null } {
  const audioChunks: Buffer[] = [];
  const wordsBySentence = new Map<number, RawWord[]>();
  let error: string | null = null;

  for (const block of raw.split('\n\n')) {
    const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    let event: SpeechSynthesizerEvent;
    try {
      event = JSON.parse(dataLine.slice(5)) as SpeechSynthesizerEvent;
    } catch {
      continue;
    }
    if (event.code) {
      error = event.message ?? event.code;
      continue;
    }
    const audio = event.output?.audio?.data;
    if (audio) audioChunks.push(Buffer.from(audio, 'base64'));
    const sentence = event.output?.sentence;
    if (sentence?.words && sentence.words.length > 0) {
      const index = sentence.index ?? 0;
      const previous = wordsBySentence.get(index);
      if (!previous || sentence.words.length >= previous.length) {
        wordsBySentence.set(index, sentence.words);
      }
    }
  }

  const words = [...wordsBySentence.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, sentenceWords]) => sentenceWords);
  return { audio: Buffer.concat(audioChunks), words, error };
}

function readConfig(): { apiKey: string; model: string; voice: string; instruction: string } | null {
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: (process.env.DASHSCOPE_TTS_MODEL || DEFAULT_MODEL).trim(),
    voice: (process.env.DASHSCOPE_TTS_VOICE || DEFAULT_VOICE).trim(),
    // 显式设空字符串可关闭指令（部分音色/模型组合带指令会丢字级时间戳）
    instruction: (process.env.DASHSCOPE_TTS_INSTRUCTION ?? DEFAULT_INSTRUCTION).trim(),
  };
}

/**
 * 合成一段 narration：SSE 流式收齐全量音频 + 字级时间戳，
 * 时间戳坐标经 alignTimingsToInput 映射回输入文本。
 * 未配置 / 网络失败 / 引擎报错 / 无音频 → null。
 *
 * 上游限流策略（2026-08-18 实测修正）：cosyvoice 免费档 QPS 极低，预取突发
 * （首屏 6 段 + 跨页 + checkpoint）会吃 428 并触发一段时间的惩罚性限流。
 * 因此并发闸收紧到 1 路（串行化所有合成），失败按 1s/2s/4s 退避重试 3 次，
 * 把瞬时抖动与限流窗口在服务端吸收，不要把 null 抛给客户端降级成机器人音。
 */
let ttsInFlight = 0;
const ttsQueue: Array<() => void> = [];

async function acquireTtsSlot(): Promise<void> {
  if (ttsInFlight >= 1) {
    await new Promise<void>((resolve) => ttsQueue.push(resolve));
  }
  ttsInFlight += 1;
}

function releaseTtsSlot(): void {
  ttsInFlight -= 1;
  ttsQueue.shift()?.();
}

async function synthesizeOnce(
  config: { apiKey: string; model: string; voice: string; instruction: string },
  input: string,
): Promise<{ audio: Buffer; timings: WordTiming[] } | null> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'enable',
      },
      body: JSON.stringify({
        model: config.model,
        input: {
          text: input,
          voice: config.voice,
          // wav（PCM）：mp3 编码器固有的首尾 padding 会在段间拼出可闻缝隙，
          // 板书逐段合成+连播的场景必须用无损容器消除接缝
          format: 'wav',
          sample_rate: 24000,
          word_timestamp_enabled: true,
          ...(config.instruction ? { instruction: config.instruction } : {}),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn('board tts http 失败', { status: response.status });
      return null;
    }

    const { audio, words, error } = parseSseStream(await response.text());
    if (error) {
      log.warn('board tts 引擎报错', { error });
      return null;
    }
    if (audio.length === 0) {
      log.warn('board tts 无音频产出');
      return null;
    }

    return { audio, timings: alignTimingsToInput(input, words) };
  } catch (cause) {
    log.warn('board tts 请求异常', { error: cause instanceof Error ? cause.message : String(cause) });
    return null;
  }
}

export async function synthesizeBoardNarration(
  text: string,
): Promise<{ audio: Buffer; timings: WordTiming[] } | null> {
  const config = readConfig();
  if (!config) {
    log.warn('DASHSCOPE_API_KEY 未配置，板书 TTS 走 fallback');
    return null;
  }
  const input = text.trim();
  if (!input) return null;

  await acquireTtsSlot();
  try {
    // 1s/2s/4s/8s/16s 退避重试 6 次：免费档 428 惩罚窗口实测可达 10s+，
    // 串行闸下单段最坏 +31s 也好过把 null 抛给客户端降级成机器人音
    const BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 16000];
    for (const waitMs of BACKOFF_MS) {
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const result = await synthesizeOnce(config, input);
      if (result) return result;
    }
    return null;
  } finally {
    releaseTtsSlot();
  }
}
