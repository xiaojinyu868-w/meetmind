import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';

const KEYWORDS = ['查漏', '补缺', '盲点', '漏点', '巩固', '强化', '听懂了', '加练'];

function includesKeyword(intent: string): boolean {
  return KEYWORDS.some((keyword) => intent.includes(keyword));
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function pickCoverageSegments(transcript: TranscriptSegment[], count: number): TranscriptSegment[] {
  if (transcript.length <= count) return transcript;

  const picked: TranscriptSegment[] = [];
  const step = (transcript.length - 1) / Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    picked.push(transcript[Math.round(index * step)]);
  }
  return picked;
}

interface LLMGapDraft {
  title?: string;
  body?: string;
  taskLabel?: string;
  taskReason?: string;
  segmentIndex?: number;
}

interface LLMOutput {
  overview?: string;
  coveredSummary?: string;
  gaps?: LLMGapDraft[];
}

function buildEvidencePrompt(segments: TranscriptSegment[]): string {
  return segments
    .map((segment, index) => {
      const start = formatTimestamp(segment.startMs);
      const end = formatTimestamp(segment.endMs);
      return `片段${index + 1} [${start}-${end}] startMs=${segment.startMs} endMs=${segment.endMs}\n${segment.text}`;
    })
    .join('\n\n');
}

async function generateGapsWithLLM(
  context: AppExecutionContext,
  model: string,
  segments: TranscriptSegment[]
): Promise<LLMOutput | null> {
  const prompt = buildEvidencePrompt(segments);
  const response = await chat(
    [
      {
        role: 'system',
        content:
          '你是课堂查漏补缺助手。目标是先确认课上已讲内容，再提炼可执行的补缺点。只能基于证据片段输出，禁止编造。只输出 JSON。',
      },
      {
        role: 'user',
        content: `学习目标：${context.goal.intent}
请基于课堂证据做“剔除已讲后的查漏补缺”，输出 3 条补缺建议。

JSON 格式：
{
  "overview": "一句话总结本节补缺重点",
  "coveredSummary": "课上已讲覆盖范围（40-80字）",
  "gaps": [
    {
      "title": "补缺点标题",
      "body": "补缺说明（40-90字）",
      "taskLabel": "执行任务",
      "taskReason": "为什么补这条",
      "segmentIndex": 1
    }
  ]
}

规则：
- segmentIndex 只能是 1-${segments.length}
- 建议要面向“课上听懂，但要补漏洞”的学生
- 避免重复课堂原话，强调迁移和易错点

课堂证据：
${prompt}`,
      },
    ],
    model,
    { temperature: 0.25, maxTokens: 1600 }
  );

  return parseJsonResponse<LLMOutput>(response.content);
}

function normalizeSegmentIndex(index: number | undefined, total: number, fallback: number): number {
  if (!Number.isFinite(index)) return fallback;
  const next = Math.floor(index as number) - 1;
  if (next < 0) return fallback;
  if (next >= total) return total - 1;
  return next;
}

function buildGapCards(
  tools: AppPluginTools,
  evidenceSegments: TranscriptSegment[],
  llmOutput: LLMOutput | null
): AppExecutionResult['cards'] {
  const fallbackOverview = tools.summarizeSegments(evidenceSegments, 220);
  const overview = llmOutput?.overview?.trim() || fallbackOverview || '本节课建议做一次轻量查漏补缺。';
  const coveredSummary =
    llmOutput?.coveredSummary?.trim() || '课堂主线内容已有覆盖，当前重点是补齐易错边界与迁移应用。';
  const gaps = Array.isArray(llmOutput?.gaps) ? llmOutput.gaps.slice(0, 3) : [];

  const cards: AppExecutionResult['cards'] = [
    {
      id: 'gap-overview',
      type: 'insight',
      title: '查漏补缺总览',
      body: overview,
      priority: 'high',
    },
    {
      id: 'gap-covered-summary',
      type: 'insight',
      title: '已讲内容（剔除项）',
      body: coveredSummary,
      priority: 'medium',
    },
  ];

  gaps.forEach((gap, index) => {
    const segmentIndex = normalizeSegmentIndex(gap.segmentIndex, evidenceSegments.length, index % evidenceSegments.length);
    const segment = evidenceSegments[segmentIndex];
    const taskId = `gap-task-${index + 1}`;

    cards.push({
      id: `gap-card-${index + 1}`,
      type: 'task',
      title: gap.title?.trim() || `补缺点 ${index + 1}`,
      body: gap.body?.trim() || `围绕 ${formatTimestamp(segment.startMs)} 的课堂片段做一次迁移检验，确认理解没有盲区。`,
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
          id: `gap-seek-${index + 1}`,
          label: `回放 ${formatTimestamp(segment.startMs)}`,
          kind: 'seek',
          payload: { timestamp: segment.startMs },
        },
        {
          id: `gap-mark-${index + 1}`,
          label: '标记已补齐',
          kind: 'mark_done',
          payload: { taskId },
        },
      ],
    });
  });

  if (gaps.length === 0 && evidenceSegments.length > 0) {
    evidenceSegments.slice(0, 3).forEach((segment, index) => {
      cards.push({
        id: `gap-card-fallback-${index + 1}`,
        type: 'task',
        title: `补缺点 ${index + 1}`,
        body: '用这段课堂证据做一次“反例 + 变式”检验，确认不是只会跟着老师节奏听懂。',
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
            id: `gap-fallback-seek-${index + 1}`,
            label: `回放 ${formatTimestamp(segment.startMs)}`,
            kind: 'seek',
            payload: { timestamp: segment.startMs },
          },
          {
            id: `gap-fallback-mark-${index + 1}`,
            label: '标记已补齐',
            kind: 'mark_done',
            payload: { taskId: `gap-task-${index + 1}` },
          },
        ],
      });
    });
  }

  return cards;
}

function buildGapTasks(evidenceSegments: TranscriptSegment[], llmOutput: LLMOutput | null): AppExecutionResult['tasks'] {
  const gaps = Array.isArray(llmOutput?.gaps) ? llmOutput.gaps.slice(0, 3) : [];
  if (gaps.length === 0) {
    return evidenceSegments.slice(0, 3).map((segment, index) => ({
      id: `gap-task-${index + 1}`,
      label: `补缺训练 ${index + 1}（${formatTimestamp(segment.startMs)}）`,
      reason: '做一次“反例 + 变式”验证，确认理解不是表面通过。',
      estimatedMinutes: index === 0 ? 8 : 6,
      relatedTimestamp: segment.startMs,
    }));
  }

  return gaps.map((gap, index) => {
    const segmentIndex = normalizeSegmentIndex(gap.segmentIndex, evidenceSegments.length, index % evidenceSegments.length);
    const segment = evidenceSegments[segmentIndex];
    return {
      id: `gap-task-${index + 1}`,
      label: gap.taskLabel?.trim() || `补缺任务 ${index + 1}`,
      reason: gap.taskReason?.trim() || '在可回放证据上做迁移验证，降低“听懂但不会用”的风险。',
      estimatedMinutes: index === 0 ? 8 : 6,
      relatedTimestamp: segment.startMs,
    };
  });
}

export const gapFillPlugin: AppPlugin = {
  manifest: {
    id: 'gap-fill',
    name: '查漏补缺',
    version: '0.1.0',
    description: '剔除课上已讲主线后，生成针对本节课的补缺任务与证据回放卡。',
    tags: ['student', 'gap-fill', 'review', 'context-first'],
    capabilities: ['coverage-pruning', 'gap-drill', 'seek-action'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    if (context.input.transcript.length === 0) return false;
    const intent = context.goal.intent.toLowerCase();
    return includesKeyword(intent);
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const model = context.model || DEFAULT_MODEL_ID;
    const evidenceSegments = pickCoverageSegments(context.input.transcript, 6);

    let llmOutput: LLMOutput | null = null;
    try {
      llmOutput = await generateGapsWithLLM(context, model, evidenceSegments);
    } catch {
      llmOutput = null;
    }

    return {
      pluginId: 'gap-fill',
      version: '0.1.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `evidence_segments=${evidenceSegments.length}`,
        `llm_gap=${llmOutput ? 'enabled' : 'fallback'}`,
        'strategy=context_first_minus_covered',
      ],
      cards: buildGapCards(tools, evidenceSegments, llmOutput),
      tasks: buildGapTasks(evidenceSegments, llmOutput),
      nextSuggestedPlugins: ['knowledge-cards'],
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};

