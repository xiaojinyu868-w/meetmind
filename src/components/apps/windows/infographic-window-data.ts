/**
 * InfographicWindow — 类型 / 常量 / 纯工具函数
 *
 * 从 InfographicWindow.tsx 提取，保持主组件文件聚焦于交互逻辑。
 */

import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  Clock,
  GitCompareArrows,
  ImageIcon,
  Network,
  PenLine,
  RectangleHorizontal,
  RectangleVertical,
  Sparkles,
  Square,
  TrendingUp,
  Workflow,
} from 'lucide-react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface InfographicWindowProps {
  sessionId: string;
  result: AppExecutionResult | null;
  taskState?: AppTaskState;
  contentContext?: string;
  onResultUpdate: (next: AppExecutionResult) => void;
  onGenerateDraft?: () => Promise<AppExecutionResult | null>;
  standalone?: boolean;
}

export interface DraftPayload {
  title?: string;
  subtitle?: string;
  keyPoints?: string[];
  visualPlan?: string[];
  imagePrompt?: string;
  stylePreset?: string;
  suggestedScene?: string;
  suggestedOrientation?: 'landscape' | 'portrait' | 'square';
  suggestedDetailLevel?: 'concise' | 'standard' | 'detailed';
}

export interface RenderPayload {
  draft?: DraftPayload;
  image?: {
    imageUrl?: string;
    requestId?: string;
    model?: string;
  } | null;
}

export interface ImageConfigResponse {
  ok?: boolean;
  enabled?: boolean;
  model?: string;
}

export interface SceneItem {
  key: string;
  label: string;
  description: string;
  Icon: LucideIcon;
}

export interface StylePresetItem {
  key: string;
  label: string;
  description: string;
  prompt: string;
  previewClassName: string;
  Icon: LucideIcon;
}

/* ------------------------------------------------------------------ */
/*  Icon size constants                                                */
/* ------------------------------------------------------------------ */

export const ICON_SM = 16;
export const ICON_MD = 20;
export const ICON_STROKE = 1.75;

/* ------------------------------------------------------------------ */
/*  Scene presets                                                      */
/* ------------------------------------------------------------------ */

export const SCENE_ITEMS: SceneItem[] = [
  { key: 'infographic', label: '知识信息图', description: '适合课堂总结与重点提炼', Icon: BarChart3 },
  { key: 'knowledge-card', label: '知识卡片', description: '聚焦单个核心概念', Icon: BookOpen },
  { key: 'timeline', label: '时间线', description: '展示演变过程或步骤顺序', Icon: Clock },
  { key: 'comparison', label: '对比分析图', description: '突出差异与优劣对照', Icon: GitCompareArrows },
  { key: 'flowchart', label: '流程图', description: '适合方法论和流程梳理', Icon: Workflow },
  { key: 'mind-map', label: '概念地图', description: '呈现知识框架与关系网络', Icon: Network },
  { key: 'review-poster', label: '复习海报', description: '适合考前冲刺和重点回顾', Icon: PenLine },
  { key: 'data-viz', label: '数据可视化', description: '突出统计和结构化数据', Icon: TrendingUp },
];

/* ------------------------------------------------------------------ */
/*  Style presets                                                      */
/* ------------------------------------------------------------------ */

export const STYLE_PRESETS: StylePresetItem[] = [
  {
    key: 'auto-select',
    label: '自动判断',
    description: '系统按课堂内容自动匹配风格',
    prompt: '',
    previewClassName: 'from-slate-200 via-slate-100 to-slate-50',
    Icon: Sparkles,
  },
  {
    key: 'sketch-note',
    label: '手绘笔记',
    description: '像老师板书整理过的学习笔记',
    prompt: '手绘课堂笔记风格，线条清晰，适度留白，重点用圈画和标注突出。',
    previewClassName: 'from-[#FDF3C0] via-orange-50 to-white',
    Icon: PenLine,
  },
  {
    key: 'friendly-card',
    label: '轻松插画',
    description: '更亲和，适合入门知识或分享',
    prompt: '轻松友好的知识插画风格，配色柔和，视觉亲和，适合学生阅读。',
    previewClassName: 'from-pink-100 via-rose-50 to-violet-50',
    Icon: BookOpen,
  },
  {
    key: 'professional',
    label: '专业海报',
    description: '版式规整，适合汇报和展示',
    prompt: '专业信息海报风格，结构规整，强调标题层级与视觉秩序。',
    previewClassName: 'from-sky-100 via-slate-50 to-white',
    Icon: BarChart3,
  },
  {
    key: 'scientific',
    label: '科学信息图',
    description: '更理性，更适合知识关系和图表',
    prompt: '科学信息图风格，结构严谨，图示清晰，适合方法与概念关系梳理。',
    previewClassName: 'from-cyan-100 via-sky-50 to-slate-50',
    Icon: Network,
  },
  {
    key: 'study-poster',
    label: '复习海报',
    description: '重点醒目，适合手机浏览与考前冲刺',
    prompt: '复习海报风格，重点高亮，信息密度适中，适合手机端纵向阅读。',
    previewClassName: 'from-indigo-100 via-violet-50 to-white',
    Icon: ImageIcon,
  },
];

/* ------------------------------------------------------------------ */
/*  Static data                                                        */
/* ------------------------------------------------------------------ */

export const LANGUAGES = [
  { value: '中文（简体）', label: '中文（简体）' },
  { value: '中文（繁体）', label: '中文（繁體）' },
  { value: 'English', label: 'English' },
  { value: '日本語', label: '日本語' },
  { value: '한국어', label: '한국어' },
];

export const ORIENTATIONS: Array<{
  value: 'landscape' | 'portrait' | 'square';
  label: string;
  Icon: LucideIcon;
  description: string;
}> = [
  { value: 'landscape', label: '横版', description: '适合课程总结和大信息量布局', Icon: RectangleHorizontal },
  { value: 'portrait', label: '竖版', description: '更适合手机浏览和长图分享', Icon: RectangleVertical },
  { value: 'square', label: '方形', description: '适合封面卡片和社交分享', Icon: Square },
];

export const DETAIL_LEVELS: Array<{ value: 'concise' | 'standard' | 'detailed'; label: string; description: string; badge?: string }> = [
  { value: 'concise', label: '简洁', description: '重点更集中，适合快速浏览' },
  { value: 'standard', label: '标准', description: '平衡信息量与可读性' },
  { value: 'detailed', label: '详尽', description: '层次更多，适合深度复习', badge: 'BETA' },
];

/* ------------------------------------------------------------------ */
/*  Pure helper functions                                              */
/* ------------------------------------------------------------------ */

export function normalizeContextText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function splitContextToBullets(value: string, limit: number): string[] {
  return value
    .split(/[。！？；;.!?\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => truncateText(item, 48))
    .slice(0, limit);
}

export function resolveStylePresetKey(stylePreset?: string): string {
  const normalized = (stylePreset || '').trim().toLowerCase();
  if (!normalized) return STYLE_PRESETS[0].key;

  const matched = STYLE_PRESETS.find((item) => {
    return [item.key, item.label, item.prompt].some((candidate) => normalized.includes(candidate.toLowerCase()));
  });

  return matched?.key || STYLE_PRESETS[0].key;
}

export function buildFallbackDraft(params: {
  contentContext?: string;
  scenePreset: string;
  orientation: 'landscape' | 'portrait' | 'square';
  detailLevel: 'concise' | 'standard' | 'detailed';
}): DraftPayload {
  const context = normalizeContextText(params.contentContext);
  const scene = SCENE_ITEMS.find((item) => item.key === params.scenePreset) || SCENE_ITEMS[0];
  const orientationLabel = ORIENTATIONS.find((item) => item.value === params.orientation)?.label || '横版';
  const detailLabel = DETAIL_LEVELS.find((item) => item.value === params.detailLevel)?.label || '标准';
  const keyPoints = splitContextToBullets(context, 5);

  return {
    title: scene.key === 'infographic' ? '课堂信息图' : scene.label,
    subtitle: context ? truncateText(context, 56) : '基于课堂内容自动生成的可视化图片',
    keyPoints: keyPoints.length > 0 ? keyPoints : ['提炼课堂重点', '梳理知识关系', '突出关键结论'],
    visualPlan: [
      `采用${scene.label}形式组织课堂重点`,
      `默认使用${orientationLabel}画布进行布局`,
      `${detailLabel}信息密度，确保重点清晰可读`,
    ],
    imagePrompt: [
      `请围绕以下课堂内容制作一张${scene.label}。`,
      context ? `课堂摘要：${context}` : '课堂摘要：请提炼本次课堂的核心知识点与关系。',
      '要求：中文可读、结构清晰、重点突出、适合学生复习和分享。',
    ].join('\n'),
    stylePreset: '教育学习海报，清爽明亮，信息层级明确',
    suggestedScene: scene.key,
    suggestedOrientation: params.orientation,
    suggestedDetailLevel: params.detailLevel,
  };
}

export function buildSyntheticResult(params: {
  baseResult: AppExecutionResult | null;
  draft: DraftPayload;
  image?: {
    imageUrl: string;
    requestId?: string;
    model?: string;
  } | null;
}): AppExecutionResult {
  const { baseResult, draft, image } = params;
  const currentPayload = ((baseResult?.render?.payload || {}) as RenderPayload) || {};

  return {
    pluginId: baseResult?.pluginId || 'studio-workshop',
    version: baseResult?.version || '0.2.0',
    model: baseResult?.model,
    cards:
      baseResult?.cards && baseResult.cards.length > 0
        ? baseResult.cards
        : [
            {
              id: 'infographic-manual-overview',
              type: 'insight',
              title: draft.title || '信息图',
              body: draft.subtitle || '已根据课堂内容准备信息图。',
              priority: 'high',
            },
          ],
    tasks: baseResult?.tasks || [],
    trace: [...(baseResult?.trace || []), baseResult ? 'infographic=manual-update' : 'infographic=manual-entry'],
    render: {
      ...(baseResult?.render || { mode: image ? 'image' : 'custom', payload: {} }),
      mode: image ? 'image' : 'custom',
      title: draft.title || baseResult?.render?.title || '信息图',
      description: draft.subtitle || baseResult?.render?.description || '课堂内容可视化图片',
      payload: {
        ...currentPayload,
        draft,
        image: image || null,
      },
    },
    raw: {
      ...(baseResult?.raw || {}),
      infographicDraft: draft,
      infographicImageUrl: image?.imageUrl,
      infographicImageRequestId: image?.requestId,
      infographicImageModel: image?.model,
    },
  };
}
