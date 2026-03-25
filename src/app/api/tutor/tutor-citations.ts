/**
 * Tutor 引用 / 资料处理工具函数
 */

import type { Segment } from '@/lib/services/longcut-utils';
import type { Citation } from '@/types/dify';
import type { SupportReference } from './tutor-types';

// ── 文本标准化 ──

export function normalizeCitationText(value: string, maxLength: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

// ── 从 segments 提取 [资料N] 引用 ──

export function extractSupportReferences(segments: Segment[]): SupportReference[] {
  const referencesByIndex = new Map<number, SupportReference>();

  for (const segment of segments || []) {
    const text = typeof segment?.text === 'string' ? segment.text : '';
    if (!text || !/\[资料\s*\d+\]/.test(text)) continue;

    const structuredMatches = Array.from(
      text.matchAll(/\[资料\s*(\d+)\]\s*(?:标题[:：]\s*([^\n]+)\s*)?(?:摘录[:：]\s*)?([\s\S]*?)(?=(?:\n{2,}\[资料\s*\d+\])|$)/g)
    );

    if (structuredMatches.length > 0) {
      for (const match of structuredMatches) {
        const index = Number.parseInt(match[1] || '', 10);
        if (!Number.isFinite(index) || index <= 0) continue;

        const title = normalizeCitationText(match[2] || `导入资料 ${index}`, 80) || `导入资料 ${index}`;
        const snippet = normalizeCitationText(match[3] || '', 480);
        if (!snippet) continue;

        if (!referencesByIndex.has(index)) {
          referencesByIndex.set(index, { index, title, snippet });
        }
      }
      continue;
    }

    const lineMatches = Array.from(text.matchAll(/\[资料\s*(\d+)\]\s*([^\n]+)/g));
    for (const match of lineMatches) {
      const index = Number.parseInt(match[1] || '', 10);
      if (!Number.isFinite(index) || index <= 0) continue;
      const snippet = normalizeCitationText(match[2] || '', 480);
      if (!snippet) continue;
      if (!referencesByIndex.has(index)) {
        referencesByIndex.set(index, { index, title: `导入资料 ${index}`, snippet });
      }
    }
  }

  return Array.from(referencesByIndex.values()).sort((a, b) => a.index - b.index);
}

// ── 从 LLM 回复内容中提取引用的 [资料N] 编号 ──

export function extractSupportCitationIndices(content: string): number[] {
  const indices = new Set<number>();
  for (const match of content.matchAll(/\[资料\s*(\d+)\]/g)) {
    const index = Number.parseInt(match[1] || '', 10);
    if (Number.isFinite(index) && index > 0) {
      indices.add(index);
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
}

// ── 根据回复内容构建 Citation 列表 ──

export function buildSupportCitationsFromContent(content: string, supportReferences: SupportReference[]): Citation[] {
  if (!content || supportReferences.length === 0) return [];

  const referencedIndices = extractSupportCitationIndices(content);
  if (referencedIndices.length === 0) return [];

  const supportByIndex = new Map<number, SupportReference>(
    supportReferences.map((item) => [item.index, item])
  );

  const citations: Citation[] = [];
  for (const index of referencedIndices) {
    const support = supportByIndex.get(index);
    if (!support) continue;
    citations.push({
      id: `support-${index}`,
      title: support.title || `导入资料 ${index}`,
      url: `about:blank#support-${index}`,
      snippet: support.snippet,
      source_type: 'knowledge_base',
    });
  }
  return citations;
}

// ── 合并多来源 Citation ──

export function mergeCitationResults(primary?: Citation[], secondary?: Citation[]): Citation[] | undefined {
  const merged: Citation[] = [];
  const seen = new Set<string>();

  const append = (items?: Citation[]) => {
    for (const item of items || []) {
      if (!item) continue;
      const key = `${item.source_type}:${item.title}:${item.url}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  };

  append(primary);
  append(secondary);
  return merged.length > 0 ? merged : undefined;
}

// ── Prompt 构建 ──

export function buildSupportUsagePrompt(supportReferences: SupportReference[]): string {
  if (!supportReferences.length) return '';

  const referenceList = supportReferences
    .slice(0, 6)
    .map((item) => `[资料${item.index}] ${item.title}：${normalizeCitationText(item.snippet, 260)}`)
    .join('\n');

  return [
    '【增强资料优先规则】',
    `当前会话已导入 ${supportReferences.length} 份增强资料，请优先基于这些资料回答：`,
    referenceList,
    '只要引用增强资料内容，必须在对应句末标注 [资料N]（禁止编造编号）。',
    '如果用户追问"有没有参考我的文档/资料"，必须明确指出参考了哪些 [资料N]。',
    '仅当资料里确实找不到证据时，才可回复"资料中未找到相关证据"，不要说"没有额外文档"。',
  ].join('\n');
}

export function buildAutomaticSupportPolicyPrompt(supportReferences: SupportReference[]): string {
  if (!supportReferences.length) return '';

  return [
    '【Support Auto-Use Policy】',
    'For every user question, first evaluate whether imported support materials can help.',
    'If support material is relevant, integrate it directly without asking user to explicitly request it.',
    'When using support material, cite with existing markers like [资料N].',
    'If support material is not relevant, do not force citations. Briefly explain why and answer from transcript context.',
  ].join('\n');
}

// ── 语义匹配 ──

export function isDocumentReferenceQuestion(question: string): boolean {
  if (!question) return false;
  return /(文档|资料|讲义|课件|pdf|docx|ppt|pptx|导入|上传|参考|引用|source|document|material)/i.test(question);
}

export function extractSemanticKeywords(text: string): string[] {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return [];

  const englishTokens = Array.from(normalized.matchAll(/[a-z0-9]{3,}/g)).map((match) => match[0]);
  const cjkChunks = Array.from(normalized.matchAll(/[\u4e00-\u9fff]{2,}/g)).map((match) => match[0]);
  const cjkTokens = cjkChunks.flatMap((chunk) => {
    if (chunk.length <= 4) return [chunk];
    const grams: string[] = [];
    for (let index = 0; index < chunk.length - 1; index += 1) {
      grams.push(chunk.slice(index, index + 2));
    }
    return grams;
  });

  return Array.from(new Set([...englishTokens, ...cjkTokens])).slice(0, 32);
}

export function shouldAttachSupportFallback(questionHint: string, supportReferences: SupportReference[]): boolean {
  const normalizedQuestion = (questionHint || '').trim();
  if (!normalizedQuestion || supportReferences.length === 0) return false;

  if (isDocumentReferenceQuestion(normalizedQuestion)) return true;

  const keywords = extractSemanticKeywords(normalizedQuestion);
  if (keywords.length === 0) return false;

  const supportCorpus = supportReferences
    .map((item) => `${item.title} ${item.snippet}`.toLowerCase())
    .join('\n');

  let matchedCount = 0;
  let strongestMatchLength = 0;

  for (const keyword of keywords) {
    if (!keyword || keyword.length < 2) continue;
    if (!supportCorpus.includes(keyword)) continue;

    matchedCount += 1;
    strongestMatchLength = Math.max(strongestMatchLength, keyword.length);

    if (matchedCount >= 3) break;
  }

  if (matchedCount >= 2) return true;
  if (matchedCount >= 1 && strongestMatchLength >= 6) return true;
  return false;
}

// ── Fallback 与 Ensure ──

export function buildFallbackSupportCitations(supportReferences: SupportReference[], limit = 2): Citation[] {
  return supportReferences.slice(0, limit).map((item) => ({
    id: `support-${item.index}`,
    title: item.title || `导入资料 ${item.index}`,
    url: `about:blank#support-${item.index}`,
    snippet: normalizeCitationText(item.snippet, 220),
    source_type: 'knowledge_base',
  }));
}

export function ensureSupportCitations(params: {
  mergedCitations?: Citation[];
  supportReferences: SupportReference[];
  questionHint: string;
}): Citation[] | undefined {
  const { mergedCitations, supportReferences, questionHint } = params;
  if (supportReferences.length === 0) return mergedCitations;

  const hasKnowledgeCitation = (mergedCitations || []).some(
    (item) => item.source_type === 'knowledge_base'
  );
  if (hasKnowledgeCitation) return mergedCitations;
  if (!shouldAttachSupportFallback(questionHint, supportReferences)) return mergedCitations;

  return mergeCitationResults(mergedCitations, buildFallbackSupportCitations(supportReferences));
}
