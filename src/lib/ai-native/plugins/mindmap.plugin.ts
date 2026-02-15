import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';

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

async function generateMindMap(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string
): Promise<MindMapOutput | null> {
  const response = await chat(
    [
      {
        role: 'system',
        content:
          '你是一位知识架构师，擅长把课堂内容重组为可讲解、可复述、可迁移的学习导图。严格基于课堂证据，输出纯 JSON。',
      },
      {
        role: 'user',
        content: `目标：${context.goal.intent}
用户画像：学生要用导图做课堂复盘，要求“能看懂、能复述、能迁移”。

请输出一份结构清晰的课堂导图。你可以自主决定分支数量和层次深度，但要覆盖：核心概念、关键关系、易错点、实际应用。

最小输出契约（仅字段约束）：
{
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
说明：startMs/endMs 为可选证据定位字段，不确定可留空。

课堂原文：
${transcriptContext}

${anchorContext ? `学习者关注点：\n${anchorContext}` : ''}`,
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
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 22_000,
      includeIndex: true,
      includeTimestamp: false,
      minCharsPerSegment: 52,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const evidenceSegments = pickEvidenceSegments(
      context.input.transcript,
      Math.min(TARGET_BRANCH_COUNT, Math.max(3, Math.ceil(context.input.transcript.length / 5)))
    );
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: MindMapOutput | null = null;
    try {
      llmOutput = await generateMindMap(context, model, promptContext.text, anchorContext);
    } catch {
      llmOutput = null;
    }

    const branchDrafts =
      Array.isArray(llmOutput?.branches) && llmOutput.branches.length > 0
        ? llmOutput.branches.slice(0, TARGET_BRANCH_COUNT + 3)
        : evidenceSegments.map((segment) => ({
            title: tools.summarizeSegments([segment], 28) || `分支`,
            points: [tools.summarizeSegments([segment], 80) || segment.text.slice(0, 80)],
            startMs: segment.startMs,
            endMs: segment.endMs,
          }));

    const normalizedBranches = branchDrafts.map((draft, index) => {
      const segment = evidenceSegments[index % Math.max(1, evidenceSegments.length)] || evidenceSegments[0];
      const title = draft?.title?.trim() || `分支 ${index + 1}`;
      const points = toPoints(draft?.points);
      return {
        title,
        points:
          points.length > 0
            ? points
            : [tools.summarizeSegments([segment], 60) || segment.text.slice(0, 60)],
        startMs: toTimestamp(draft?.startMs, segment?.startMs ?? 0),
        endMs: toTimestamp(draft?.endMs, segment?.endMs ?? (segment?.startMs ?? 0) + 8000),
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
        `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
        `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
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
