import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';

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

interface LLMCardDraft {
  title?: string;
  body?: string;
  taskLabel?: string;
  taskReason?: string;
}

interface LLMOutput {
  overview?: string;
  cards?: LLMCardDraft[];
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

async function generateCopyWithLLM(
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
          '你是课堂复习卡片生成助手。你只能基于给定课堂证据生成内容，不允许扩写超出证据的事实。只输出 JSON，不要解释。',
      },
      {
        role: 'user',
        content: `学习目标：${context.goal.intent}
请基于下面课堂证据，输出 3 张复习卡片草稿，要求语言简洁、可执行。

JSON 格式：
{
  "overview": "一句总览",
  "cards": [
    {
      "title": "卡片标题",
      "body": "卡片正文，40-90字",
      "taskLabel": "行动任务标题",
      "taskReason": "为什么要做"
    }
  ]
}

课堂证据：
${prompt}`,
      },
    ],
    model,
    { temperature: 0.2, maxTokens: 1400 }
  );

  return parseJsonResponse<LLMOutput>(response.content);
}

function buildKnowledgeCards(
  tools: AppPluginTools,
  evidenceSegments: TranscriptSegment[],
  llmOverview: string | undefined,
  drafts: LLMCardDraft[]
): AppExecutionResult['cards'] {
  const fallbackOverview = tools.summarizeSegments(evidenceSegments, 220);
  const overview = llmOverview?.trim() || fallbackOverview;
  const cards: AppExecutionResult['cards'] = [
    {
      id: 'knowledge-cards-overview',
      type: 'insight',
      title: '课堂证据总览',
      body: overview || '当前课堂证据不足，建议继续采集后再生成卡片。',
      priority: 'high',
    },
  ];

  evidenceSegments.forEach((segment, index) => {
    const draft = drafts[index];
    const taskId = `knowledge-task-${index + 1}`;
    cards.push({
      id: `knowledge-card-${index + 1}`,
      type: 'timeline',
      title: draft?.title?.trim() || `证据卡片 ${index + 1}`,
      body: draft?.body?.trim() || segment.text.trim(),
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
          id: `seek-${segment.id || index}`,
          label: `回放 ${formatTimestamp(segment.startMs)}`,
          kind: 'seek',
          payload: { timestamp: segment.startMs },
        },
        {
          id: `mark-done-${taskId}`,
          label: '标记已掌握',
          kind: 'mark_done',
          payload: { taskId },
        },
      ],
    });
  });

  return cards;
}

function buildTasks(
  evidenceSegments: TranscriptSegment[],
  drafts: LLMCardDraft[]
): AppExecutionResult['tasks'] {
  return evidenceSegments.map((segment, index) => ({
    id: `knowledge-task-${index + 1}`,
    label: drafts[index]?.taskLabel?.trim() || `复习卡片 ${index + 1}（${formatTimestamp(segment.startMs)}）`,
    reason: drafts[index]?.taskReason?.trim() || '先回到课堂证据，再做输出复述，确保真正吸收。',
    estimatedMinutes: index === 0 ? 6 : 4,
    relatedTimestamp: segment.startMs,
  }));
}

export const knowledgeCardsPlugin: AppPlugin = {
  manifest: {
    id: 'knowledge-cards',
    name: '知识卡片',
    version: '0.1.0',
    description: '基于课堂证据片段生成可回放、可勾选完成的复习卡片。',
    tags: ['student', 'review', 'cards', 'context-first'],
    capabilities: ['citation-card', 'task-writeback', 'seek-action'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    // Agent-native 姿态：不再用 KEYWORDS 关键词匹配"猜"用户意图。
    // 分派权完全交给上游——agent 的 tool-calling 决定调用 makeKnowledgeCards，
    // 或前端显式传 appKey='knowledge-cards'。此处只做结构性守卫。
    if (context.input.transcript.length === 0) return false;
    return context.goal.appKey === 'knowledge-cards' || context.goal.expectedOutput === 'cards';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const evidenceSegments = pickEvidenceSegments(context.input.transcript, 3);
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: LLMOutput | null = null;
    try {
      llmOutput = await generateCopyWithLLM(context, model, evidenceSegments);
    } catch {
      llmOutput = null;
    }
    const drafts = Array.isArray(llmOutput?.cards) ? llmOutput.cards.slice(0, evidenceSegments.length) : [];

    return {
      pluginId: 'knowledge-cards',
      version: '0.1.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `evidence_segments=${evidenceSegments.length}`,
        `llm_copy=${llmOutput ? 'enabled' : 'fallback'}`,
        'strategy=context_first',
      ],
      cards: buildKnowledgeCards(tools, evidenceSegments, llmOutput?.overview, drafts),
      tasks: buildTasks(evidenceSegments, drafts),
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
