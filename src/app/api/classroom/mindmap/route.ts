import { NextRequest, NextResponse } from 'next/server';
import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('classroom/mindmap');

/**
 * /api/classroom/mindmap — 录课中「生长中的思维导图」生成
 *
 * 设计意图（对齐 Taste）：
 *   录课过程中，AI 不是每几秒就往屏幕上塞一个节点，而是在合适的时机，
 *   从整段转录里一次性提炼出一棵结构清晰的小树：
 *     中心节点（课程主题） → 3-6 个分支（小概念）→ 每分支 2-4 个叶子
 *
 *   "生长"不靠每句话都长节点，靠的是「合适的时机整理成形」的克制感——
 *   一眼就能看出老师讲到哪、讲了几个大概念，而不是被一屏无关短句淹没。
 *
 *   前端每 ~45s 调一次，或命中主题切换词时追加。
 *
 * 模型：qwen3.5-plus
 *   又快又好又便宜。一次直接返回完整树，比快慢双模型架构简单可靠。
 *
 * 入参：
 *   transcriptText：从开录到现在累积的转录全文
 *   elapsedMs：开录到现在的毫秒数
 *   lessonTitle?：当前课程标题（可选）
 *   priorTree?：上一次的树（节点结构），用于 LLM 保持一致性、避免整棵树抖动
 *   importedHints?：课前导入的预习材料关键词（帮助模型识别专名）
 *
 * 出参：
 *   { tree: { title, nodes: MindMapNode[] } }
 *   空转录 / 太短 → { tree: { title: '', nodes: [] } }
 *
 * 约束：
 *   - nodes 里至少有 1 个 root（parentId === null），通常 1 个
 *   - 一级分支（parentId === root.id）不超过 6 个
 *   - 每个分支下叶子不超过 4 个
 *   - label 不含标点不含时间戳，控制在 12 字内
 *   - detail 可选，用于中心节点补充说明（中间开录场景）
 *   - anchorMs 是该节点最早对应转录位置的相对毫秒数（用于回跳录音）
 *
 * 失败策略：
 *   LLM 错误 → 返回上一次的树（如果有）或空树。绝不 500。
 *   思维导图失败不能影响录音主流程。
 */

interface MindMapNode {
  id: string;
  parentId: string | null;
  label: string;
  detail?: string;
  anchorMs: number;
}

interface MindMapTree {
  title: string;
  nodes: MindMapNode[];
}

interface RequestBody {
  transcriptText?: string;
  elapsedMs?: number;
  lessonTitle?: string;
  priorTree?: MindMapTree;
  importedHints?: string[];
}

/** 最少录音 90s 才开始画树（避免开场寒暄污染） */
const MIN_ELAPSED_MS = 90 * 1000;
/** 转录至少这么长才调 LLM */
const MIN_CHARS = 120;
/** 传给 LLM 的转录最大长度 */
const MAX_INPUT_CHARS = 4000;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const {
      transcriptText = '',
      elapsedMs = 0,
      lessonTitle,
      priorTree,
      importedHints,
    } = body;

    const text = transcriptText.trim();

    // 预热期：直接返回中心占位节点
    if (elapsedMs < MIN_ELAPSED_MS || text.length < MIN_CHARS) {
      const rootId = 'root-placeholder';
      return NextResponse.json({
        tree: {
          title: lessonTitle || '正在识别本段主题…',
          nodes: [
            {
              id: rootId,
              parentId: null,
              label: lessonTitle || '正在识别本段主题…',
              anchorMs: 0,
            },
          ],
        } satisfies MindMapTree,
      });
    }

    const trimmed = text.length > MAX_INPUT_CHARS
      ? `…（前略）${text.slice(-MAX_INPUT_CHARS)}`
      : text;

    const titleHint = lessonTitle ? `课程标题（用户已填）：${lessonTitle}\n` : '';
    const hintsBlock = importedHints && importedHints.length > 0
      ? `课前预习材料关键词（可用于识别专名）：${importedHints.slice(0, 12).join('、')}\n`
      : '';
    const priorBlock = priorTree && priorTree.nodes.length > 1
      ? `\n上一次提炼的结构（请在此基础上增量扩展，不要推翻重来，除非老师明显换了大主题）：\n${summarizeTree(priorTree)}\n`
      : '';

    const systemPrompt = `你是一名课堂笔记助手。任务：从「正在进行的课堂转录」里，提炼一棵结构化的思维导图——用来让学生一眼看清老师讲到了哪、讲了几个大概念。

输出一棵树：
- 1 个中心节点（课程主题/本段主题）
- 2-5 个一级分支（老师讲的几个主要概念 / 小节）
- 每个分支下 1-4 个叶子（该概念的要点、关键术语、例子）

硬约束：
- 一级分支不超过 6 个。宁可少，不要多。
- 每分支叶子不超过 4 个。
- 每个 label 不超过 12 个汉字，不要带标点符号、不要带时间戳。
- 中心节点的 label 要提炼出这节课（或本段）的核心主题，不要复读老师的某一句话。
- 不要把口语碎片（"嗯"、"这个这个"、"是的"）写成节点。
- 如果老师还没切换到正式讲课内容（还在寒暄/点名），只返回一个中心占位节点，nodes 里只有 root。
- 如果有 priorTree，尽量保留已有节点的 id 和 label，只做增量追加或小修正。不要无缘无故改 id。

输出 JSON 格式（严格遵守）：
{
  "title": "中心节点 label（同 root.label）",
  "nodes": [
    {"id": "root", "parentId": null, "label": "中心主题", "anchorMs": 0, "detail": "可选，本段核心一句话（≤30字），仅中心节点可带"},
    {"id": "b1", "parentId": "root", "label": "分支1标签", "anchorMs": 12000},
    {"id": "b1-l1", "parentId": "b1", "label": "叶子1", "anchorMs": 15000},
    ...
  ]
}

id 规则：中心用 "root"；分支用 "b1"/"b2"/...；叶子用 "b1-l1"/"b1-l2"/...。保持稳定，便于前端做进出场动画。

anchorMs 是该节点内容在课堂转录里大约第一次出现的时间（相对开始录音，毫秒）。没有精确信息就估一个合理值。

仅输出 JSON，不要解释。`;

    const userMsg = `${titleHint}${hintsBlock}${priorBlock}
课堂转录（从开录到现在累计，单位已过 ${Math.floor(elapsedMs / 1000)}s）：
${trimmed}`;

    try {
      const response = await chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        'qwen3.5-plus',
        { temperature: 0.3, maxTokens: 900, responseFormat: 'json_object' },
      );

      const parsed = JSON.parse(response.content);
      const tree = sanitizeTree(parsed, elapsedMs);

      return NextResponse.json({ tree });
    } catch (llmError) {
      log.warn('[mindmap] LLM error, returning prior or empty', llmError);
      if (priorTree && priorTree.nodes.length > 0) {
        return NextResponse.json({ tree: priorTree });
      }
      return NextResponse.json({
        tree: { title: lessonTitle || '', nodes: [] } satisfies MindMapTree,
      });
    }
  } catch (error) {
    log.error('[mindmap] Request error:', error);
    return NextResponse.json(
      { tree: { title: '', nodes: [] } satisfies MindMapTree },
      { status: 200 },
    );
  }
}

// ── helpers ────────────────────────────────────────────────────────

/** 把树压成一段给 LLM 看的文本 */
function summarizeTree(tree: MindMapTree): string {
  const root = tree.nodes.find((n) => n.parentId === null);
  if (!root) return '（空）';
  const branches = tree.nodes.filter((n) => n.parentId === root.id);
  const lines: string[] = [`[root:${root.id}] ${root.label}`];
  for (const b of branches) {
    lines.push(`  └ [${b.id}] ${b.label}`);
    const leaves = tree.nodes.filter((n) => n.parentId === b.id);
    for (const l of leaves) {
      lines.push(`      └ [${l.id}] ${l.label}`);
    }
  }
  return lines.join('\n');
}

/** 清洗 LLM 返回，确保结构正确 + 硬上限兜底 */
function sanitizeTree(raw: unknown, elapsedMs: number): MindMapTree {
  const fallbackTitle = '正在整理…';
  if (!raw || typeof raw !== 'object') {
    return { title: fallbackTitle, nodes: [] };
  }
  const obj = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? (obj.nodes as unknown[]) : [];

  // 第一步：转结构
  const nodes: MindMapNode[] = [];
  for (const n of rawNodes) {
    if (!n || typeof n !== 'object') continue;
    const nn = n as Record<string, unknown>;
    const id = typeof nn.id === 'string' && nn.id.trim() ? nn.id.trim() : '';
    const label = typeof nn.label === 'string' ? nn.label.trim() : '';
    if (!id || !label) continue;
    const parentId =
      nn.parentId === null || nn.parentId === undefined
        ? null
        : typeof nn.parentId === 'string'
          ? nn.parentId.trim()
          : null;
    const anchorMs =
      typeof nn.anchorMs === 'number' && Number.isFinite(nn.anchorMs)
        ? Math.max(0, Math.min(nn.anchorMs, elapsedMs))
        : 0;
    const detail =
      typeof nn.detail === 'string' && nn.detail.trim().length > 0
        ? nn.detail.trim().slice(0, 80)
        : undefined;
    nodes.push({
      id,
      parentId,
      label: label.replace(/[。，！？；：,.;!?"'`、]/g, '').slice(0, 14),
      detail,
      anchorMs,
    });
  }

  // 第二步：找唯一 root
  const roots = nodes.filter((n) => n.parentId === null);
  if (roots.length === 0) {
    return { title: fallbackTitle, nodes: [] };
  }
  // 如果 LLM 返回多个 root，只留第一个，其余挂到它下面
  const root = roots[0];
  for (let i = 1; i < roots.length; i++) {
    roots[i].parentId = root.id;
  }

  // 第三步：分支硬上限 6，叶子硬上限 4
  const branches = nodes.filter((n) => n.parentId === root.id).slice(0, 6);
  const branchIds = new Set(branches.map((b) => b.id));
  const keptLeaves: MindMapNode[] = [];
  for (const b of branches) {
    const leaves = nodes.filter((n) => n.parentId === b.id).slice(0, 4);
    keptLeaves.push(...leaves);
  }

  const finalNodes: MindMapNode[] = [
    root,
    ...branches,
    ...keptLeaves.filter((l) => branchIds.has(l.parentId ?? '')),
  ];

  const title =
    typeof obj.title === 'string' && obj.title.trim().length > 0
      ? obj.title.trim().slice(0, 20)
      : root.label;

  return { title, nodes: finalNodes };
}
