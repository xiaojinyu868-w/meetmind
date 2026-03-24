import { NextRequest, NextResponse } from 'next/server';
import { chat } from '@/lib/services/llm-service';
import type { TranscriptSegment } from '@/types';
import { applyRateLimit } from '@/lib/utils/rate-limit';

type EnhanceStatus = 'pending' | 'enhancing' | 'enhanced' | 'failed';
type CorrectionStrategy = 'layered' | 'rule-only';

type CorrectionLevel = 'rule' | 'lexicon' | 'llm' | 'none';

interface EnhancedTranscriptSegment extends TranscriptSegment {
  originalText?: string;
  rawText?: string;
  enhanceStatus: EnhanceStatus;
  correctionLevel?: CorrectionLevel;
  enhancedAt?: string;
}

interface LexiconTerm {
  term: string;
  canonical: string;
  aliases?: string[];
  scope?: 'classroom' | 'meeting' | 'global';
  status?: 'pending' | 'active' | 'disabled';
}

interface EnhanceRequestBody {
  segments: TranscriptSegment[];
  model?: string;
  fallbackModel?: string;
  strategy?: CorrectionStrategy;
  isFinal?: boolean;
  lexiconTerms?: LexiconTerm[];
  enableModelCorrection?: boolean;
  /** Course topic / hot-word context for better LLM correction */
  contextHint?: string;
  /** Recent confirmed transcript text — LLM uses this to infer course topic & terminology */
  recentContext?: string;
}

const DEFAULT_MODEL = process.env.TRANSCRIPT_LIGHT_MODEL || 'qwen-turbo';
const DEFAULT_FALLBACK_MODEL = process.env.TRANSCRIPT_FALLBACK_MODEL || 'qwen-plus';
const ENABLE_MAX_FALLBACK = String(process.env.TRANSCRIPT_ENABLE_MAX_FALLBACK || 'false').toLowerCase() === 'true';
const modelAvailability = new Map<string, 'available' | 'unavailable'>();

const SYSTEM_PROMPT = `你是课堂转录纠错助手，专门修正 ASR 语音识别的错误。
只在必要时最小修改，保留原意。
你必须只输出 JSON 数组，不要输出额外解释。`;

const USER_PROMPT_PREFIX = `任务：修正以下 ASR 语音识别文本。
规则：
1. 删除口头禅（嗯、呃）和明显重复。
2. 修正常见同音或拼写错误。
3.【重要】根据"上下文参考"推断课程学科和主题，将被 ASR 错误音译为中文的英文术语还原为正确写法。
4.【关键】ASR 经常把一个术语错误识别为另一个**看起来合法但与当前课程语境不符**的术语。你必须根据上下文判断并纠正。识别方法：
  - 关键判断标准：**这个词在当前上下文中讲不讲得通？** 即使一个术语本身是合法的、只出现了一次，如果它和当前讨论的学科/话题完全无关，它很可能是 ASR 对某个发音相近的本课术语的误识别。
  - 判断时结合发音：如果某个语境不符的词发音接近某个本课核心术语，大概率就是对它的误识别。
  - ASR 常见错误模式：英文术语被音译为无意义的中文谐音、被识别为另一个发音相似的合法术语、英文字母被逐个拆开识别、术语部分正确部分错误。
5.【重要】只修改你有把握的。不确定时保持原样，不要猜测。
6. 保持术语、专有名词和语气。
7. 只返回 JSON 数组，每项包含 id 和 text。`;

function buildEnhanceSystemPrompt(contextHint?: string, lexiconTerms?: LexiconTerm[], recentContext?: string): string {
  const parts = [SYSTEM_PROMPT];

  if (recentContext?.trim()) {
    parts.push(`\n上下文参考（前几批已纠错的转录文本，帮助你理解课程内容和学科领域）：\n${recentContext.trim().slice(0, 2500)}`);
  }

  if (contextHint?.trim()) {
    parts.push(`\n用户提供的课堂背景与术语提示：\n${contextHint.trim().slice(0, 2000)}`);
  }

  if (lexiconTerms && lexiconTerms.length > 0) {
    const activeTerms = lexiconTerms
      .filter((t) => t.status !== 'disabled' && t.canonical)
      .slice(0, 50);
    if (activeTerms.length > 0) {
      const termList = activeTerms
        .map((t) => {
          const aliases = t.aliases?.length ? `（常见误识别：${t.aliases.join('、')}）` : '';
          return `- ${t.canonical}${aliases}`;
        })
        .join('\n');
      parts.push(`\n已知术语/人名词典（请优先使用这些正确写法）：\n${termList}`);
    }
  }

  return parts.join('');
}

function buildEnhanceUserPrompt(inputJSON: string): string {
  return `${USER_PROMPT_PREFIX}\n输入：\n${inputJSON}`;
}

function markModelAvailability(model: string, next: 'available' | 'unavailable'): void {
  const prev = modelAvailability.get(model);
  if (prev !== next) {
  }
  modelAvailability.set(model, next);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .trim();
}

function normalizeCompareKey(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:："“”'‘’（）()【】\[\]-]/g, '');
}

function applyRuleLayer(text: string): { text: string; changed: boolean } {
  let next = normalizeText(text);
  const original = next;

  // Remove obvious filler words and repeated filler chunks.
  next = next
    .replace(/(嗯|呃|额|啊){2,}/g, '$1')
    .replace(/(就是|然后|那个|这个){2,}/g, '$1')
    .replace(/\b([A-Za-z]+)\s+\1\b/gi, '$1');

  // Collapse repeated characters and punctuation.
  next = next
    .replace(/([^\s])\1{2,}/g, '$1')
    .replace(/([，。！？,.!?])\1+/g, '$1');

  // Normalize punctuation spacing.
  next = next
    .replace(/\s+([，。！？,.!?;；:：])/g, '$1')
    .replace(/([，。！？,.!?;；:：])(\S)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  // Common misspellings in bilingual content.
  next = next
    .replace(/\bqustions\b/gi, 'questions')
    .replace(/\bsugguest\b/gi, 'suggest')
    .replace(/\btakeawayy?\b/gi, 'takeaway');

  // Universal ASR phonetic corrections (cross-discipline, not domain-specific).
  // Greek letters commonly mistranslated by Chinese ASR.
  next = next
    .replace(/西塔\s*k/gi, 'θ_k')
    .replace(/西塔/g, 'θ')
    .replace(/c\s*塔/gi, 'θ')
    .replace(/阿尔法/g, 'α')
    .replace(/贝塔/g, 'β')
    .replace(/伽[马玛]/g, 'γ')
    .replace(/德尔塔/g, 'δ')
    .replace(/拉姆达/g, 'λ')
    .replace(/西格玛/g, 'σ');

  return {
    text: next,
    changed: next !== original,
  };
}

function applyLexiconLayer(text: string, lexiconTerms: LexiconTerm[]): { text: string; changed: boolean; conflict: boolean } {
  if (!lexiconTerms.length) {
    return { text, changed: false, conflict: false };
  }

  let next = text;
  let changed = false;
  let conflict = false;

  const sortedTerms = lexiconTerms
    .filter((term) => term && term.term && term.canonical && term.status !== 'disabled')
    .sort((a, b) => b.term.length - a.term.length);

  for (const term of sortedTerms) {
    const canonical = normalizeText(term.canonical);
    if (!canonical) continue;

    const variants = [term.term, ...(term.aliases || [])]
      .map((item) => normalizeText(item))
      .filter(Boolean);

    for (const variant of variants) {
      const escaped = escapeRegExp(variant);
      if (!escaped) continue;

      const regex = /[A-Za-z]/.test(variant)
        ? new RegExp(`\\b${escaped}\\b`, 'gi')
        : new RegExp(escaped, 'g');

      if (regex.test(next) && !next.includes(canonical)) {
        conflict = true;
      }

      regex.lastIndex = 0;
      const replaced = next.replace(regex, canonical);
      if (replaced !== next) {
        changed = true;
        next = replaced;
      }
    }
  }

  return { text: next, changed, conflict };
}

function shouldUseModelCorrection(segment: TranscriptSegment, text: string, hasLexiconConflict: boolean): boolean {
  if (hasLexiconConflict) return true;
  if ((segment.confidence ?? 1) < 0.92) return true;

  const normalized = normalizeText(text);
  if (!normalized) return false;

  // Always send to LLM if text is non-trivial length — most ASR output benefits from correction
  if (normalized.length >= 15) return true;

  const hasPunctuation = /[，。！？,.!?;；]/.test(normalized);
  if (!hasPunctuation && normalized.length >= 10) return true;
  if (/(.{2,})\1{1,}/.test(normalized)) return true;
  if (/\b(qustions|sugguest|takeawayy?)\b/i.test(normalized)) return true;

  return false;
}

function parseEnhanceOutput(output: string): Map<string, string> {
  const result = new Map<string, string>();
  const candidates: string[] = [];

  const trimmed = output.trim();
  if (trimmed) candidates.push(trimmed);

  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const bracketBlock = output.match(/\[[\s\S]*\]/);
  if (bracketBlock?.[0]) candidates.push(bracketBlock[0].trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) continue;

      for (const item of parsed) {
        if (item && typeof item.id === 'string' && typeof item.text === 'string') {
          result.set(item.id, item.text.trim());
        }
      }

      if (result.size > 0) return result;
    } catch {
      // Continue with next parser candidate.
    }
  }

  return result;
}

async function runModelCorrection(
  segments: TranscriptSegment[],
  model: string,
  contextHint?: string,
  lexiconTerms?: LexiconTerm[],
  recentContext?: string,
): Promise<{ texts: Map<string, string>; model: string; usage?: unknown }> {
  if (modelAvailability.get(model) === 'unavailable') {
    throw new Error(`Model ${model} marked unavailable in runtime cache`);
  }

  const inputItems = segments.map((seg) => ({
    id: seg.id,
    text: seg.text,
  }));

  const systemPrompt = buildEnhanceSystemPrompt(contextHint, lexiconTerms, recentContext);
  const userPrompt = buildEnhanceUserPrompt(JSON.stringify(inputItems));

  const response = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model,
      {
        temperature: 0.2,
        maxTokens: 2000,
      }
    );

  const parsed = parseEnhanceOutput(response.content || '');
  if (parsed.size === 0) {
    markModelAvailability(model, 'unavailable');
    throw new Error(`Model ${model} returned non-JSON or empty payload`);
  }

  markModelAvailability(model, 'available');

  return {
    texts: parsed,
    model: response.model || model,
    usage: response.usage,
  };
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'transcriptEnhance');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body: EnhanceRequestBody = await request.json();
    const {
      segments,
      model = DEFAULT_MODEL,
      fallbackModel = DEFAULT_FALLBACK_MODEL,
      strategy = (process.env.TRANSCRIPT_CORRECTION_MODE as CorrectionStrategy) || 'layered',
      lexiconTerms = [],
      enableModelCorrection = true,
      contextHint = '',
      recentContext = '',
    } = body;

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json({ error: 'Missing segments' }, { status: 400 });
    }

    const stageResult = new Map<string, {
      text: string;
      ruleChanged: boolean;
      lexiconChanged: boolean;
      llmChanged: boolean;
      lexiconConflict: boolean;
    }>();

    for (const seg of segments) {
      const rawText = seg.text || '';
      const rule = applyRuleLayer(rawText);
      const lexicon = applyLexiconLayer(rule.text, lexiconTerms);

      stageResult.set(seg.id, {
        text: lexicon.text,
        ruleChanged: rule.changed,
        lexiconChanged: lexicon.changed,
        llmChanged: false,
        lexiconConflict: lexicon.conflict,
      });
    }

    let modelUsed = 'none';
    let modelFallbackUsed: string | null = null;
    let modelUsage: unknown = undefined;

    const modelEligibleSegments = strategy === 'layered' && enableModelCorrection
      ? segments.filter((seg) => {
          const staged = stageResult.get(seg.id);
          return staged ? shouldUseModelCorrection(seg, staged.text, staged.lexiconConflict) : false;
        })
      : [];

    if (modelEligibleSegments.length > 0) {
      const modelInput = modelEligibleSegments.map((seg) => ({
        ...seg,
        text: stageResult.get(seg.id)?.text || seg.text,
      }));

      let modelTexts = new Map<string, string>();

      try {
        const primary = await runModelCorrection(modelInput, model, contextHint, lexiconTerms, recentContext);
        modelTexts = primary.texts;
        modelUsed = primary.model;
        modelUsage = primary.usage;
      } catch (primaryError) {
        console.warn('[TranscriptEnhance API] Primary model failed:', primaryError);

        try {
          const fallback = await runModelCorrection(modelInput, fallbackModel, contextHint, lexiconTerms, recentContext);
          modelTexts = fallback.texts;
          modelUsed = fallback.model;
          modelFallbackUsed = fallbackModel;
          modelUsage = fallback.usage;
        } catch (fallbackError) {
          console.warn('[TranscriptEnhance API] Fallback model failed:', fallbackError);

          if (ENABLE_MAX_FALLBACK && fallbackModel !== 'qwen3-max-2026-01-23') {
            try {
              const maxFallback = await runModelCorrection(modelInput, 'qwen3-max-2026-01-23', contextHint, lexiconTerms, recentContext);
              modelTexts = maxFallback.texts;
              modelUsed = maxFallback.model;
              modelFallbackUsed = 'qwen3-max-2026-01-23';
              modelUsage = maxFallback.usage;
            } catch (maxError) {
              console.warn('[TranscriptEnhance API] Max fallback failed:', maxError);
            }
          }
        }
      }

      for (const seg of modelEligibleSegments) {
        const nextText = modelTexts.get(seg.id);
        if (!nextText) continue;

        const staged = stageResult.get(seg.id);
        if (!staged) continue;

        const normalized = normalizeText(nextText);
        if (!normalized) continue;

        const changed = normalizeCompareKey(normalized) !== normalizeCompareKey(staged.text);
        stageResult.set(seg.id, {
          ...staged,
          text: normalized,
          llmChanged: changed,
        });
      }
    }

    const enhancedSegments: EnhancedTranscriptSegment[] = segments.map((seg) => {
      const staged = stageResult.get(seg.id);
      const finalText = staged?.text || seg.text;
      const changed = normalizeCompareKey(finalText) !== normalizeCompareKey(seg.text);

      let correctionLevel: CorrectionLevel = 'none';
      if (staged?.llmChanged) correctionLevel = 'llm';
      else if (staged?.lexiconChanged) correctionLevel = 'lexicon';
      else if (staged?.ruleChanged) correctionLevel = 'rule';

      return {
        ...seg,
        rawText: seg.text,
        originalText: changed ? seg.text : undefined,
        text: finalText,
        correctionLevel,
        enhanceStatus: changed ? 'enhanced' : 'pending',
        enhancedAt: changed ? new Date().toISOString() : undefined,
      };
    });

    const enhancedCount = enhancedSegments.filter((item) => item.enhanceStatus === 'enhanced').length;

    return NextResponse.json({
      success: true,
      segments: enhancedSegments,
      stats: {
        total: segments.length,
        enhanced: enhancedCount,
        strategy,
        model: modelUsed,
        fallbackModel: modelFallbackUsed,
        modelCandidates: modelEligibleSegments.length,
        usage: modelUsage,
      },
    });
  } catch (error) {
    console.error('[TranscriptEnhance API] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Transcript enhancement failed';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
