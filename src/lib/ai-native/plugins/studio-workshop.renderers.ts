/**
 * Render payload builders for studio-workshop plugin.
 *
 * Builds the final render payload (slides / infographic / table / audio / script / document)
 * from structured output + cards + evidence.
 */
import type { AppExecutionResult, AppRenderMode } from '../types';
import type { VolcPodcastResult } from '@/lib/services/volc-podcast';
import type { StudioOutput, StudioMode, SlidePage } from './studio-workshop.types';
import { toStringArray } from './studio-workshop.types';
import { extractScriptLines } from './studio-workshop.podcast';

// ── Slide pages ────────────────────────────────────────────────────

/**
 * 幻灯页只来自模型的 slides。之前 slides 为空会退两级：先把结构卡片拼成页（时间点按序号
 * 挂抽样片段），再用抽样片段每段一页——那是"看起来像幻灯的转录切片"。没有页就是没有页，
 * 由插件按 GENERATION_FAILED 诚实失败。
 */
export function buildSlidePages(output: StudioOutput | null): SlidePage[] {
  return (output?.slides || [])
    .map((page, index) => ({
      id: `slide-${index + 1}`,
      title: page.title?.trim() || `第 ${index + 1} 页`,
      subtitle: page.subtitle?.trim() || '',
      bullets: toStringArray(page.bullets, 6),
      notes: page.notes?.trim() || '',
      relatedTimestamp:
        typeof page.relatedTimestamp === 'number' && Number.isFinite(page.relatedTimestamp)
          ? Math.max(0, Math.floor(page.relatedTimestamp))
          : undefined,
    }))
    .filter((page) => page.bullets.length > 0 || page.notes)
    .slice(0, 12);
}

// ── Infographic draft ──────────────────────────────────────────────

export function buildInfographicDraft(output: StudioOutput | null, cards: AppExecutionResult['cards']) {
  const keyPoints =
    toStringArray(output?.infographic?.keyPoints, 8).length > 0
      ? toStringArray(output?.infographic?.keyPoints, 8)
      : cards
          .slice(0, 5)
          .map((card) => card.title || card.body)
          .filter(Boolean)
          .slice(0, 5);

  const visualPlan =
    toStringArray(output?.infographic?.visualPlan, 6).length > 0
      ? toStringArray(output?.infographic?.visualPlan, 6)
      : ['顶部标题区 + 三段式知识点区 + 底部复习提示区'];

  const imagePrompt =
    output?.infographic?.imagePrompt?.trim() ||
    [
      output?.title?.trim() || '课堂信息图',
      keyPoints.length > 0 ? `关键信息：${keyPoints.join('；')}` : '',
      `视觉布局：${visualPlan.join('；')}`,
      '要求：中文信息图、层级清晰、适合学习复盘分享。',
    ]
      .filter(Boolean)
      .join('\n');

  // PRD v1.1 §5.6：信息图默认产物为"一张图带走这节课"（class-take-away）
  const suggestedScene = output?.infographic?.suggestedScene?.trim() || 'class-take-away';
  const suggestedOrientation = output?.infographic?.suggestedOrientation || 'landscape';
  const suggestedDetailLevel = output?.infographic?.suggestedDetailLevel || 'standard';

  return {
    title: output?.infographic?.title?.trim() || output?.title?.trim() || '课堂信息图草案',
    subtitle: output?.infographic?.subtitle?.trim() || output?.summary?.trim() || '',
    keyPoints,
    visualPlan,
    imagePrompt,
    stylePreset: output?.infographic?.stylePreset?.trim() || '教育学习海报，清爽明亮，信息层级明确',
    suggestedScene,
    suggestedOrientation,
    suggestedDetailLevel,
  };
}

// ── Unified render payload ─────────────────────────────────────────

export function buildRenderPayload(params: {
  renderMode: AppRenderMode;
  cards: AppExecutionResult['cards'];
  output: StudioOutput | null;
  podcastResult: VolcPodcastResult | null;
  podcastError: string;
  mode: StudioMode;
  infographicImage?: {
    imageUrl: string;
    requestId: string;
    model: string;
  } | null;
}) {
  const { renderMode, cards, output, podcastResult, podcastError, mode, infographicImage } = params;

  if (renderMode === 'table') {
    return {
      columns:
        cards
          .map((card) => (Array.isArray(card.meta?.columns) ? card.meta.columns : []))
          .find((columns) => columns.length > 0) || [],
      rows: cards
        .flatMap((card) => (Array.isArray(card.meta?.rows) ? card.meta.rows : []))
        .filter((row) => Array.isArray(row) && row.length > 0),
    };
  }

  if (renderMode === 'audio') {
    const lines = extractScriptLines(cards);
    return {
      provider: 'volcengine',
      audioUrl: podcastResult?.audioUrl || '',
      roundCount: podcastResult?.roundCount || lines.length,
      audioBytes: podcastResult?.audioBytes || 0,
      usage: podcastResult?.usage || { inputTextTokens: 0, outputAudioTokens: 0 },
      error: podcastError,
      lines,
      sections: cards
        .slice(0, 10)
        .map((card) => ({
          id: card.id,
          title: card.title,
          body: card.body,
        }))
        .filter((section) => section.title || section.body),
    };
  }

  if (renderMode === 'slides') {
    const pages = buildSlidePages(output);
    // 模型没给出任何一页：诚实失败，不用卡片 / 抽样片段拼页
    if (pages.length === 0) throw new Error('GENERATION_FAILED');
    return { pages };
  }

  if (renderMode === 'script') {
    return {
      lines: extractScriptLines(cards),
      sections: cards.map((card) => ({
        title: card.title,
        body: card.body,
      })),
    };
  }

  if (mode === 'infographic') {
    const draft = buildInfographicDraft(output, cards);
    return {
      blocks: [
        {
          id: 'infographic-draft',
          type: 'infographic-draft',
          title: draft.title,
          text: draft.subtitle,
          items: draft.keyPoints,
        },
      ],
      draft,
      image: infographicImage || null,
    };
  }

  return {
    sections: cards.map((card) => ({
      id: card.id,
      title: card.title,
      body: card.body,
      bullets: Array.isArray(card.meta?.bullets) ? card.meta.bullets : [],
    })),
  };
}
