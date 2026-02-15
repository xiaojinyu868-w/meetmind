import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';

const KEYWORDS = ['导图', '思维导图', '结构', '知识图谱', 'mindmap'];
const TARGET_BRANCH_COUNT = 5;

interface MindMapBranchDraft {
  title?: string;
  points?: string[];
  startMs?: number | string;
  endMs?: number | string;
}

interface MindMapOutput {
  rootTitle?: string;
  branches?: MindMapBranchDraft[];
}

function includesKeyword(intent: string): boolean {
  return KEYWORDS.some((keyword) => intent.includes(keyword));
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

function toPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 6);
}

function buildPrompt(segments: TranscriptSegment[]): string {
  return segments
    .map((segment, index) => {
      const start = formatTimestamp(segment.startMs);
      const end = formatTimestamp(segment.endMs);
      return `片段${index + 1} [${start}-${end}] startMs=${segment.startMs} endMs=${segment.endMs}\n${segment.text}`;
    })
    .join('\n\n');
}

async function generateMindMap(
  context: AppExecutionContext,
  model: string,
  segments: TranscriptSegment[]
): Promise<MindMapOutput | null> {
  const prompt = buildPrompt(segments);
  const response = await chat(
    [
      {
        role: 'system',
        content: '你是课堂知识结构化助手。只根据给定片段输出 JSON，不要输出额外文本。',
      },
      {
        role: 'user',
        content: `目标：${context.goal.intent}
请把课堂内容整理为 1 个主干 + ${segments.length} 个分支。每个分支至少 2 个要点，并尽量补全 startMs/endMs。
JSON 格式：{
  "rootTitle": "主题",
  "branches": [
    {
      "title": "分支标题",
      "points": ["要点1", "要点2"],
      "startMs": 12000,
      "endMs": 22000
    }
  ]
}

课堂片段：${prompt}`,
      },
    ],
    model,
    { temperature: 0.2, maxTokens: 1800 }
  );

  return parseJsonResponse<MindMapOutput>(response.content);
}

function buildTreeBody(root: string, branches: Array<{ title: string; points: string[] }>): string {
  const lines = [`# ${root}`];
  branches.forEach((branch) => {
    lines.push(`- ${branch.title}`);
    branch.points.forEach((point) => lines.push(`  - ${point}`));
  });
  return lines.join('\n');
}

export const mindmapPlugin: AppPlugin = {
  manifest: {
    id: 'mindmap-outline',
    name: '思维导图',
    version: '0.1.0',
    description: '将课堂内容结构化为主干 + 分支导图，并支持证据回放。',
    tags: ['student', 'mindmap', 'structure'],
    capabilities: ['structure-map', 'seek-action'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    if (context.input.transcript.length === 0) return false;
    const intent = context.goal.intent.toLowerCase();
    return includesKeyword(intent);
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const evidenceSegments = pickEvidenceSegments(
      context.input.transcript,
      Math.min(TARGET_BRANCH_COUNT, Math.max(3, Math.ceil(context.input.transcript.length / 5)))
    );
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: MindMapOutput | null = null;
    try {
      llmOutput = await generateMindMap(context, model, evidenceSegments);
    } catch {
      llmOutput = null;
    }

    const normalizedBranches = evidenceSegments.map((segment, index) => {
      const draft = llmOutput?.branches?.[index];
      const title = draft?.title?.trim() || `分支 ${index + 1}`;
      const points = toPoints(draft?.points);
      return {
        title,
        points: points.length > 0 ? points : [tools.summarizeSegments([segment], 60) || segment.text.slice(0, 60)],
        startMs: toTimestamp(draft?.startMs, segment.startMs),
        endMs: toTimestamp(draft?.endMs, segment.endMs),
        source: segment,
      };
    });

    const rootTitle = llmOutput?.rootTitle?.trim() || '课堂知识结构';

    const cards: AppExecutionResult['cards'] = [
      {
        id: 'mindmap-overview',
        type: 'mindmap',
        title: rootTitle,
        body: buildTreeBody(
          rootTitle,
          normalizedBranches.map((branch) => ({ title: branch.title, points: branch.points }))
        ),
        priority: 'high',
      },
    ];

    normalizedBranches.forEach((branch, index) => {
      cards.push({
        id: `mindmap-branch-${index + 1}`,
        type: 'timeline',
        title: branch.title,
        body: branch.points.map((point, pointIndex) => `${pointIndex + 1}. ${point}`).join('\n'),
        priority: 'medium',
        citations: [
          {
            startMs: branch.startMs,
            endMs: branch.endMs,
            snippet: branch.source.text.slice(0, 120),
          },
        ],
        actions: [
          {
            id: `seek-mindmap-${index + 1}`,
            label: `回放 ${formatTimestamp(branch.startMs)}`,
            kind: 'seek',
            payload: { timestamp: branch.startMs },
          },
        ],
        meta: {
          cardKind: 'mindmap',
          bullets: branch.points,
        },
      });
    });

    return {
      pluginId: 'mindmap-outline',
      version: '0.1.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `branches=${normalizedBranches.length}`,
        `llm=${llmOutput ? 'enabled' : 'fallback'}`,
      ],
      cards,
      tasks: normalizedBranches.map((branch, index) => ({
        id: `mindmap-task-${index + 1}`,
        label: `复述导图分支 ${index + 1}`,
        reason: '结构化复述能显著提升迁移能力。',
        estimatedMinutes: 3,
        relatedTimestamp: branch.startMs,
      })),
      render: {
        mode: 'mindmap',
        title: rootTitle,
        description: '按主干与分支组织课堂知识。',
        payload: {
          root: rootTitle,
          branches: normalizedBranches.map((branch) => ({
            title: branch.title,
            points: branch.points,
            startMs: branch.startMs,
          })),
        },
      },
      nextSuggestedPlugins: ['quiz-arena'],
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
