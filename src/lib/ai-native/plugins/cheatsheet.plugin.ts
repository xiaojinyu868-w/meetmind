import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { COPY } from '@/lib/ui/copy';
import type {
  AppExecutionContext,
  AppExecutionResult,
  AppPlugin,
  AppPluginTools,
  ContextPack,
} from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext, buildTerminologyHintBlock } from '../prompt-context';
import { resolveGroundedEvidence } from '../evidence-grounding';

/**
 * Cheatsheet plugin (M7-fix10)
 *
 * 考试速查表：把课程单元 / 考试范围压成可打印的高密度参考页，参考
 * https://github.com/Evan715823/cheatsheet-generator-skill 的哲学：
 *   - 最大信息密度，每一寸都值得看
 *   - 语义分区（定义 / 公式 / 流程 / 对比 / 易错点 / 例题套路）
 *   - 颜色编码帮助扫读，不抢戏
 *
 * 为什么不直接复用 flashcards / quiz：
 *   它们是"出题测自己"，cheatsheet 是"看一眼就想起来"——
 *   两种认知任务，两种最合适的视觉密度。
 *
 * 输出 JSON 契约（固定，供 CheatsheetWindow 直接消费）：
 *   {
 *     title, overview,
 *     sections: [
 *       { key, label, items: [ { term, body, latex?, citation? } ] }
 *     ]
 *   }
 */

export type CheatsheetSectionKey =
  | 'definition'
  | 'formula'
  | 'process'
  | 'contrast'
  | 'pitfall'
  | 'exemplar';

const SECTION_LABELS: Record<CheatsheetSectionKey, string> = {
  definition: '核心定义',
  formula: '关键公式',
  process: '流程步骤',
  contrast: '关键对比',
  pitfall: '易错点',
  exemplar: '例题套路',
};

interface CheatsheetItemDraft {
  term?: string;
  body?: string;
  latex?: string;
  /** 'strong' = 原始课堂 / 大纲 / 真题明确强调；'normal' = 一般要点 */
  emphasis?: string;
  startMs?: number | string;
  endMs?: number | string;
  /** 多源上下文中的真实来源 id（课堂 session / exam-syllabus / past-paper:N）。 */
  sourceId?: string;
}

interface CheatsheetSectionDraft {
  key?: string;
  label?: string;
  items?: CheatsheetItemDraft[];
}

interface CheatsheetLLMOutput {
  title?: string;
  overview?: string;
  sections?: CheatsheetSectionDraft[];
}

export interface CheatsheetItem {
  id: string;
  term: string;
  body: string;
  latex?: string;
  /**
   * 视觉重要度。strong = 老师明确强调 / 课件标注 / 大纲或真题直接支持；
   * 在 UI 上会有更醒目的左侧色条与底色，提示考生"这条优先记牢"。
   */
  emphasis: 'normal' | 'strong';
  citation?: {
    startMs: number;
    endMs: number;
    snippet?: string;
    /** 多课堂产物必须保留具体课堂与课内时间；单课旧结果可为空。 */
    sourceId?: string;
    sourceTitle?: string;
    sourceStartMs?: number;
    sourceEndMs?: number;
    sourceKind?: 'lesson' | 'syllabus' | 'past-paper';
  };
}

export interface CheatsheetSection {
  key: CheatsheetSectionKey;
  label: string;
  items: CheatsheetItem[];
}

export interface CheatsheetPayload {
  title: string;
  overview: string;
  sections: CheatsheetSection[];
  sources?: Array<{ id: string; title: string; kind: 'lesson' | 'syllabus' | 'past-paper' }>;
}

interface LessonSourceMeta {
  sessionId: string;
  title: string;
  offsetMs: number;
  durationMs: number;
}

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 保留 Markdown 的换行、列表缩进、表格与代码围栏，只清理不可见控制字符。 */
function cleanRichText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const NOT_READY_OUTPUT_PATTERN = /无法生成|不能生成|不适合生成|无效数据|不含(?:任何)?(?:学科|知识|考点|课程)内容|材料不足|内容不足|cannot generate|not enough (?:course|learning|academic) content/i;

/**
 * 模型已经判断材料不具备学习价值时，必须尊重这个判断。
 * 禁止再把原文逐句包装成“要点”，那只会制造一个形式完整的假成品。
 */
export function isRejectedCheatsheetDraft(output: CheatsheetLLMOutput | null): boolean {
  if (!output) return true;
  return NOT_READY_OUTPUT_PATTERN.test(`${cleanText(output.title ?? '')} ${cleanText(output.overview ?? '')}`);
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
    }
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      const hour = match[3] ? Number(match[1]) : 0;
      const minute = match[3] ? Number(match[2]) : Number(match[1]);
      const second = match[3] ? Number(match[3]) : Number(match[2]);
      if ([hour, minute, second].every((n) => Number.isFinite(n) && n >= 0)) {
        return (hour * 3600 + minute * 60 + second) * 1000;
      }
    }
  }
  return fallback;
}

function normalizeEmphasis(value: unknown): 'normal' | 'strong' {
  if (typeof value !== 'string') return 'normal';
  const v = value.trim().toLowerCase();
  if (v === 'strong' || v === 'high' || v === '必考' || v === '重点' || v === '★') {
    return 'strong';
  }
  return 'normal';
}

function normalizeSectionKey(value: unknown): CheatsheetSectionKey | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (key === 'definition' || key === 'formula' || key === 'process' ||
      key === 'contrast' || key === 'pitfall' || key === 'exemplar') {
    return key;
  }
  // 兼容中文键名
  const zhToKey: Record<string, CheatsheetSectionKey> = {
    '定义': 'definition', '核心定义': 'definition',
    '公式': 'formula', '关键公式': 'formula',
    '流程': 'process', '步骤': 'process', '流程步骤': 'process',
    '对比': 'contrast', '关键对比': 'contrast',
    '易错': 'pitfall', '易错点': 'pitfall',
    '例题': 'exemplar', '例题套路': 'exemplar',
  };
  return zhToKey[value.trim()] ?? null;
}

function getLessonSources(context: AppExecutionContext): LessonSourceMeta[] {
  const raw = context.input.metadata?.lessonSources;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is LessonSourceMeta => {
    if (!item || typeof item !== 'object') return false;
    const value = item as Partial<LessonSourceMeta>;
    return typeof value.sessionId === 'string'
      && typeof value.title === 'string'
      && typeof value.offsetMs === 'number'
      && typeof value.durationMs === 'number';
  });
}

function buildCitation(
  evidence: TranscriptSegment,
  lessonSources: LessonSourceMeta[],
): NonNullable<CheatsheetItem['citation']> {
  const source = lessonSources.find((item) => item.sessionId === evidence.sourceItemId);
  const sourceKind = evidence.sourceItemId === 'exam-syllabus'
    ? 'syllabus'
    : evidence.sourceItemId?.startsWith('past-paper:')
      ? 'past-paper'
      : 'lesson';
  return {
    startMs: evidence.startMs,
    endMs: evidence.endMs,
    snippet: cleanText(evidence.text || '').slice(0, 120),
    sourceId: source?.sessionId || evidence.sourceItemId,
    sourceTitle: source?.title || evidence.sourceTitle,
    sourceStartMs: source ? Math.max(0, evidence.startMs - source.offsetMs) : undefined,
    sourceEndMs: source ? Math.max(0, evidence.endMs - source.offsetMs) : undefined,
    sourceKind,
  };
}

function getExamEvidence(context: AppExecutionContext): TranscriptSegment[] {
  const exam = context.input.metadata?.exam as ContextPack['exam'] | undefined;
  const evidence: TranscriptSegment[] = [];
  if (exam?.syllabus?.trim()) {
    evidence.push({
      id: 'exam-syllabus',
      text: exam.syllabus.trim().slice(0, 12_000),
      startMs: 0,
      endMs: 0,
      confidence: 1,
      isFinal: true,
      sourceItemId: 'exam-syllabus',
      sourceTitle: COPY.apps.cheatsheet.syllabusSource,
    });
  }
  exam?.pastPapers?.forEach((paper, index) => {
    if (!paper.content?.trim()) return;
    evidence.push({
      id: `past-paper:${index}`,
      text: paper.content.trim().slice(0, 16_000),
      startMs: 0,
      endMs: 0,
      confidence: 1,
      isFinal: true,
      sourceItemId: `past-paper:${index}`,
      sourceTitle: paper.title?.trim() || COPY.apps.cheatsheet.pastPaperSource(index + 1),
    });
  });
  return evidence;
}

async function generateCheatsheetWithLLM(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string,
): Promise<CheatsheetLLMOutput | null> {
  const lessonSources = getLessonSources(context);
  const exam = context.input.metadata?.exam as ContextPack['exam'] | undefined;
  const sourceSummary = lessonSources.length > 0
    ? lessonSources.map((source, index) => `${index + 1}. ${source.title}（sourceId=${source.sessionId}）`).join('\n')
    : '当前课程单元';
  const paperScope = exam?.pastPapers
    ?.filter((paper) => paper.content?.trim())
    .map((paper, index) => `真题来源 sourceId=past-paper:${index} · ${paper.title}\n${paper.content.trim().slice(0, 8_000)}`)
    .join('\n\n');
  const examScope = [
    exam?.name ? `考试：${exam.name}` : '',
    exam?.mode === 'open-book' ? '考试方式：开卷，可携带纸面资料' : '',
    exam?.mode === 'closed-book' ? '考试方式：闭卷，速查表仅用于考前复习' : '',
    exam?.syllabus?.trim() ? `考试大纲 sourceId=exam-syllabus：\n${exam.syllabus.trim().slice(0, 8_000)}` : '',
    paperScope || '',
  ].filter(Boolean).join('\n');
  const response = await chat(
    [
      {
        role: 'system',
        content:
          '你是考试速查表内容编辑器，不是考题预测器。把多节课堂与明确考试范围压成可打印的高密度参考页；每条必须能被原始材料支持。没有大纲、真题或老师明确措辞时，禁止写“必考、高频、一定考”。只输出 JSON。',
      },
      {
        role: 'user',
        content: `学习目标：${context.goal.intent}
学习对象：${context.contextTier === 'exam' ? '一门考试' : '一个课程单元'}
课堂来源（共 ${lessonSources.length || 1} 节）：
${sourceSummary}
${examScope ? `\n考试范围证据：\n${examScope}\n` : ''}
应用场景：学生会打印或导出 PDF；可能在开卷考试中带入考场，也可能用于考前最后压缩。内容必须便于纸面扫读和快速定位。

请生成考试速查表内容草案，分成 3-6 个语义区块，每区块 2-8 条目。页数、纸张和排版由前端根据用户约束处理。
区块 key 从下列枚举中选（label 会在前端被映射成中文，但 key 必须是英文小写）：
  - definition   核心定义（术语 → 一句话释义）
  - formula      关键公式（含推导/条件，如有 LaTeX 写到 latex 字段）
  - process      流程步骤（有顺序的方法/算法）
  - contrast     关键对比（A vs B 的差异，一行一对）
  - pitfall      易错点（选择题/判断题常踩的坑）
  - exemplar     例题套路（只有课堂例题、练习或真题明确支持时才输出）

并非所有课堂都包含全部六类——只输出真有内容的区块。

最小输出契约：
{
  "title": "一句话标题（≤14 字，像'机器学习基础 · 考试速查'）",
  "overview": "这张卡最适合的用法（一句话，≤40 字）",
  "sections": [
    {
      "key": "definition",
      "items": [
        { "term": "术语", "body": "支持 Markdown 的紧凑解释", "emphasis": "normal", "sourceId": "课堂 sessionId", "startMs": 12000, "endMs": 21000 }
      ]
    },
    {
      "key": "formula",
      "items": [
        { "term": "公式名", "body": "描述/条件", "latex": "E = mc^2", "emphasis": "strong", "startMs": 60000, "endMs": 72000 }
      ]
    }
  ]
}

质量要求：
- 默认每条 item 的 body 必须极简——通常一句话、约 60 字内，没空写废话
- body 支持 GFM Markdown：粗体、列表、引用、代码和表格；只有对比关系用 2-5 行小表格会明显更快时才使用表格
- 流程 / 因果 / 层级或小规模数据对比只有在文字更难扫读时，才可在 body 中放一个 mermaid 代码块；仅限 flowchart / pie / xychart-beta，流程图最多 6 个节点，图中数值必须直接来自证据，禁止装饰性图表
- 公式优先写入 latex 字段；body 只补变量含义、成立条件或易错边界，不重复抄公式
- 富文本仍必须适合 2-4 栏纸面：禁止长段落、宽表格、超过 6 个节点的流程图、代码长清单
- term 是短标签（2-8 字），便于扫读
- 跨课先去重，再保留定义的适用条件、公式变量、易混对比和可执行步骤；不要把每节课摘要简单拼接
- emphasis 字段：只有老师明确"反复强调 / 划重点 / 一定考 / 这是必考点"，或真题/大纲直接支持的，标 "strong"；
  其他常规要点标 "normal"。每个 section 内 strong 不超过 1/3，否则失去"标重点"的信号意义
- 避免"嗯/呃/这个"等口头禅
- 用 startMs/endMs 指向课堂证据（毫秒）
- sourceId 必须从上面的课堂 / 大纲 / 真题来源中选择；引用大纲或真题时可省略时间
- 全部输出都必须基于下面的课堂原文，不允许编造

课堂原文：
${transcriptContext}

${anchorContext ? `学习者关注点：\n${anchorContext}\n` : ''}${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
      },
    ],
    model,
    { temperature: 0.25, maxTokens: 4200 },
  );
  return parseJsonResponse<CheatsheetLLMOutput>(response.content);
}

export function buildCheatsheetSections(
  transcript: TranscriptSegment[],
  llmOutput: CheatsheetLLMOutput | null,
  lessonSources: LessonSourceMeta[] = [],
  additionalEvidence: TranscriptSegment[] = [],
): CheatsheetSection[] {
  const evidenceCorpus = [...transcript, ...additionalEvidence];
  const drafts = Array.isArray(llmOutput?.sections) ? llmOutput.sections : [];
  const sections: CheatsheetSection[] = [];

  for (const sd of drafts) {
    const key = normalizeSectionKey(sd?.key) ?? normalizeSectionKey(sd?.label);
    if (!key) continue;
    const items: CheatsheetItem[] = [];
    const rawItems = Array.isArray(sd.items) ? sd.items : [];
    rawItems.forEach((item, index) => {
      const term = cleanText(item?.term ?? '');
      const body = cleanRichText(item?.body ?? '');
      if (!term || !body) return;
      const startMs = toTimestamp(item?.startMs, 0);
      // endMs 当下未直接使用——保留 LLM 输出的语义但目前 evidence 段落以 transcript
      // segment 边界为准，这个值留给未来若要做"高亮区间内的多 segment 引证"再启用。
      // const endMs = toTimestamp(item?.endMs, startMs + 6000);
      const requestedSourceId = typeof item?.sourceId === 'string' ? item.sourceId.trim() : '';
      const sourceEvidence = requestedSourceId
        ? evidenceCorpus.filter((segment) => segment.sourceItemId === requestedSourceId)
        : evidenceCorpus;
      const grounding = resolveGroundedEvidence(
        `${term} ${cleanText(body)} ${typeof item?.latex === 'string' ? item.latex : ''}`,
        sourceEvidence.length > 0 ? sourceEvidence : evidenceCorpus,
        startMs,
      );
      // 找不到语义支持时宁可少一条，也不能把模型陈述挂到“最近的时间点”上伪装成证据。
      if (!grounding.supported || !grounding.segment) return;
      const evidence = grounding.segment;
      const requestedEmphasis = normalizeEmphasis(item?.emphasis);
      const evidenceText = evidence.text || '';
      const hasExplicitEmphasis = evidence.sourceItemId?.startsWith('past-paper:')
        || /必考|一定考|重点|反复强调|划重点|权重|must remember|important|crucial/i.test(evidenceText);
      const hasExerciseEvidence = /例题|题型|解法|真题|样卷|作业|练习|exercise|problem|exam question/i.test(evidenceText);
      if (key === 'exemplar' && !hasExerciseEvidence) return;
      items.push({
        id: `${key}-${index + 1}`,
        term: term.slice(0, 32),
        body: body.slice(0, 1_600),
        latex: typeof item?.latex === 'string' && item.latex.trim() ? item.latex.trim() : undefined,
        emphasis: requestedEmphasis === 'strong' && hasExplicitEmphasis ? 'strong' : 'normal',
        citation: buildCitation(evidence, lessonSources),
      });
    });
    if (items.length > 0) {
      sections.push({
        key,
        label: cleanText(sd?.label ?? '') || SECTION_LABELS[key],
        items,
      });
    }
  }

  return sections;
}

export const cheatsheetPlugin: AppPlugin = {
  manifest: {
    id: 'cheatsheet-gen',
    name: '考试速查表',
    version: '0.2.0',
    description: '把多节课堂与考试范围压成可编辑、可打印的高密度参考页。',
    tags: ['student', 'exam', 'cheatsheet', 'print'],
    capabilities: ['section-blocks', 'citation', 'print'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    // Agent-native 姿态：不再用 KEYWORDS 关键词匹配"猜"用户意图。
    // 分派权完全交给上游——agent 的 tool-calling 决定调用 makeCheatsheet，
    // 或前端显式传 appKey='cheatsheet'。此处只做结构性守卫。
    if (context.input.transcript.length === 0) return false;
    if ((context.contextTier ?? 'class') === 'class') return false;
    return context.goal.appKey === 'cheatsheet';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const lessonSources = getLessonSources(context);
    const examEvidence = getExamEvidence(context);
    const promptCtx = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 48_000,
      includeIndex: true,
      includeTimestamp: true,
      minCharsPerSegment: 48,
    });
    const anchorCtx = buildPromptAnchorContext(context.input.anchors, 12);
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: CheatsheetLLMOutput | null = null;
    try {
      llmOutput = await generateCheatsheetWithLLM(context, model, promptCtx.text, anchorCtx);
    } catch {
      llmOutput = null;
    }

    if (isRejectedCheatsheetDraft(llmOutput)) throw new Error('CONTENT_NOT_READY');

    const sections = buildCheatsheetSections(context.input.transcript, llmOutput, lessonSources, examEvidence);
    if (sections.length === 0) throw new Error('CONTENT_NOT_READY');

    const title = cleanText(llmOutput?.title ?? '') || '课程考试速查表';
    const overview =
      cleanText(llmOutput?.overview ?? '') ||
      '打印前再删减一次，把有限纸面留给最需要现场查找的内容。';

    const payload: CheatsheetPayload = {
      title,
      overview,
      sections,
      sources: [
        ...lessonSources.map(({ sessionId, title: sourceTitle }) => ({ id: sessionId, title: sourceTitle, kind: 'lesson' as const })),
        ...examEvidence.map((item) => ({
          id: item.sourceItemId || item.id,
          title: item.sourceTitle || item.id,
          kind: item.sourceItemId === 'exam-syllabus' ? 'syllabus' as const : 'past-paper' as const,
        })),
      ],
    };

    return {
      pluginId: 'cheatsheet-gen',
      version: '0.2.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `context_tier=${context.contextTier ?? 'class'}`,
        `lesson_sources=${lessonSources.length}`,
        `prompt_segments=${promptCtx.usedSegments}/${promptCtx.totalSegments}`,
        `prompt_truncated=${promptCtx.truncated ? 'yes' : 'no'}`,
        'llm=ok',
        `sections=${sections.length}`,
      ],
      cards: [
        {
          id: 'cheatsheet-overview',
          type: 'insight',
          title,
          body: overview,
          priority: 'high',
        },
      ],
      tasks: [],
      render: {
        mode: 'document',
        title,
        description: overview,
        payload,
      },
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
