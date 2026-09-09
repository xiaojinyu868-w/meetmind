import type { TranscriptSegment } from '@/types';
// 纯树结构/Markdown 互转已拆到 mindmap-tree（客户端安全）；此处 re-export 保持兼容
import { markdownToTree, stripInlineMarkdown, treeToMarkdown, type MindmapNode } from './mindmap-tree';

export { markdownToTree, stripInlineMarkdown, treeToMarkdown, type MindmapNode } from './mindmap-tree';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildMindmapSystemPrompt, buildMindmapUserPrompt } from '../app-prompts';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';
import { resolveGroundedEvidence } from '../evidence-grounding';

/* ------------------------------------------------------------------ */
/*  多层嵌套树形结构                                                    */
/* ------------------------------------------------------------------ */

interface MindmapLLMOutput {
  rootTitle?: string;
  markdown?: string;
  children?: MindmapNodeDraft[];
}

interface MindmapNodeDraft {
  title?: string;
  children?: MindmapNodeDraft[];
  startMs?: number | string;
  endMs?: number | string;
}

/* ------------------------------------------------------------------ */
/*  工具函数                                                            */
/* ------------------------------------------------------------------ */

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return fallback;
}


/** 将 LLM 输出的嵌套 JSON draft 标准化为 MindmapNode[] */
function normalizeDraftNodes(drafts: MindmapNodeDraft[] | undefined): MindmapNode[] {
  if (!Array.isArray(drafts)) return [];
  return drafts
    .filter((draft) => draft && typeof draft.title === 'string' && stripInlineMarkdown(draft.title))
    .map((draft) => ({
      title: stripInlineMarkdown(draft.title!),
      children: normalizeDraftNodes(draft.children),
      startMs: typeof draft.startMs !== 'undefined' ? toTimestamp(draft.startMs, 0) : undefined,
      endMs: typeof draft.endMs !== 'undefined' ? toTimestamp(draft.endMs, 0) : undefined,
    }));
}

/** 从旧版扁平 branches 格式兼容转换为树形结构 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _legacyBranchesToTree(
  branches: Array<{ title?: string; points?: string[]; startMs?: number }>
): MindmapNode[] {
  return branches
    .filter((branch) => branch.title)
    .map((branch) => ({
      title: branch.title!,
      startMs: branch.startMs,
      children: Array.isArray(branch.points)
        ? branch.points.filter(Boolean).map((point) => ({ title: point }))
        : [],
    }));
}

/** 收集树中所有叶子和非叶子节点的平铺列表（用于 cards/tasks 生成） */
function flattenBranches(
  nodes: MindmapNode[],
  depth: number = 0
): Array<MindmapNode & { depth: number }> {
  const result: Array<MindmapNode & { depth: number }> = [];
  for (const node of nodes) {
    result.push({ ...node, depth });
    if (Array.isArray(node.children) && node.children.length > 0) {
      result.push(...flattenBranches(node.children, depth + 1));
    }
  }
  return result;
}

/** 统计树的深度 */
function treeDepth(nodes: MindmapNode[]): number {
  if (nodes.length === 0) return 0;
  return 1 + Math.max(...nodes.map((node) => treeDepth(node.children || [])));
}

/** 删除没有原文支撑的叶子；抽象父节点只有在自己或至少一个子节点有证据时保留。 */
/**
 * 给节点挂"回到原话"的时间点。2026-09-09 起只标注、不删节点：导图节点是模型的抽象
 * （"核心概念 / 应用场景"），与原文的字面重叠天然很低，此前落地不到就删节点，长课会把模型
 * 的结构删成空树再用抽样片段拼一棵假树。现在：落地到就给时间点，落地不到就没有跳转，结构照旧。
 */
export function groundMindmapNodes(
  nodes: MindmapNode[],
  transcript: TranscriptSegment[],
): MindmapNode[] {
  return nodes.map((node) => {
    const groundedChildren = groundMindmapNodes(node.children ?? [], transcript);
    const resolution = resolveGroundedEvidence(node.title, transcript, node.startMs);
    const firstGroundedChild = groundedChildren.find((child) => typeof child.startMs === 'number');
    const evidence = resolution.supported || resolution.method === 'timestamp' ? resolution.segment : undefined;
    return {
      ...node,
      children: groundedChildren,
      startMs: evidence?.startMs ?? firstGroundedChild?.startMs,
      endMs: evidence?.endMs ?? firstGroundedChild?.endMs,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  LLM 调用                                                           */
/* ------------------------------------------------------------------ */

async function generateMindMap(
  context: AppExecutionContext,
  model: string,
  systemPrompt: string,
  transcriptContext: string,
  anchorContext: string
): Promise<MindmapLLMOutput | null> {
  // 提示词哲学：描述目标和场景，不规定主干数 / 子节点数 / 字数。
  // "5 秒扫完"是给模型听的目标，由它自己决定该展开多深。
  const response = await chat(
    [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: buildMindmapUserPrompt({
          goalIntent: context.goal.intent,
          transcriptContext,
          anchorContext,
          terminologyHint: context.memory.terminologyHint,
        }),
      },
    ],
    model,
    { temperature: 0.3, maxTokens: 1800 }
  );

  const content = (response.content || '').trim();

  if (content.startsWith('#') || content.startsWith('-')) {
    return { markdown: content };
  }

  const codeBlockMatch = content.match(/```(?:markdown|md)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return { markdown: codeBlockMatch[1].trim() };
  }

  if (content.includes('- ') && content.includes('\n')) {
    return { markdown: content };
  }

  try {
    const parsed = JSON.parse(content) as MindmapNodeDraft & { rootTitle?: string; branches?: MindmapNodeDraft[] };
    return {
      rootTitle: parsed.rootTitle,
      children: Array.isArray(parsed.children)
        ? parsed.children
        : Array.isArray(parsed.branches)
          ? parsed.branches
          : undefined,
    };
  } catch {
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]) as MindmapNodeDraft & { rootTitle?: string; branches?: MindmapNodeDraft[] };
        return {
          rootTitle: parsed.rootTitle,
          children: Array.isArray(parsed.children)
            ? parsed.children
            : Array.isArray(parsed.branches)
              ? parsed.branches
              : undefined,
        };
      } catch {
        /* fall through */
      }
    }
  }

  return { markdown: content };
}

/* ------------------------------------------------------------------ */
/*  插件定义                                                            */
/* ------------------------------------------------------------------ */

export const mindmapPlugin: AppPlugin = {
  manifest: {
    id: 'mindmap-outline',
    name: '思维导图',
    version: '0.3.0',
    description: '"5 秒扫完"的单课结构图：3-5 主干 × 最多 3 子 × 深度 ≤3。单元层是真正主舞台。',
    tags: ['student', 'mindmap', 'structure', 'class-tier-degraded'],
    capabilities: ['structure-map', 'seek-action'],
    enabledByDefault: true,
  },

  canHandle(context: AppExecutionContext): boolean {
    // Agent-native 姿态：不再用 KEYWORDS 关键词匹配"猜"用户意图。
    // 分派权完全交给上游——agent 的 tool-calling 决定调用 makeMindmap，
    // 或前端显式传 appKey='mindmap'。此处只做结构性守卫。
    if (context.input.transcript.length === 0) return false;
    return context.goal.appKey === 'mindmap';
  },

  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 48_000,
      includeIndex: false,
      includeTimestamp: false,
      minCharsPerSegment: 52,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const systemPrompt = context.runtimeControl?.systemPrompt || buildMindmapSystemPrompt();
    const model = context.runtimeControl?.modelId || context.model || DEFAULT_MODEL_ID;

    let llmOutput: MindmapLLMOutput | null = null;
    let rootTitle = '课堂知识结构';
    let treeChildren: MindmapNode[] = [];
    let markdownBody = '';
    // 一次重试；两次都拿不到结构就诚实失败（不再用抽样片段拼一棵假树）
    let attempts = 0;
    while (attempts < 2 && treeChildren.length === 0) {
      attempts += 1;
      try {
        llmOutput = await generateMindMap(context, model, systemPrompt, promptContext.text, anchorContext);
      } catch (err) {
        console.error('[mindmap-plugin] generateMindMap failed: attempt=', attempts, err instanceof Error ? err.message : err);
        llmOutput = null;
      }
      if (llmOutput?.markdown) {
        const parsed = markdownToTree(llmOutput.markdown);
        rootTitle = parsed.root;
        treeChildren = parsed.children;
        markdownBody = llmOutput.markdown;
      } else if (llmOutput?.children) {
        treeChildren = normalizeDraftNodes(llmOutput.children);
        rootTitle = llmOutput.rootTitle?.trim() || rootTitle;
        markdownBody = treeToMarkdown(rootTitle, treeChildren);
      }
    }
    if (treeChildren.length === 0) throw new Error('GENERATION_FAILED');

    treeChildren = groundMindmapNodes(treeChildren, context.input.transcript);
    markdownBody = treeToMarkdown(rootTitle, treeChildren);

    const depth = treeDepth(treeChildren);
    const topLevelBranches = flattenBranches(treeChildren).filter((node) => node.depth === 0);


    const cards: AppExecutionResult['cards'] = [
      {
        id: 'mindmap-overview',
        type: 'mindmap',
        title: rootTitle,
        body: markdownBody,
        priority: 'high',
      },
    ];

    topLevelBranches.forEach((branch, index) => {
      // 只有落地到原话的分支才给引用与跳转；落地不到就没有（跳错比没有更伤信任）
      const segment = typeof branch.startMs === 'number'
        ? context.input.transcript.find((item) => branch.startMs! >= item.startMs && branch.startMs! <= item.endMs)
        : undefined;
      const startMs = segment ? (branch.startMs ?? segment.startMs) : undefined;
      const endMs = segment ? (branch.endMs ?? segment.endMs ?? (startMs ?? 0) + 8000) : undefined;

      cards.push({
        id: `mindmap-branch-${index + 1}`,
        type: 'timeline',
        title: branch.title,
        body: Array.isArray(branch.children)
          ? branch.children.map((child, childIndex) => `${childIndex + 1}. ${child.title}`).join('\n')
          : branch.title,
        priority: 'medium',
        ...(segment && typeof startMs === 'number' && typeof endMs === 'number'
          ? {
            citations: [{ startMs, endMs, snippet: segment.text?.slice(0, 120) || '' }],
            actions: [{ id: `seek-mindmap-${index + 1}`, label: `回放 ${formatTimestamp(startMs)}`, kind: 'seek', payload: { timestamp: startMs } }],
          }
          : {}),
        meta: {
          cardKind: 'mindmap',
          points: Array.isArray(branch.children) ? branch.children.map((child) => child.title) : [],
        },
      });
    });

    return {
      pluginId: 'mindmap-outline',
      version: '0.2.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `top_branches=${topLevelBranches.length}`,
        `tree_depth=${depth}`,
        `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
        `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
        `llm=${llmOutput?.markdown ? 'markdown' : 'json'}`,
        `llm_attempts=${attempts}`,
      ],
      cards,
      tasks: topLevelBranches.slice(0, 6).map((branch, index) => ({
        id: `mindmap-task-${index + 1}`,
        label: `复述分支「${branch.title}」`,
        reason: '结构化复述能显著提升迁移能力。',
        estimatedMinutes: 3,
        relatedTimestamp: branch.startMs,
      })),
      render: {
        mode: 'mindmap',
        title: rootTitle,
        description: '多层级交互式思维导图，支持缩放、平移与节点展开。',
        payload: {
          root: rootTitle,
          markdown: markdownBody,
          children: treeChildren,
        },
      },
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
