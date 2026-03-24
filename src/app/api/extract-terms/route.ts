import { NextRequest, NextResponse } from 'next/server';
import { chat } from '@/lib/services/llm-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';
const log = createLogger('extract-terms');


/**
 * POST /api/extract-terms
 *
 * 从用户提供的课程主题 + 参考资料文本中，自动提取本节课的关键术语表。
 * 用于实时转录纠错——LLM 知道这节课会出现哪些术语后，
 * 就能把 ASR 的中文音译乱码还原为正确的英文/专业术语。
 *
 * 设计理念：不依赖硬编码词表，而是根据用户每次课程的实际内容动态生成。
 */

interface ExtractTermsRequest {
  /** 用户填写的课程主题/提示（可选） */
  topic?: string;
  /** 参考资料文本片段（如上传的 PPT/讲义 snippet） */
  referenceTexts?: string[];
  /** 已识别的转录片段（可选，用于从已有转录中提取上下文） */
  recentTranscript?: string;
}

interface ExtractedTerm {
  /** 术语的正确写法 */
  term: string;
  /** 该术语可能被 ASR 误识别为的中文谐音（可选） */
  phonetic_variants?: string[];
}

const EXTRACT_SYSTEM_PROMPT = `你是一个学术术语提取与 ASR 变体归并助手。

你的核心任务：从课程转录文本中提取关键术语，并识别 ASR 语音识别产生的**同一术语的不同错误写法**。

要求：
1. 提取所有专业术语、人名、公式名、算法名、缩写等。
2.【最重要】识别同一术语被 ASR 识别为多种不同写法的情况，将它们统一。
  常见的 ASR 错误模式：
  - 英文术语被音译为无意义的中文谐音词
  - 英文术语被识别为另一个发音相似但**与当前课程学科不相关**的合法术语
  - 英文字母被逐个拆开识别为独立字符
  - 术语部分正确、部分被替换为谐音
  - 算法名/公式名被音译为无关中文词
3. 对于每个术语，列出你在文本中**实际观察到的**所有可能的 ASR 误识别变体。不要凭空编造变体，只列出文本中确实出现过的。
4. 只输出 JSON 数组，不要输出任何额外文字。

判断技巧：
- 先通读全文，判断课程在讨论什么学科和主题。
- 如果某个术语在文本中已被正确识别了若干次，同时有一些其他词出现但与课程主题不匹配，这些词很可能是该术语的 ASR 变体。即使某个可疑词只出现了一次，也不要忽略它。
- 如果某个词属于另一个学科领域，但在当前课程语境中完全讲不通，它大概率是 ASR 对某个发音相近的本课术语的误识别。
- 注意发音相似性：把可疑词读出来，看它的发音是否接近某个课程核心术语。

输出格式：
[
  { "term": "正确术语写法", "phonetic_variants": ["在文本中观察到的变体1", "变体2"] }
]`;

function buildUserPrompt(topic?: string, referenceTexts?: string[], recentTranscript?: string): string {
  const parts: string[] = [];

  if (topic?.trim()) {
    parts.push(`课程主题：${topic.trim()}`);
  }

  if (referenceTexts && referenceTexts.length > 0) {
    const combined = referenceTexts
      .map((t) => t.trim())
      .filter(Boolean)
      .join('\n---\n')
      .slice(0, 4000);
    if (combined) {
      parts.push(`参考资料内容：\n${combined}`);
    }
  }

  if (recentTranscript?.trim()) {
    parts.push(`已有转录文本（已经过初步纠错，但仍可能含有 ASR 错误变体）：\n${recentTranscript.trim().slice(0, 3000)}`);
  }

  if (parts.length === 0) {
    return '没有提供任何课程资料，请返回空数组 []。';
  }

  return `请从以下课程资料中提取关键术语列表：\n\n${parts.join('\n\n')}\n\n请提取所有关键术语，特别是英文术语和可能被语音识别误识别的专业词汇。只输出 JSON 数组。`;
}

function parseTermsOutput(output: string): ExtractedTerm[] {
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

      const terms: ExtractedTerm[] = [];
      for (const item of parsed) {
        if (item && typeof item.term === 'string' && item.term.trim()) {
          terms.push({
            term: item.term.trim(),
            phonetic_variants: Array.isArray(item.phonetic_variants)
              ? item.phonetic_variants.filter((v: unknown) => typeof v === 'string' && v.trim()).map((v: string) => v.trim())
              : [],
          });
        }
      }

      if (terms.length > 0) return terms;
    } catch {
      // Continue with next candidate
    }
  }

  return [];
}

/**
 * Convert extracted terms into a compact text block for injection into
 * ASR context hint and LLM correction prompts.
 */
function formatTermsAsContextHint(terms: ExtractedTerm[]): string {
  if (terms.length === 0) return '';

  const lines = terms.slice(0, 80).map((t) => {
    if (t.phonetic_variants && t.phonetic_variants.length > 0) {
      return `${t.term}（ASR 可能误识别为：${t.phonetic_variants.join('、')}）`;
    }
    return t.term;
  });

  return `本节课关键术语：\n${lines.join('\n')}`;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'extractTerms');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body: ExtractTermsRequest = await request.json();
    const { topic, referenceTexts, recentTranscript } = body;

    // If nothing provided, return empty
    if (!topic?.trim() && (!referenceTexts || referenceTexts.length === 0) && !recentTranscript?.trim()) {
      return NextResponse.json({
        success: true,
        terms: [],
        contextHint: '',
      });
    }

    const userPrompt = buildUserPrompt(topic, referenceTexts, recentTranscript);

    const model = process.env.TRANSCRIPT_LIGHT_MODEL || 'qwen-turbo';

    const response = await chat(
      [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      model,
      {
        temperature: 0.3,
        maxTokens: 2000,
        responseFormat: 'json_object',
      }
    );

    const terms = parseTermsOutput(response.content || '');
    const contextHint = formatTermsAsContextHint(terms);

    return NextResponse.json({
      success: true,
      terms,
      contextHint,
      model: response.model || model,
    });
  } catch (error) {
    log.error('[ExtractTerms API] Error:', error);
    const message = error instanceof Error ? error.message : 'Term extraction failed';
    return NextResponse.json({ success: false, error: message, terms: [], contextHint: '' }, { status: 500 });
  }
}
