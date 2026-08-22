import type { TranscriptSegment } from '@/types';

/**
 * Explainer 引用校验（纯函数，客户端/服务端/测试共用）。
 *
 * 唯一保留的防线：页面上所有以「老师原话」出现的引用（<q class="mm-quote">）
 * 必须是转录原文的逐字子串。字符串匹配，不用 LLM 校验。
 * 校验失败的引用降级为转述（q → span.mm-said），不阻断产物。
 */

export interface ExplainerQuote {
  text: string;
  startMs?: number;
}

export interface ExplainerQuoteValidation {
  valid: ExplainerQuote[];
  invalid: ExplainerQuote[];
}

/** 去掉所有空白字符后比较：跨段拼接、换行/空格差异因此天然兼容。 */
function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, '');
}

/** 全部 segment.text 直接拼接（去空白），作为逐字校验语料。 */
export function buildTranscriptCorpus(segments: TranscriptSegment[]): string {
  return stripWhitespace(segments.map((segment) => segment.text || '').join(''));
}

export function validateExplainerQuotes(
  quotes: Array<{ text: string; startMs?: number }>,
  segments: TranscriptSegment[],
): ExplainerQuoteValidation {
  const corpus = buildTranscriptCorpus(segments);
  const valid: ExplainerQuote[] = [];
  const invalid: ExplainerQuote[] = [];

  for (const quote of quotes) {
    const text = typeof quote?.text === 'string' ? quote.text.trim() : '';
    if (!text) continue;
    const normalized = stripWhitespace(text);
    if (normalized && corpus.includes(normalized)) {
      valid.push({ text, startMs: quote.startMs });
    } else {
      invalid.push({ text, startMs: quote.startMs });
    }
  }

  return { valid, invalid };
}

/**
 * 匹配 <q class="mm-quote" ...>inner</q>；class 与 data-ts 属性顺序不限，
 * class 值里允许有其他类名。引号单双皆可。
 */
const QUOTE_TAG_SOURCE = String.raw`<q\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bmm-quote\b)[^>]*>([\s\S]*?)<\/q>`;

/** inner 里可能嵌少量标签，比较时剥掉标签只比文字。 */
function innerTextOf(fragment: string): string {
  return stripWhitespace(fragment.replace(/<[^>]+>/g, ''));
}

/**
 * 对每条校验失败的引用，把对应的 <q class="mm-quote"> 换成
 * <span class="mm-said">（同文本，去掉引用样式即降级为转述）。
 * inner text 允许首尾/中间空白差异；找不到就跳过，不阻断产物。
 */
export function downgradeInvalidQuotes(
  html: string,
  invalid: ExplainerQuote[],
): { html: string; downgraded: number } {
  let result = html;
  let downgraded = 0;

  for (const quote of invalid) {
    const target = stripWhitespace(quote.text || '');
    if (!target) continue;

    let replaced = false;
    result = result.replace(new RegExp(QUOTE_TAG_SOURCE, 'gi'), (match, inner: string) => {
      if (replaced) return match;
      if (innerTextOf(inner) !== target) return match;
      replaced = true;
      return `<span class="mm-said">${inner}</span>`;
    });
    if (replaced) downgraded += 1;
  }

  return { html: result, downgraded };
}

/** 课堂时间显示：一小时内 MM:SS，超过一小时 HH:MM。供 trace / 调试使用。 */
export function formatClassTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
