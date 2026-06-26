import type { TranscriptSegment } from '@/types';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext, buildTerminologyHintBlock } from '../prompt-context';

/* ------------------------------------------------------------------ */
/*  多层嵌套树形结构                                                    */
/* ------------------------------------------------------------------ */

export interface MindmapNode {
  title: string;
  children?: MindmapNode[];
  startMs?: number;
  endMs?: number;
}

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

function pickEvidenceSegments(transcript: TranscriptSegment[], count: number): TranscriptSegment[] {
  if (transcript.length <= count) return transcript;
  const picked: TranscriptSegment[] = [];
  const step = (transcript.length - 1) / Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    picked.push(transcript[Math.round(index * step)]);
  }
  return picked;
}

/* ------------------------------------------------------------------ */
/*  Markdown ↔ 树形结构 互转                                           */
/* ------------------------------------------------------------------ */

/** 将嵌套树结构递归转为 Markdown 大纲（markmap 直接消费） */
export function treeToMarkdown(root: string, children: MindmapNode[], depth: number = 1): string {
  const lines: string[] = [`# ${root}`];
  const walk = (nodes: MindmapNode[], level: number) => {
    for (const node of nodes) {
      const indent = '  '.repeat(level - 1);
      lines.push(`${indent}- ${node.title}`);
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, level + 1);
      }
    }
  };
  walk(children, depth);
  return lines.join('\n');
}

/**
 * 去掉节点文本里的 inline markdown 标记（**粗体** / *斜体* / `代码` / [链接](url) / 前导 # - 等）。
 * SVG <text> 不渲染 markdown，节点标题必须是干净纯文本，否则会显示成字面量 `**xxx**`。
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*+/g, '')
    .trim();
}

/** 从 Markdown 层级大纲解析出树形结构（兼容 LLM 直接输出 Markdown） */
export function markdownToTree(markdown: string): { root: string; children: MindmapNode[] } {
  const lines = markdown.split('\n').filter((line) => line.trim());
  let root = '课堂知识结构';

  const rootMatch = lines[0]?.match(/^#{1,2}\s+(.+)/);
  if (rootMatch) {
    root = stripInlineMarkdown(rootMatch[1]);
    lines.shift();
  }

  const stack: { node: MindmapNode; depth: number }[] = [];
  const topChildren: MindmapNode[] = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)-\s+(.+)/);
    if (!match) continue;
    const depth = Math.floor(match[1].length / 2);
    const title = stripInlineMarkdown(match[2]);
    if (!title) continue;
    const node: MindmapNode = { title, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      topChildren.push(node);
    } else {
      const parent = stack[stack.length - 1].node;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }
    stack.push({ node, depth });
  }

  return { root, children: topChildren };
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

/* ------------------------------------------------------------------ */
/*  LLM 调用                                                           */
/* ------------------------------------------------------------------ */

async function generateMindMap(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string
): Promise<MindmapLLMOutput | null> {
  // 提示词哲学：描述目标和场景，不规定主干数 / 子节点数 / 字数。
  // "5 秒扫完"是给模型听的目标，由它自己决定该展开多深。
  const response = await chat(
    [
      {
        role: 'system',
        content: '你是一位深谙认知科学的知识架构师。你帮一位刚听完课的学生整理一张"扫一眼就能看出这节课讲了什么、几个大块"的结构图——不是详尽的课后笔记，是他余光扫到就能定位自己在课里哪一段的轻量地图。直接输出 Markdown 大纲（# 根主题 + - 子节点缩进），不要 JSON。',
      },
      {
        role: 'user',
        content: `${context.goal.intent ? `他的目标：${context.goal.intent}\n\n` : ''}${anchorContext ? `他听课时的困惑点（这些主题值得在主干层出现）：\n${anchorContext}\n\n` : ''}课堂原文：
${transcriptContext}${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
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
      maxChars: 8_000,
      includeIndex: false,
      includeTimestamp: false,
      minCharsPerSegment: 52,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: MindmapLLMOutput | null = null;
    try {
      llmOutput = await generateMindMap(context, model, promptContext.text, anchorContext);
    } catch {
      llmOutput = null;
    }

    let rootTitle = '课堂知识结构';
    let treeChildren: MindmapNode[] = [];
    let markdownBody = '';

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

    if (treeChildren.length === 0) {
      const evidenceSegments = pickEvidenceSegments(context.input.transcript, 5);
      treeChildren = evidenceSegments.map((segment) => ({
        title: tools.summarizeSegments([segment], 32) || segment.text.slice(0, 32),
        startMs: segment.startMs,
        endMs: segment.endMs,
        children: [
          {
            title: tools.summarizeSegments([segment], 80) || segment.text.slice(0, 80),
          },
        ],
      }));
      markdownBody = treeToMarkdown(rootTitle, treeChildren);
    }

    const depth = treeDepth(treeChildren);
    const topLevelBranches = flattenBranches(treeChildren).filter((node) => node.depth === 0);

    const evidenceSegments = pickEvidenceSegments(
      context.input.transcript,
      Math.max(3, topLevelBranches.length)
    );

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
      const segment = evidenceSegments[index % Math.max(1, evidenceSegments.length)] || evidenceSegments[0];
      const startMs = branch.startMs ?? segment?.startMs ?? 0;
      const endMs = branch.endMs ?? segment?.endMs ?? startMs + 8000;

      cards.push({
        id: `mindmap-branch-${index + 1}`,
        type: 'timeline',
        title: branch.title,
        body: Array.isArray(branch.children)
          ? branch.children.map((child, childIndex) => `${childIndex + 1}. ${child.title}`).join('\n')
          : branch.title,
        priority: 'medium',
        citations: [
          {
            startMs,
            endMs,
            snippet: segment?.text?.slice(0, 120) || '',
          },
        ],
        actions: [
          {
            id: `seek-mindmap-${index + 1}`,
            label: `回放 ${formatTimestamp(startMs)}`,
            kind: 'seek',
            payload: { timestamp: startMs },
          },
        ],
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
        `llm=${llmOutput ? (llmOutput.markdown ? 'markdown' : 'json') : 'fallback'}`,
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
