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
 * 模型：qwen3.7-plus
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

/** 最少录音 40s 才开始画树（避免开场寒暄污染） */
const MIN_ELAPSED_MS = 40 * 1000;
/** 转录至少这么长才调 LLM */
const MIN_CHARS = 80;
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

    log.info(
      `[mindmap] hit elapsedMs=${elapsedMs} textLen=${text.length} priorNodes=${priorTree?.nodes?.length ?? 0}`,
    );

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

    const systemPrompt = `你帮一个正在听课的学生做一件事：把他正在录的这节课，**此时此刻**提炼成一张他瞟一眼就能看出"老师讲到哪了、讲了几个大概念"的小树。

不是做 PPT 目录，不是做课后笔记。是"课进行到一半，屏幕一角那张跟着老师长的图"——他余光扫到就知道自己在课里的哪个位置。

所以这棵树的尺度感很重要：
- 中心节点是这节课此时此刻的核心主题（或已经讲过的那段内容的主题）
- 一级分支是老师讲的几个主要概念，一般 2-5 个，**最多不要超过 6 个**，太多就糊成一片了
- 叶子是某个概念下的要点或例子，**每个分支下控制在 1-4 个**

好节点是"浓缩过的概念名"——"极限的定义"、"反例：1/n"；
烂节点是"老师刚说的一句话"——"老师说这个点很重要"、"嗯那个这样子"。口语碎片（"嗯"、"这个这个"、"是的"）永远不要进树。

时机感：
- 如果老师还在开场寒暄/点名，正式内容还没开始，就只给一个中心占位节点，整棵树里只有 root。不要强行编东西。
- 如果上一轮已经给过一棵 \`priorTree\`，这一轮尽量**增量扩展**：保留已有分支/叶子的 id，只在合适的地方追加新的分支或叶子。
- 但中心主题不是不可改的：如果前一轮因为信息太少把 root.label 起偏了，而这一轮能看出更准确的课程主线，请更新 title 和 root.label；不要为了稳定性保留明显错误的标题。
- 除非老师明显切换到了一个大的新主题，否则不要推翻整棵树。稳定的是结构和节点 id，不是错误标题。

${titleHint ? titleHint.trim() + '\n\n' : ''}${hintsBlock ? hintsBlock.trim() + '\n\n' : ''}输出 JSON（前端按字段渲染，这部分是硬契约）：
{
  "title": "当前最准确的中心主题",
  "nodes": [
    {"id": "root", "parentId": null, "label": "中心主题", "anchorMs": 0, "detail": "可选，本段核心一句话（≤30 字），仅中心节点可带"},
    {"id": "b1", "parentId": "root", "label": "分支标签", "anchorMs": 12000},
    {"id": "b1-l1", "parentId": "b1", "label": "叶子标签", "anchorMs": 15000}
  ]
}

id 规则：中心用 "root"，分支用 "b1"/"b2"/…，叶子用 "b1-l1"/"b1-l2"/…。
label 写成浓缩概念名，12 字以内，不带标点、不带时间戳。
anchorMs 是这个节点内容在转录里大约**最早**出现的时间（相对开录，单位毫秒）——估一个合理值就行。

仅输出 JSON，不要解释。`;

    const userMsg = `${priorBlock}
课堂转录（从开录到现在累计，已过 ${Math.floor(elapsedMs / 1000)}s）：
${trimmed}`;

    try {
      const response = await chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        'qwen3.7-plus',
        { temperature: 0.3, maxTokens: 900, responseFormat: 'json_object' },
      );

      const parsed = JSON.parse(response.content);
      const tree = sanitizeTree(parsed, elapsedMs);
      log.info(
        `[mindmap] tree built nodes=${tree.nodes.length} title="${tree.title.slice(0, 20)}"`,
      );

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
