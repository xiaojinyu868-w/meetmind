import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import {
  generateVolcPodcast,
  isVolcPodcastEnabled,
  type VolcPodcastResult,
} from '@/lib/services/volc-podcast';
import type {
  AppExecutionContext,
  AppExecutionResult,
  AppPlugin,
  AppPluginTools,
  AppRenderMode,
} from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';

type StudioMode = 'podcast' | 'video' | 'report' | 'infographic' | 'slides' | 'table' | 'general';

interface StudioCardDraft {
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

interface StudioSlideDraft {
  title?: string;
  subtitle?: string;
  bullets?: string[];
  notes?: string;
  relatedTimestamp?: number | string;
}

interface StudioTaskDraft {
  label?: string;
  reason?: string;
  estimatedMinutes?: number;
  relatedTimestamp?: number;
}

interface StudioOutput {
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
  };
}

interface PodcastPlan {
  title?: string;
  opening?: string;
  keyTakeaways?: string[];
  structure?: Array<{ title?: string; focus?: string; startMs?: number; endMs?: number }>;
  tone?: string;
  learnerProfile?: string;
  script?: Array<{ speaker?: string; text?: string; emotion?: string; beat?: string }>;
}

interface SlidePage {
  id: string;
  title: string;
  subtitle: string;
  bullets: string[];
  notes: string;
  relatedTimestamp?: number;
}

const MODE_HINTS: Record<StudioMode, string> = {
  podcast: '双人播客成品：包含可播放音频 + 对话脚本 + 回放锚点',
  video: '视频总览，按章节梳理核心观点与对应时间点',
  report: '学习报告，包含亮点、风险点、下一步建议',
  infographic: '信息图文案，结构紧凑、适合可视化表达',
  slides: '幻灯片，按页输出标题、副标题、3-5 条要点、讲解备注',
  table: '数据表格，提炼关键维度并给出对比项',
  general: '结构化输出，覆盖核心结论、证据、行动建议',
};

const PODCAST_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.VOLCENGINE_PODCAST_TIMEOUT_MS || '240000', 10);
  if (!Number.isFinite(raw)) return 240000;
  return Math.min(900000, Math.max(30000, raw));
})();

function resolvePodcastTimeoutMs(inputChars: number): number {
  const adaptive = 60000 + Math.max(0, inputChars) * 20;
  return Math.min(900000, Math.max(PODCAST_TIMEOUT_MS, adaptive));
}

const PODCAST_TIMESTAMP_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const PODCAST_META_PATTERN = /\b(startMs|endMs)\s*=\s*\d+\b/gi;
const PODCAST_SEGMENT_LABEL_PATTERN = /片段\s*\d+/g;
const PODCAST_CHINESE_TIMESTAMP_PATTERN =
  /(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)+点(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)+(?:分(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)*秒?|秒)|(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)+分(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)+秒/g;

function detectMode(intent: string, appKey?: string): StudioMode {
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

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function pickEvidenceSegments(transcript: TranscriptSegment[], count: number): TranscriptSegment[] {
  if (transcript.length <= count) return transcript;
  const picked: TranscriptSegment[] = [];
  const step = (transcript.length - 1) / Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    picked.push(transcript[Math.round(index * step)]);
  }
  return picked;
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return fallback;
}

function toStringArray(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, maxLength);
}

function toMatrix(value: unknown, colCount: number, rowLimit: number): string[][] {
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

function toDialogue(value: unknown): Array<{ speaker: string; line: string }> {
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

function toPodcastScript(value: unknown, maxLines: number = 40): Array<{ speaker: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === 'object' ? (item as { speaker?: unknown; text?: unknown }) : null))
    .filter((item): item is { speaker?: unknown; text?: unknown } => item !== null)
    .map((item) => ({
      speaker: typeof item.speaker === 'string' ? item.speaker.trim() : '',
      text: typeof item.text === 'string' ? item.text.trim() : '',
    }))
    .filter((item) => item.speaker && item.text)
    .slice(0, maxLines);
}

function modeRole(mode: StudioMode): string {
  if (mode === 'video') return '学习视频编辑';
  if (mode === 'report') return '学习复盘顾问';
  if (mode === 'infographic') return '信息设计师';
  if (mode === 'slides') return '课堂演示设计师';
  if (mode === 'table') return '知识对照分析师';
  if (mode === 'podcast') return '中文教育播客总编导';
  return '学习内容产品经理';
}

function modeContract(mode: StudioMode): string {
  if (mode === 'infographic') {
    return `{
  "title": "结果标题",
  "summary": "一句话摘要",
  "cards": [{ "title": "模块标题", "body": "模块正文", "bullets": ["要点"] }],
  "infographic": {
    "title": "信息图标题",
    "subtitle": "副标题",
    "keyPoints": ["关键点"],
    "visualPlan": ["版式建议"],
    "imagePrompt": "文生图提示词",
    "stylePreset": "风格描述"
  }
}`;
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

function stripPodcastMetaNoise(text: string): string {
  return text
    .replace(PODCAST_META_PATTERN, ' ')
    .replace(PODCAST_SEGMENT_LABEL_PATTERN, ' ')
    .replace(/\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countTimestampHints(text: string): number {
  const western = text.match(PODCAST_TIMESTAMP_PATTERN)?.length || 0;
  const chinese = text.match(PODCAST_CHINESE_TIMESTAMP_PATTERN)?.length || 0;
  return western + chinese;
}

function sanitizePodcastNarration(text: string): string {
  const noiseRemoved = stripPodcastMetaNoise(text);
  if (!noiseRemoved) return '';
  if (countTimestampHints(noiseRemoved) < 1) return noiseRemoved;
  return noiseRemoved
    .replace(PODCAST_TIMESTAMP_PATTERN, ' ')
    .replace(PODCAST_CHINESE_TIMESTAMP_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPodcastTranscriptCorpus(transcript: TranscriptSegment[], maxChars: number = 9000): string {
  const promptContext = buildPromptTranscriptContext(transcript, {
    maxChars: Math.max(12_000, maxChars * 2),
    includeIndex: false,
    includeTimestamp: false,
    minCharsPerSegment: 56,
  });
  const merged = promptContext.text
    .split('\n')
    .map((line) => sanitizePodcastNarration(line))
    .filter(Boolean)
    .join('\n');

  if (merged.length <= maxChars) return merged;
  return `${merged.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizePodcastSpeaker(raw: string | undefined, index: number, mapping: Map<string, string>): string {
  const normalized = raw?.trim() || '';
  if (!normalized) return index % 2 === 0 ? 'Host A' : 'Host B';
  if (mapping.has(normalized)) return mapping.get(normalized)!;
  if (/^zh[_-]/i.test(normalized) || /^voice[_-]/i.test(normalized) || normalized.includes('bigtts')) {
    const alias = mapping.size % 2 === 0 ? 'Host A' : 'Host B';
    mapping.set(normalized, alias);
    return alias;
  }
  return normalized;
}

function hasTimestampPollution(rounds: VolcPodcastResult['rounds']): boolean {
  if (!Array.isArray(rounds) || rounds.length === 0) return false;
  let polluted = 0;
  rounds.forEach((round) => {
    const text = round.text?.trim() || '';
    if (!text) return;
    const hits = countTimestampHints(text);
    const hasMeta = PODCAST_META_PATTERN.test(text) || PODCAST_SEGMENT_LABEL_PATTERN.test(text);
    if (hits > 0 || hasMeta) polluted += 1;
    PODCAST_META_PATTERN.lastIndex = 0;
    PODCAST_SEGMENT_LABEL_PATTERN.lastIndex = 0;
  });
  return polluted >= Math.max(2, Math.ceil(rounds.length * 0.25));
}

async function generatePodcastPlan(context: AppExecutionContext, model: string): Promise<PodcastPlan | null> {
  const corpus = buildPodcastTranscriptCorpus(context.input.transcript, 12000);
  if (!corpus) return null;
  const anchorHints = buildPromptAnchorContext(context.input.anchors, 10);
  const learnerProfile =
    (context.input.metadata?.studentName && `Student profile: ${context.input.metadata.studentName}`) ||
    'Student profile: needs efficient review and wants to capture the class essence, not raw transcript.';

  const response = await chat(
    [
      {
        role: 'system',
        content:
          'You are a humorous but rigorous knowledge curator with strong cognitive-science background. Rewrite class transcript into an engaging two-host learning podcast. Use only evidence from class. Output JSON only.',
      },
      {
        role: 'user',
        content: `Layer 1 - Render contract (required for frontend):
Output JSON with this top-level shape:
{
  "title": "podcast title",
  "opening": "opening line",
  "keyTakeaways": ["takeaway1", "takeaway2"],
  "learnerProfile": "who this learner is",
  "structure": [
    { "title": "chapter title", "focus": "what this chapter covers", "startMs": 0, "endMs": 60000 }
  ],
  "tone": "tone guidance",
  "script": [
    { "speaker": "Host A", "text": "line" },
    { "speaker": "Host B", "text": "line" }
  ]
}

Layer 2 - Role and intent:
Turn this class into an audio-first exam-oriented discussion map.
Goals:
1) Reveal hidden but test-relevant logic.
2) Reduce cognitive friction using vivid analogies.
3) Keep strong in-class feel based on real evidence.
4) Each chapter in "structure" should have clear startMs/endMs (in milliseconds) referencing the original class transcript timestamps. This enables quick chapter navigation in the player.

Audience:
${learnerProfile}

Hard constraints:
- Output must be natural Simplified Chinese in script.text.
- Do NOT output timestamps like 08:25, segment IDs in script text.
- Use only "Host A" and "Host B" as speaker values.
- Each "structure" entry MUST include "startMs" and "endMs" fields (integer milliseconds from the class recording).
- "structure" should have 3-6 entries covering the full class content.

Class topic:
${sanitizePodcastNarration(context.goal.intent)}

Class evidence:
${corpus}

${anchorHints ? `Learner concerns:
${anchorHints}` : ''}`,
      },
    ],
    model,
    { temperature: 0.5, maxTokens: 2600 }
  );

  return parseJsonResponse<PodcastPlan>(response.content);
}

async function generateStudioOutput(
  context: AppExecutionContext,
  model: string,
  mode: StudioMode,
  transcriptContext: string,
  anchorContext: string
): Promise<StudioOutput | null> {
  const response = await chat(
    [
      {
        role: 'system',
        content:
          `你是${modeRole(mode)}，目标是把课堂内容转成可直接使用的学习产物。严格基于课堂证据，不编造。输出纯 JSON。`,
      },
      {
        role: 'user',
        content: `应用目标：${context.goal.intent}
应用形态：${MODE_HINTS[mode]}
用户目标：用更低的认知成本完成课堂复盘，直接可用，不要“模板化空话”。

最小输出契约（仅字段约束）：
${modeContract(mode)}

说明：
- 你可以自由决定模块数量与结构层次
- startMs/endMs/relatedTimestamp 为可选证据定位字段，不确定可留空
- 文风要自然、可执行、可复述

课堂原文：
${transcriptContext}

${anchorContext ? `学习者关注点：\n${anchorContext}` : ''}`,
      },
    ],
    model,
    { temperature: 0.25, maxTokens: 2800 }
  );

  return parseJsonResponse<StudioOutput>(response.content);
}

function resolveRenderMode(mode: StudioMode): AppRenderMode {
  if (mode === 'podcast') return 'audio';
  if (mode === 'slides') return 'slides';
  if (mode === 'table') return 'table';
  if (mode === 'video') return 'script';
  if (mode === 'infographic') return 'custom';
  return 'document';
}

function extractScriptLines(cards: AppExecutionResult['cards']): Array<{ speaker: string; line: string }> {
  return cards
    .flatMap((card) => {
      const dialogue = Array.isArray(card.meta?.dialogue) ? card.meta.dialogue : [];
      return dialogue
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const speaker =
            typeof (item as { speaker?: unknown }).speaker === 'string'
              ? (item as { speaker: string }).speaker
              : '';
          const line =
            typeof (item as { line?: unknown }).line === 'string' ? (item as { line: string }).line : '';
          if (!speaker || !line) return null;
          return { speaker, line };
        })
        .filter((item): item is { speaker: string; line: string } => Boolean(item));
    })
    .slice(0, 60);
}

function buildPodcastInputText(
  context: AppExecutionContext,
  output: StudioOutput | null,
  evidenceSegments: TranscriptSegment[],
  cards: AppExecutionResult['cards'],
  podcastPlan: PodcastPlan | null,
  strictNoTimestamp: boolean = false
): string {
  const planScript = toPodcastScript(podcastPlan?.script, 42);
  const speakerMap = new Map<string, string>();
  const cardScript = extractScriptLines(cards).map((line, index) => ({
    speaker: normalizePodcastSpeaker(line.speaker, index, speakerMap),
    text: sanitizePodcastNarration(line.line),
  }));
  const scriptSource = planScript.length > 0 ? planScript : cardScript;

  const scriptSection = scriptSource
    .map((line) => `${line.speaker}: ${sanitizePodcastNarration(line.text)}`)
    .filter(Boolean)
    .join('\n');

  const evidenceSeed = evidenceSegments
    .map((segment) => sanitizePodcastNarration(segment.text))
    .filter(Boolean)
    .slice(0, 10)
    .join('\n');
  const corpus = buildPodcastTranscriptCorpus(context.input.transcript, 9000);

  const planSection = podcastPlan
    ? [
        podcastPlan.title ? `Title: ${sanitizePodcastNarration(podcastPlan.title)}` : '',
        podcastPlan.opening ? `Opening: ${sanitizePodcastNarration(podcastPlan.opening)}` : '',
        Array.isArray(podcastPlan.keyTakeaways) && podcastPlan.keyTakeaways.length > 0
          ? `Takeaways: ${podcastPlan.keyTakeaways.map((item) => sanitizePodcastNarration(item)).join(' ; ')}`
          : '',
        Array.isArray(podcastPlan.structure) && podcastPlan.structure.length > 0
          ? `Structure:\n${podcastPlan.structure
              .slice(0, 6)
              .map((item, index) => {
                const title = sanitizePodcastNarration(item.title || `Segment ${index + 1}`);
                const focus = sanitizePodcastNarration(item.focus || '');
                return `${index + 1}. ${title}${focus ? ` - ${focus}` : ''}`;
              })
              .join('\n')}`
          : '',
        podcastPlan.tone ? `Tone: ${sanitizePodcastNarration(podcastPlan.tone)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const learnerProfile =
    podcastPlan?.learnerProfile?.trim() ||
    (context.input.metadata?.studentName ? `Student profile: ${context.input.metadata.studentName}` : 'Student profile: efficient review learner');

  const text = [
    'Task: produce an engaging two-host Chinese learning podcast script for speech synthesis.',
    `Topic: ${sanitizePodcastNarration(context.goal.intent)}`,
    `Audience: ${sanitizePodcastNarration(learnerProfile)}`,
    'Requirements:',
    '- Keep natural back-and-forth conversation, not monologue.',
    '- Focus on why it matters, how it works, and how to apply it.',
    '- Output language should be natural Simplified Chinese.',
    '- Never include timestamps, segment IDs, startMs/endMs.',
    strictNoTimestamp ? '- Strict correction: if any time expression appears, regenerate without any time mentions.' : '',
    planSection ? `Podcast plan:\n${planSection}` : '',
    scriptSection ? `Preferred script draft:\n${scriptSection}` : '',
    output?.summary ? `Summary:\n${sanitizePodcastNarration(output.summary)}` : '',
    evidenceSeed ? `Key evidence:\n${evidenceSeed}` : '',
    corpus ? `Full class evidence:\n${corpus}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return text.length <= 12000 ? text : text.slice(0, 12000);
}

function buildPodcastRoundCards(
  rounds: VolcPodcastResult['rounds'],
  evidenceSegments: TranscriptSegment[]
): AppExecutionResult['cards'] {
  if (!Array.isArray(rounds) || rounds.length === 0) return [];
  const safeEvidence = evidenceSegments.length > 0 ? evidenceSegments : [];
  const speakerAliasMap = new Map<string, string>();

  return rounds
    .filter((round) => typeof round.text === 'string' && round.text.trim().length > 0)
    .slice(0, 20)
    .map((round, index) => {
      const fallback = safeEvidence[index % Math.max(1, safeEvidence.length)];
      const startMs = fallback?.startMs ?? 0;
      const endMs = fallback?.endMs ?? startMs + 8000;
      const speaker = normalizePodcastSpeaker(round.speaker, index, speakerAliasMap);
      const rawLine = round.text?.trim() || '';
      const line = sanitizePodcastNarration(rawLine) || rawLine;

      return {
        id: `studio-podcast-round-${index + 1}`,
        type: 'timeline',
        title: `Round ${index + 1} ? ${speaker}`,
        body: line,
        priority: index < 4 ? 'high' : 'medium',
        citations: fallback
          ? [
              {
                startMs,
                endMs,
                snippet: fallback.text.slice(0, 120),
              },
            ]
          : undefined,
        actions: [
          {
            id: `seek-podcast-round-${index + 1}`,
            label: `Seek ${formatTimestamp(startMs)}`,
            kind: 'seek',
            payload: { timestamp: startMs },
          },
        ],
        meta: {
          cardKind: 'script',
          dialogue: [{ speaker, line }],
        },
      };
    });
}

function buildSlidePages(
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

function buildInfographicDraft(output: StudioOutput | null, cards: AppExecutionResult['cards']) {
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

  return {
    title: output?.infographic?.title?.trim() || output?.title?.trim() || '课堂信息图草案',
    subtitle: output?.infographic?.subtitle?.trim() || output?.summary?.trim() || '',
    keyPoints,
    visualPlan,
    imagePrompt,
    stylePreset: output?.infographic?.stylePreset?.trim() || '教育学习海报，清爽明亮，信息层级明确',
  };
}

function buildRenderPayload(params: {
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

export const studioWorkshopPlugin: AppPlugin = {
  manifest: {
    id: 'studio-workshop',
    name: '学习应用工坊',
    version: '0.2.0',
    description: '一个插件驱动多种小程序形态，支持播客/报告/信息图/幻灯片/数据表。',
    tags: ['studio', 'apps', 'multi-format'],
    capabilities: ['multi-app', 'structured-output', 'seek-action'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    return context.input.transcript.length > 0;
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const mode = detectMode(context.goal.intent, context.goal.appKey);
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 24_000,
      includeIndex: true,
      includeTimestamp: false,
      minCharsPerSegment: 56,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const evidenceSegments = pickEvidenceSegments(context.input.transcript, 8);
    const model = context.model || DEFAULT_MODEL_ID;
    const trace: string[] = [
      `intent=${context.goal.intent}`,
      `app_key=${context.goal.appKey || 'none'}`,
      `mode=${mode}`,
      `model=${model}`,
      `transcript_segments=${context.input.transcript.length}`,
      `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
      `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
    ];

    let output: StudioOutput | null = null;
    let podcastPlan: PodcastPlan | null = null;
    if (mode === 'podcast') {
      try {
        podcastPlan = await generatePodcastPlan(context, model);
        trace.push('llm=podcast_plan_enabled');
      } catch {
        podcastPlan = null;
        trace.push('llm=podcast_plan_fallback');
      }
      trace.push('podcast_pipeline=volc_direct');
    } else {
      try {
        output = await generateStudioOutput(context, model, mode, promptContext.text, anchorContext);
        trace.push('llm=enabled');
      } catch {
        output = null;
        trace.push('llm=fallback');
      }
    }

    const fallbackSummary =
      mode === 'podcast'
        ? '基于课堂证据直接生成真实播客音频与双人脚本。'
        : '请继续采集课堂内容后重试。';
    const defaultTitle = mode === 'podcast' ? '课堂播客' : '学习应用结果';
    const podcastPlanSummary = podcastPlan
      ? [
          podcastPlan.opening || '',
          ...(Array.isArray(podcastPlan.keyTakeaways) ? podcastPlan.keyTakeaways.slice(0, 3) : []),
        ]
          .map((item) => sanitizePodcastNarration(String(item || '').trim()))
          .filter(Boolean)
          .join(' ')
      : '';

    const cards: AppExecutionResult['cards'] = [
      {
        id: 'studio-overview',
        type: 'insight',
        title: output?.title?.trim() || defaultTitle,
        body:
          output?.summary?.trim() ||
          podcastPlanSummary ||
          tools.summarizeSegments(context.input.transcript, 260) ||
          fallbackSummary,
        priority: 'high',
      },
    ];

    if (mode !== 'podcast') {
      (output?.cards || []).slice(0, 12).forEach((draft, index) => {
        const fallback = evidenceSegments[index % Math.max(1, evidenceSegments.length)];
        const startMs = toTimestamp(draft.startMs, fallback?.startMs || 0);
        const endMs = toTimestamp(draft.endMs, fallback?.endMs || startMs + 8000);
        const bullets = toStringArray(draft.bullets, 10);
        const columns = toStringArray(draft.columns, 8);
        const rows = toMatrix(draft.rows, Math.max(1, columns.length || 3), 24);
        const dialogue = toDialogue(draft.dialogue);

        cards.push({
          id: `studio-card-${index + 1}`,
          type: 'timeline',
          title: draft.title?.trim() || `输出模块 ${index + 1}`,
          body: draft.body?.trim() || fallback?.text || '',
          priority: index < 3 ? 'high' : 'medium',
          citations: fallback
            ? [
                {
                  startMs,
                  endMs,
                  snippet: fallback.text.slice(0, 120),
                },
              ]
            : undefined,
          actions: [
            {
              id: `seek-studio-${index + 1}`,
              label: `回放 ${formatTimestamp(startMs)}`,
              kind: 'seek',
              payload: { timestamp: startMs },
            },
          ],
          meta: {
            cardKind: draft.cardKind || mode,
            bullets,
            columns,
            rows,
            dialogue,
          },
        });
      });
    }

    if (cards.length === 1) {
      evidenceSegments.slice(0, 3).forEach((segment, index) => {
        cards.push({
          id: `studio-fallback-${index + 1}`,
          type: 'timeline',
          title: `证据模块 ${index + 1}`,
          body: segment.text,
          priority: index === 0 ? 'high' : 'medium',
          citations: [
            {
              startMs: segment.startMs,
              endMs: segment.endMs,
              snippet: segment.text.slice(0, 120),
            },
          ],
          actions: [
            {
              id: `seek-fallback-${index + 1}`,
              label: `回放 ${formatTimestamp(segment.startMs)}`,
              kind: 'seek',
              payload: { timestamp: segment.startMs },
            },
          ],
        });
      });
    }

    let podcastResult: VolcPodcastResult | null = null;
    let podcastError = '';
    if (mode === 'podcast') {
      const enabled = isVolcPodcastEnabled();
      trace.push(`podcast_enabled=${enabled ? 'true' : 'false'}`);
      trace.push(`podcast_plan=${podcastPlan ? 'yes' : 'no'}`);
      if (enabled) {
        try {
          const podcastInput = buildPodcastInputText(context, output, evidenceSegments, cards, podcastPlan);
          const podcastTimeoutMs = resolvePodcastTimeoutMs(podcastInput.length);
          trace.push(`podcast_input_chars=${podcastInput.length}`);
          trace.push(`podcast_timeout_ms=${podcastTimeoutMs}`);
          podcastResult = await generateVolcPodcast({
            inputText: podcastInput,
            timeoutMs: podcastTimeoutMs,
            format: 'mp3',
            sampleRate: 24000,
            speechRate: 0,
            useHeadMusic: false,
            useTailMusic: false,
          });
          if (hasTimestampPollution(podcastResult.rounds)) {
            trace.push('podcast_retry=timestamp_pollution_detected');
            const retryInput = buildPodcastInputText(context, output, evidenceSegments, cards, podcastPlan, true);
            const retryTimeoutMs = resolvePodcastTimeoutMs(retryInput.length);
            trace.push(`podcast_retry_input_chars=${retryInput.length}`);
            trace.push(`podcast_retry_timeout_ms=${retryTimeoutMs}`);
            podcastResult = await generateVolcPodcast({
              inputText: retryInput,
              timeoutMs: retryTimeoutMs,
              format: 'mp3',
              sampleRate: 24000,
              speechRate: 0,
              useHeadMusic: false,
              useTailMusic: false,
            });
          }
          trace.push(`podcast_rounds=${podcastResult.roundCount}`);
          trace.push(`podcast_audio_url=${podcastResult.audioUrl ? 'yes' : 'no'}`);
          trace.push(`podcast_audio_bytes=${podcastResult.audioBytes}`);
        } catch (error) {
          podcastError = error instanceof Error ? error.message : '播客生成失败';
          trace.push(`podcast_error=${podcastError}`);
        }
      } else {
        podcastError =
          '未配置火山播客参数（VOLCENGINE_PODCAST_APP_ID / VOLCENGINE_PODCAST_ACCESS_TOKEN），已回退到脚本模式。';
      }

      const roundCards = buildPodcastRoundCards(podcastResult?.rounds || [], evidenceSegments);
      if (roundCards.length > 0) {
        cards.push(...roundCards);
        trace.push(`podcast_script_cards=${roundCards.length}`);
      }

      cards.splice(1, 0, {
        id: 'studio-podcast-status',
        type: 'insight',
        title: podcastResult?.audioUrl ? '播客音频已生成' : '播客音频未生成',
        body: podcastResult?.audioUrl
          ? '已生成可播放音频，支持直接试听与分享链接。'
          : podcastError || '当前仅生成脚本，可稍后重试播客生成。',
        priority: 'high',
      });
    }

    const tasks = (output?.tasks || []).slice(0, 6).map((task, index) => ({
      id: `studio-task-${index + 1}`,
      label: task.label?.trim() || `完成应用步骤 ${index + 1}`,
      reason: task.reason?.trim() || '根据结果完成一次复述或输出。',
      estimatedMinutes: typeof task.estimatedMinutes === 'number' ? task.estimatedMinutes : 5,
      relatedTimestamp:
        typeof task.relatedTimestamp === 'number'
          ? task.relatedTimestamp
          : evidenceSegments[index % Math.max(1, evidenceSegments.length)]?.startMs,
    }));

    if (mode === 'podcast' && tasks.length === 0) {
      tasks.push({
        id: 'studio-task-listen',
        label: '完整试听一次播客',
        reason: '确认信息完整度与节奏是否符合课堂复盘需求。',
        estimatedMinutes: 8,
        relatedTimestamp: evidenceSegments[0]?.startMs ?? 0,
      });
    }

    const renderMode = resolveRenderMode(mode);
    const infographicDraft = mode === 'infographic' ? buildInfographicDraft(output, cards) : undefined;

    return {
      pluginId: 'studio-workshop',
      version: '0.2.0',
      model,
      trace,
      cards,
      tasks,
      render: {
        mode: renderMode,
        title: output?.title?.trim() || defaultTitle,
        description: output?.summary?.trim() || MODE_HINTS[mode],
        payload: buildRenderPayload({
          renderMode,
          cards,
          output,
          evidenceSegments,
          podcastResult,
          podcastError,
          mode,
        }),
      },
      raw: {
        generatedAt: tools.now(),
        mode,
        appKey: context.goal.appKey || undefined,
        infographicDraft,
        podcastPlan: podcastPlan || undefined,
        podcast: podcastResult
          ? {
              inputId: podcastResult.inputId,
              sessionId: podcastResult.sessionId,
              requestId: podcastResult.requestId,
              audioUrl: podcastResult.audioUrl,
              audioBytes: podcastResult.audioBytes,
              roundCount: podcastResult.roundCount,
              usage: podcastResult.usage,
            }
          : undefined,
        podcastError: podcastError || undefined,
      },
    };
  },
};
