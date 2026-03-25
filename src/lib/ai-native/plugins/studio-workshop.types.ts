/**
 * Types, constants and mode helpers for studio-workshop plugin.
 */
import type { TranscriptSegment } from '@/types';
import type { AppRenderMode } from '../types';

// ── Types ──────────────────────────────────────────────────────────

export type StudioMode = 'podcast' | 'video' | 'report' | 'infographic' | 'slides' | 'table' | 'general';

export interface StudioCardDraft {
  title?: string;
  body?: string;
  cardKind?: string;
  bullets?: string[];
  dialogue?: Array<{ speaker?: string; line?: string }>;
  columns?: string[];
  rows?: Array<string[]>;
  startMs?: number | string;
  endMs?: number | string;
}

export interface StudioSlideDraft {
  title?: string;
  subtitle?: string;
  bullets?: string[];
  notes?: string;
  relatedTimestamp?: number | string;
}

export interface StudioTaskDraft {
  label?: string;
  reason?: string;
  estimatedMinutes?: number;
  relatedTimestamp?: number;
}

export interface StudioOutput {
  title?: string;
  summary?: string;
  cards?: StudioCardDraft[];
  slides?: StudioSlideDraft[];
  tasks?: StudioTaskDraft[];
  infographic?: {
    title?: string;
    subtitle?: string;
    keyPoints?: string[];
    visualPlan?: string[];
    imagePrompt?: string;
    stylePreset?: string;
    suggestedScene?: string;
    suggestedOrientation?: 'landscape' | 'portrait' | 'square';
    suggestedDetailLevel?: 'concise' | 'standard' | 'detailed';
  };
}

export interface PodcastPlan {
  title?: string;
  opening?: string;
  keyTakeaways?: string[];
  structure?: Array<{ title?: string; focus?: string; startMs?: number; endMs?: number }>;
  tone?: string;
  learnerProfile?: string;
  script?: Array<{ speaker?: string; text?: string; emotion?: string; beat?: string }>;
}

export interface SlidePage {
  id: string;
  title: string;
  subtitle: string;
  bullets: string[];
  notes: string;
  relatedTimestamp?: number;
}

// ── Constants ──────────────────────────────────────────────────────

export const MODE_HINTS: Record<StudioMode, string> = {
  podcast: '双人播客成品：包含可播放音频 + 对话脚本 + 回放锚点',
  video: '视频总览，按章节梳理核心观点与对应时间点',
  report: '学习报告，包含亮点、风险点、下一步建议',
  infographic: '信息图文案，结构紧凑、适合可视化表达',
  slides: '幻灯片，按页输出标题、副标题、3-5 条要点、讲解备注',
  table: '数据表格，提炼关键维度并给出对比项',
  general: '结构化输出，覆盖核心结论、证据、行动建议',
};

// ── Mode helpers ───────────────────────────────────────────────────

export function detectMode(intent: string, appKey?: string): StudioMode {
  const normalizedAppKey = (appKey || '').toLowerCase();
  if (normalizedAppKey === 'audio-overview') return 'podcast';
  if (normalizedAppKey === 'infographic') return 'infographic';
  if (normalizedAppKey === 'mindmap') return 'general';
  if (normalizedAppKey === 'quiz') return 'general';
  if (normalizedAppKey === 'flashcards') return 'general';

  const lower = intent.toLowerCase();
  if (lower.includes('播客') || lower.includes('audio overview')) return 'podcast';
  if (lower.includes('视频') || lower.includes('video overview')) return 'video';
  if (lower.includes('报告') || lower.includes('report')) return 'report';
  if (lower.includes('信息图') || lower.includes('infographic')) return 'infographic';
  if (lower.includes('幻灯片') || lower.includes('slide')) return 'slides';
  if (lower.includes('数据表') || lower.includes('table')) return 'table';
  return 'general';
}

export function resolveRenderMode(mode: StudioMode): AppRenderMode {
  if (mode === 'podcast') return 'audio';
  if (mode === 'slides') return 'slides';
  if (mode === 'table') return 'table';
  if (mode === 'video') return 'script';
  if (mode === 'infographic') return 'custom';
  return 'document';
}

export function modeRole(mode: StudioMode): string {
  if (mode === 'video') return '学习视频编辑';
  if (mode === 'report') return '学习复盘顾问';
  if (mode === 'infographic') return '信息设计师';
  if (mode === 'slides') return '课堂演示设计师';
  if (mode === 'table') return '知识对照分析师';
  if (mode === 'podcast') return '中文教育播客总编导';
  return '学习内容产品经理';
}

export function modeContract(mode: StudioMode): string {
  if (mode === 'infographic') {
    return `{
  "title": "结果标题",
  "summary": "一句话摘要",
  "cards": [{ "title": "模块标题", "body": "模块正文", "bullets": ["要点"] }],
  "infographic": {
    "title": "信息图标题",
    "subtitle": "副标题",
    "keyPoints": ["关键点1", "关键点2", ...],
    "visualPlan": ["版式/布局建议"],
    "imagePrompt": "详细的文生图提示词，描述图片内容、布局、色彩",
    "stylePreset": "风格描述（如：现代扁平、学术专业、活泼插画等）",
    "suggestedScene": "推荐场景类型：infographic|knowledge-card|timeline|comparison|flowchart|mind-map|review-poster|data-viz",
    "suggestedOrientation": "推荐方向：landscape|portrait|square",
    "suggestedDetailLevel": "推荐详细度：concise|standard|detailed"
  }
}

suggestedScene 选择依据：
- infographic: 多维度知识总结、课堂回顾
- knowledge-card: 单个概念深度讲解
- timeline: 历史演变、步骤流程
- comparison: 两种方案/概念对比
- flowchart: 方法论、决策流程
- mind-map: 知识框架、概念关系
- review-poster: 考前复习、重点提炼
- data-viz: 数据分析、统计结果

请根据课堂内容特征自动推荐最合适的场景、方向和详细度。`;
  }

  if (mode === 'slides') {
    return `{
  "title": "结果标题",
  "summary": "一句话摘要",
  "cards": [{ "title": "模块标题", "body": "模块正文", "bullets": ["要点"] }],
  "slides": [{ "title": "页标题", "subtitle": "副标题", "bullets": ["要点"], "notes": "讲解备注", "relatedTimestamp": 12000 }],
  "tasks": [{ "label": "下一步动作", "reason": "原因", "estimatedMinutes": 5, "relatedTimestamp": 12000 }]
}`;
  }

  if (mode === 'table') {
    return `{
  "title": "结果标题",
  "summary": "一句话摘要",
  "cards": [{ "title": "表格说明", "body": "说明", "columns": ["列1", "列2"], "rows": [["值1", "值2"]] }],
  "tasks": [{ "label": "下一步动作", "reason": "原因", "estimatedMinutes": 5 }]
}`;
  }

  return `{
  "title": "结果标题",
  "summary": "一句话摘要",
  "cards": [{ "title": "模块标题", "body": "模块正文", "bullets": ["要点"], "dialogue": [{ "speaker": "角色", "line": "台词" }], "startMs": 12000, "endMs": 18000 }],
  "tasks": [{ "label": "下一步动作", "reason": "原因", "estimatedMinutes": 5, "relatedTimestamp": 12000 }]
}`;
}

// ── Parse helpers ──────────────────────────────────────────────────

export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return fallback;
}

export function toStringArray(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, maxLength);
}

export function toMatrix(value: unknown, colCount: number, rowLimit: number): string[][] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => (Array.isArray(row) ? row : []))
    .map((row) =>
      row
        .map((cell) => (typeof cell === 'string' ? cell.trim() : ''))
        .slice(0, colCount)
    )
    .filter((row) => row.length > 0)
    .slice(0, rowLimit);
}

export function toDialogue(value: unknown): Array<{ speaker: string; line: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === 'object' ? (item as { speaker?: unknown; line?: unknown }) : null))
    .filter((item): item is { speaker?: unknown; line?: unknown } => item !== null)
    .map((item) => ({
      speaker: typeof item.speaker === 'string' ? item.speaker.trim() : '',
      line: typeof item.line === 'string' ? item.line.trim() : '',
    }))
    .filter((item) => item.speaker && item.line)
    .slice(0, 28);
}

export function pickEvidenceSegments(transcript: TranscriptSegment[], count: number): TranscriptSegment[] {
  if (transcript.length <= count) return transcript;
  const picked: TranscriptSegment[] = [];
  const step = (transcript.length - 1) / Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    picked.push(transcript[Math.round(index * step)]);
  }
  return picked;
}
