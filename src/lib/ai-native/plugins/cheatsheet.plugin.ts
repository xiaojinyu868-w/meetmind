import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import type {
  AppExecutionContext,
  AppExecutionResult,
  AppPlugin,
  AppPluginTools,
  ContextPack,
} from '../types';
import { buildCheatsheetMaterialHint, buildCheatsheetScopePromptContext, buildCheatsheetSystemPrompt, buildCheatsheetUserPrompt } from '../app-prompts';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';
import { resolveGroundedEvidence } from '../evidence-grounding';
import { collapseDoubledLatexBackslashes, normalizeLatexInRichText, repairLatexEscapesInJson } from '../latex-json-repair';

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
 * 输出 JSON 契约（供 CheatsheetWindow / 分享预览直接消费）：
 *   {
 *     title, overview,
 *     topics?:  [ { id, title, items: [ { id, kind, term, body, latex?, emphasis, citation? } ] } ],
 *     sections: [ { key, label, items: [ …同上 ] } ]
 *   }
 *
 * 2026-09-09 起模型按「主题」组织（考试按主题考），每条带 kind（定义 / 公式 / 流程 / 对比 / 易错 / 例题）；
 * `topics` 是窗口的首选形态。`sections`（按 kind 分组）仍然产出并保留在契约里：
 * 旧缓存结果只有 sections、分享预览（ArtifactRender）与 Markdown 导出都还在读它。
 * 契约是字符串级的，改字段前 `rg CheatsheetPayload` 找全消费方。
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
  /** 知识类型（topics 形态下每条自带；sections 形态下由所属区块 key 决定） */
  kind?: string;
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

interface CheatsheetTopicDraft {
  title?: string;
  items?: CheatsheetItemDraft[];
}

export interface CheatsheetLLMOutput {
  title?: string;
  overview?: string;
  /** v2：按主题组织（首选） */
  topics?: CheatsheetTopicDraft[];
  /** v1：按知识类型分区（管理员覆盖 prompt 或旧模型输出仍可能给这个） */
  sections?: CheatsheetSectionDraft[];
}

export interface CheatsheetItem {
  id: string;
  term: string;
  body: string;
  latex?: string;
  /**
   * 知识类型——纸面上决定荧光笔颜色（定义 / 术语 = 黄，公式 / 结论 = 绿，易错 = 朱红）。
   * 旧结果没有这个字段：窗口按所属 section.key 兜底。
   */
  kind?: CheatsheetSectionKey;
  /**
   * 视觉重要度。strong = 老师明确强调 / 课件标注 / 大纲或真题直接支持；
   * 纸面上像被红笔划过一道（wavy underline），提示考生"这条优先记牢"。
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

/** 一个考试主题（章节）：纸面上的编号标题 + 这一题下的所有条目（各自带 kind） */
export interface CheatsheetTopic {
  id: string;
  title: string;
  items: CheatsheetItem[];
}

export interface CheatsheetPayload {
  title: string;
  overview: string;
  /** 按知识类型分区（v1 契约；分享预览与旧缓存仍读它，v2 由 topics 归并得出） */
  sections: CheatsheetSection[];
  /** 按主题组织（v2，2026-09-09 起）；窗口优先渲染它，缺省时由 sections 退化为「一区一题」 */
  topics?: CheatsheetTopic[];
  sources?: Array<{ id: string; title: string; kind: 'lesson' | 'syllabus' | 'past-paper' }>;
  /** 生成时刻（ISO），纸面页脚与工具条显示；旧结果没有 */
  generatedAt?: string;
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
    // 模型爱写 <br> 换行；react-markdown 不吃裸 HTML，换成真换行
    .replace(/<br\s*\/?>/gi, '\n')
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
      sourceTitle: APPS_COPY.cheatsheet.syllabusSource,
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
      sourceTitle: paper.title?.trim() || APPS_COPY.cheatsheet.pastPaperSource(index + 1),
    });
  });
  return evidence;
}

async function generateCheatsheetWithLLM(
  context: AppExecutionContext,
  model: string,
  systemPrompt: string,
  transcriptContext: string,
  anchorContext: string,
): Promise<CheatsheetLLMOutput | null> {
  const lessonSources = getLessonSources(context);
  const exam = context.input.metadata?.exam as ContextPack['exam'] | undefined;
  const scopeContext = buildCheatsheetScopePromptContext({
    contextTier: context.contextTier === 'exam' ? 'exam' : 'unit',
    lessonSources,
    exam,
  });
  const response = await chat(
    [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: buildCheatsheetUserPrompt({
          goalIntent: context.goal.intent,
          ...scopeContext,
          transcriptContext,
          anchorContext,
          terminologyHint: context.memory.terminologyHint,
          materialHint: buildCheatsheetMaterialHint(context.input.transcript),
        }),
      },
    ],
    model,
    // 80 条 × ~70 token 的 JSON 要 6k+，再留出主题标题与转义开销。
    // 不开 json_object：约束解码遇到 \in \sum 这类非法 JSON 转义时会被迫塞 " _ . 进命令里，
    // 造成不可恢复的乱码甚至字符串提前闭合；自由输出 + repairLatexEscapesInJson 反而稳
    { temperature: 0.25, maxTokens: 9000 },
  );
  return parseJsonResponse<CheatsheetLLMOutput>(repairLatexEscapesInJson(response.content));
}

const SECTION_ORDER: CheatsheetSectionKey[] = ['definition', 'formula', 'process', 'contrast', 'pitfall', 'exemplar'];

interface ItemNormalizer {
  (draft: CheatsheetItemDraft | undefined, id: string, kind: CheatsheetSectionKey): CheatsheetItem | null;
}

/** 单条正规化：清洗 → 证据落地（只决定引用）→ strong 需原话 / 真题真有强调。topics 与 sections 两条路共用。 */
function createItemNormalizer(
  evidenceCorpus: TranscriptSegment[],
  lessonSources: LessonSourceMeta[],
): ItemNormalizer {
  return (item, id, kind) => {
    // 先修数学里的反斜杠再清洗：清洗会吞掉被 JSON 吃成控制字符的 \f \b，修复要赶在前面
    const term = cleanText(normalizeLatexInRichText(item?.term ?? ''));
    const body = cleanRichText(normalizeLatexInRichText(item?.body ?? ''));
    if (!term || !body) return null;
    const latex = typeof item?.latex === 'string' && item.latex.trim() ? collapseDoubledLatexBackslashes(item.latex.trim()) : undefined;
    const startMs = toTimestamp(item?.startMs, 0);
    // endMs 当下未直接使用——evidence 段落以 transcript segment 边界为准，
    // 这个值留给未来若要做"高亮区间内的多 segment 引证"再启用。
    const requestedSourceId = typeof item?.sourceId === 'string' ? item.sourceId.trim() : '';
    const sourceEvidence = requestedSourceId
      ? evidenceCorpus.filter((segment) => segment.sourceItemId === requestedSourceId)
      : evidenceCorpus;
    const grounding = resolveGroundedEvidence(
      `${term} ${cleanText(body)} ${typeof item?.latex === 'string' ? item.latex : ''}`,
      sourceEvidence.length > 0 ? sourceEvidence : evidenceCorpus,
      startMs,
    );
    // 证据落地只决定这条要不要带「回到原话」的引用——落地不到就没有引用，条目照留。
    // 之前落地不到直接丢条目：模型写好的定义 / 公式因为措辞和老师原话不字面重叠就消失，
    // 术语课、长课尤其严重，最后整页 CONTENT_NOT_READY。
    const evidence = grounding.supported ? grounding.segment : undefined;
    const requestedEmphasis = normalizeEmphasis(item?.emphasis);
    const evidenceText = evidence?.text || '';
    // strong 视觉重要度需要原话或真题里真有强调——这是"别把普通要点标成必考"的克制，不是内容否决
    const hasExplicitEmphasis = evidence?.sourceItemId?.startsWith('past-paper:')
      || /必考|一定考|重点|反复强调|划重点|权重|must remember|important|crucial/i.test(evidenceText);
    return {
      id,
      kind,
      term: term.slice(0, 32),
      body: body.slice(0, 1_600),
      latex,
      emphasis: requestedEmphasis === 'strong' && hasExplicitEmphasis ? 'strong' : 'normal',
      ...(evidence ? { citation: buildCitation(evidence, lessonSources) } : {}),
    };
  };
}

/** v1 形态：模型按知识类型分区输出 sections。 */
export function buildCheatsheetSections(
  transcript: TranscriptSegment[],
  llmOutput: CheatsheetLLMOutput | null,
  lessonSources: LessonSourceMeta[] = [],
  additionalEvidence: TranscriptSegment[] = [],
): CheatsheetSection[] {
  const normalize = createItemNormalizer([...transcript, ...additionalEvidence], lessonSources);
  const drafts = Array.isArray(llmOutput?.sections) ? llmOutput.sections : [];
  const sections: CheatsheetSection[] = [];

  for (const sd of drafts) {
    const key = normalizeSectionKey(sd?.key) ?? normalizeSectionKey(sd?.label);
    if (!key) continue;
    const rawItems = Array.isArray(sd.items) ? sd.items : [];
    const items = rawItems
      .map((item, index) => normalize(item, `${key}-${index + 1}`, normalizeSectionKey(item?.kind) ?? key))
      .filter((item): item is CheatsheetItem => item !== null);
    if (items.length > 0) {
      sections.push({ key, label: cleanText(sd?.label ?? '') || SECTION_LABELS[key], items });
    }
  }

  return sections;
}

/**
 * v2 形态：模型按主题输出 topics，每条自带 kind。
 * 同时把条目按 kind 归并成 sections——分享预览、Markdown 导出和旧窗口都还读 sections，契约不能只剩一半。
 */
export function buildCheatsheetTopics(
  transcript: TranscriptSegment[],
  llmOutput: CheatsheetLLMOutput | null,
  lessonSources: LessonSourceMeta[] = [],
  additionalEvidence: TranscriptSegment[] = [],
): { topics: CheatsheetTopic[]; sections: CheatsheetSection[] } {
  const normalize = createItemNormalizer([...transcript, ...additionalEvidence], lessonSources);
  const drafts = Array.isArray(llmOutput?.topics) ? llmOutput.topics : [];
  const topics: CheatsheetTopic[] = [];

  drafts.forEach((draft, topicIndex) => {
    const title = cleanText(draft?.title ?? '');
    if (!title) return;
    const rawItems = Array.isArray(draft.items) ? draft.items : [];
    const items = rawItems
      .map((item, index) => normalize(item, `t${topicIndex + 1}-${index + 1}`, normalizeSectionKey(item?.kind) ?? 'definition'))
      .filter((item): item is CheatsheetItem => item !== null);
    if (items.length > 0) topics.push({ id: `topic-${topicIndex + 1}`, title: title.slice(0, 40), items });
  });

  const byKind = new Map<CheatsheetSectionKey, CheatsheetItem[]>();
  topics.forEach((topic) => topic.items.forEach((item) => {
    const kind = item.kind ?? 'definition';
    byKind.set(kind, [...(byKind.get(kind) ?? []), item]);
  }));
  const sections = SECTION_ORDER
    .filter((key) => (byKind.get(key)?.length ?? 0) > 0)
    .map((key) => ({ key, label: SECTION_LABELS[key], items: byKind.get(key)! }));

  return { topics, sections };
}

export const cheatsheetPlugin: AppPlugin = {
  manifest: {
    id: 'cheatsheet-gen',
    name: '考试速查表',
    version: '0.3.0',
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
    const systemPrompt = context.runtimeControl?.systemPrompt || buildCheatsheetSystemPrompt();
    const model = context.runtimeControl?.modelId || context.model || DEFAULT_MODEL_ID;

    let llmOutput: CheatsheetLLMOutput | null = null;
    try {
      llmOutput = await generateCheatsheetWithLLM(context, model, systemPrompt, promptCtx.text, anchorCtx);
    } catch {
      llmOutput = null;
    }

    if (isRejectedCheatsheetDraft(llmOutput)) throw new Error('CONTENT_NOT_READY');

    // v2 首选主题形态；模型（或管理员覆盖的 prompt）仍按 v1 区块输出时照常接住
    const built = buildCheatsheetTopics(context.input.transcript, llmOutput, lessonSources, examEvidence);
    const topics = built.topics.length > 0 ? built.topics : undefined;
    const sections = topics
      ? built.sections
      : buildCheatsheetSections(context.input.transcript, llmOutput, lessonSources, examEvidence);
    if (sections.length === 0) throw new Error('CONTENT_NOT_READY');

    const title = cleanText(llmOutput?.title ?? '') || '课程考试速查表';
    const overview =
      cleanText(llmOutput?.overview ?? '') ||
      '打印前再删减一次，把有限纸面留给最需要现场查找的内容。';

    const payload: CheatsheetPayload = {
      title,
      overview,
      sections,
      ...(topics ? { topics } : {}),
      generatedAt: tools.now(),
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
      version: '0.3.0',
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
        `topics=${topics?.length ?? 0}`,
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
