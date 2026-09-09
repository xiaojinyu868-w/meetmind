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

/**
 * 引用只来自模型真正引用了的地方。
 * 之前这里会在模型没引用资料时按关键词重叠"补"两张「导入资料 N」引用卡（url 是
 * about:blank）——学生点开是空白页，回答和资料的关系也是我们猜的。没有引用就没有引用卡。
 */
export function ensureSupportCitations(params: {
  mergedCitations?: Citation[];
  supportReferences: SupportReference[];
  questionHint: string;
}): Citation[] | undefined {
  return params.mergedCitations;
}
