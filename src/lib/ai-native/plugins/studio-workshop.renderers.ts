/**
 * Render payload builders for studio-workshop plugin.
 *
 * Builds the final render payload (slides / infographic / table / audio / script / document)
 * from structured output + cards + evidence.
 */
import type { TranscriptSegment } from '@/types';
import type { AppExecutionResult, AppRenderMode } from '../types';
import type { VolcPodcastResult } from '@/lib/services/volc-podcast';
import type { StudioOutput, StudioMode, SlidePage } from './studio-workshop.types';
import { toStringArray } from './studio-workshop.types';
import { extractScriptLines } from './studio-workshop.podcast';

// ── Slide pages ────────────────────────────────────────────────────

export function buildSlidePages(
  output: StudioOutput | null,
  cards: AppExecutionResult['cards'],
  evidenceSegments: TranscriptSegment[]
): SlidePage[] {
  const fromOutput = (output?.slides || [])
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
    .filter((page) => page.title || page.bullets.length > 0 || page.notes)
    .slice(0, 12);

  if (fromOutput.length > 0) return fromOutput;

  const fallback = cards
    .filter((card) => card.id !== 'studio-overview')
    .slice(0, 10)
    .map((card, index) => {
      const bullets = Array.isArray(card.meta?.bullets) ? toStringArray(card.meta.bullets, 6) : [];
      const evidence = evidenceSegments[index % Math.max(1, evidenceSegments.length)];
      return {
        id: `slide-fallback-${index + 1}`,
        title: card.title || `第 ${index + 1} 页`,
        subtitle: '',
        bullets: bullets.length > 0 ? bullets : toStringArray(card.body.split(/\r?\n/), 5),
        notes: card.body || '',
        relatedTimestamp: evidence?.startMs,
      };
    });

  if (fallback.length > 0) return fallback;

  return evidenceSegments.slice(0, 5).map((segment, index) => ({
    id: `slide-evidence-${index + 1}`,
    title: `第 ${index + 1} 页`,
    subtitle: '',
    bullets: [segment.text.slice(0, 120)],
    notes: '',
    relatedTimestamp: segment.startMs,
  }));
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

  const suggestedScene = output?.infographic?.suggestedScene?.trim() || 'infographic';
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
  evidenceSegments: TranscriptSegment[];
  podcastResult: VolcPodcastResult | null;
  podcastError: string;
  mode: StudioMode;
}) {
  const { renderMode, cards, output, evidenceSegments, podcastResult, podcastError, mode } = params;

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
    return {
      pages: buildSlidePages(output, cards, evidenceSegments),
    };
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
      image: null,
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
