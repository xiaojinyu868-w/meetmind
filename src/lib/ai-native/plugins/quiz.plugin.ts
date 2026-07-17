import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext, buildTerminologyHintBlock } from '../prompt-context';
import { resolveGroundedEvidence } from '../evidence-grounding';

const TARGET_QUESTION_COUNT = 6;

interface QuizDraft {
  stem?: string;
  /** 题型：single | multiple | judge | fill | short。可选；缺省按 options 数量推断 */
  type?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
  startMs?: number | string;
  endMs?: number | string;
}

interface QuizLLMOutput {
  title?: string;
  strategy?: string;
  questions?: QuizDraft[];
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
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) return Math.max(0, Math.floor(numeric));
  }
  return fallback;
}

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 6);
}

/**
 * 题型推断：当 LLM 没显式传 type 时，按 options + answer 形态推断。
 * - 空 options + 有 answer → fill / short（保守归类为 short，前端可二次区分）
 * - options=["正确", "错误"] / ["对", "错"] → judge
 * - options ≥ 2 → single（不强行尝试推 multiple，避免误判）
 */
function inferQuestionType(options: string[], answer: string): string {
  if (options.length === 0) return answer ? 'short' : 'short';
  const judgePatterns = ['正确', '错误', '对', '错', '是', '否'];
  if (
    options.length === 2 &&
    options.every((o) => judgePatterns.some((p) => o.replace(/[A-Da-d.、)\s]/g, '').startsWith(p)))
  ) {
    return 'judge';
  }
  return 'single';
}

/**
 * 兜底题——只在 LLM 完全失败（返回 null / 空）时使用。
 * 关键：兜底题一律生成「简答题」（无选项），让学生回放原片段后口头复述。
 * 绝不再造 "该片段主要讨论了X / 对Y的否定 / 跳过了话题" 这类与内容无关的伪干扰项，
 * 那种选项一眼就是模板，伤害"这个 AI 真的懂我在学什么"的第一印象。
 */
function fallbackDraft(segment: TranscriptSegment): QuizDraft {
  const ts = formatTimestamp(segment.startMs);
  return {
    stem: `回放 ${ts} 附近的内容，用自己的话复述这一段讲了什么、为什么重要。`,
    type: 'short',
    options: [],
    answer: segment.text.replace(/\s+/g, ' ').trim().slice(0, 160),
    explanation: `参考原文：${segment.text.replace(/\s+/g, ' ').trim().slice(0, 160)}`,
    startMs: segment.startMs,
    endMs: segment.endMs,
  };
}

const JUDGE_OPTIONS = ['正确', '错误'];

/**
 * 按题型决定最终选项：
 * - short / fill（主观题）→ 永远空选项，前端走"看参考答案 + 自评"
 * - judge → 标准化为 ["正确","错误"]
 * - single → 用 LLM 给的选项；若不足 2 项，说明这题本不该是选择题，降级为简答
 *
 * 返回标准化后的 { type, options }，绝不无中生有造模板干扰项。
 */
function resolveTypeAndOptions(
  rawType: string | undefined,
  rawOptions: string[],
  answer: string
): { type: string; options: string[] } {
  const declared = (rawType || '').trim().toLowerCase();
  const type = declared || inferQuestionType(rawOptions, answer);

  if (type === 'short' || type === 'fill') {
    return { type, options: [] };
  }
  if (type === 'judge') {
    return { type: 'judge', options: rawOptions.length >= 2 ? rawOptions : JUDGE_OPTIONS };
  }
  // single（或其它）：选项不足时不造假，降级为简答
  if (rawOptions.length >= 2) return { type: 'single', options: rawOptions };
  return { type: 'short', options: [] };
}

async function generateQuizWithLLM(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string
): Promise<QuizLLMOutput | null> {
  // 提示词哲学：描述用户和目标，不描述路径。
  // 题型混搭、题数、迷惑项怎么设计、解析多详细——交给模型自己判断。
  const response = await chat(
    [
      {
        role: 'system',
        content:
          '你是一位经验丰富的命题研究员，擅长设计能区分"真懂"和"以为自己懂"的测试题。学生刚上完一节课，想检验自己对课堂内容的理解程度。题目类型可以是单选、判断、填空、简答任意组合，由你按内容性质决定哪种最合适。' +
          '单选题的每个干扰项都必须来自课堂内容里真实存在的、似是而非的理解偏差或易混淆概念，写成具体、自洽、有信息量的陈述；严禁出现"该片段主要讨论了X""跳过了这个话题""仅做了简单引用，未做实质分析"这类与具体知识无关、一眼就是模板的空话选项。如果一道题凑不出 3 个有内容的干扰项，就把它出成简答题而不是硬凑选择题。' +
          '题目会显示在三栏学习界面的中间窄区，阅读成本必须低：每题只检验一个判断；中文题干尽量不超过 32 字，英文题干尽量不超过 24 个词；中文选项尽量不超过 24 字，英文选项尽量不超过 16 个词。不要反复写“根据上下文”“Based on the context”等无信息铺垫，直接提问。通常生成 4-6 道互不重复的题，内容不足时宁可少出。题面与选项优先沿用课堂原文的主要语言，explanation 使用简体中文帮助复盘。',
      },
      {
        role: 'user',
        content: `${context.goal.intent ? `他的学习目标：${context.goal.intent}\n\n` : ''}${anchorContext ? `他听课时的困惑点（这些地方更容易出问题，值得重点检验）：\n${anchorContext}\n\n` : ''}课堂原文：
${transcriptContext}

输出 JSON：
{
  "title": string,
  "strategy": string,
  "questions": [
    {
      "stem": string,
      "type": "single" | "judge" | "fill" | "short",
      "options": string[],   // single ≥ 2 项；judge 用 ["正确","错误"]；fill / short 留空
      "answer": string,      // single 用选项字母；judge 用 "正确"/"错误"；fill / short 用答案文本
      "explanation": string,
      "startMs": number,
      "endMs": number
    }
  ]
}

只输出 JSON，不解释。${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
      },
    ],
    model,
    { temperature: 0.4, maxTokens: 3500, responseFormat: 'json_object' }
  );

  const parsed = parseJsonResponse<QuizLLMOutput>(response.content);
  if (!parsed) {
    console.error('[quiz-plugin] parseJsonResponse failed, first 500 chars:', response.content.slice(0, 500));
  }
  return parsed;
}

export function buildQuizCards(
  tools: AppPluginTools,
  segments: TranscriptSegment[],
  llmOutput: QuizLLMOutput | null
): AppExecutionResult['cards'] {
  const cards: AppExecutionResult['cards'] = [
    {
      id: 'quiz-overview',
      type: 'insight',
      title: llmOutput?.title?.trim() || '课堂自测',
      body: llmOutput?.strategy?.trim() || '先独立作答，再看答案与证据回放，最后做错因复盘。',
      priority: 'high',
    },
  ];

  const questionDrafts =
    Array.isArray(llmOutput?.questions) && llmOutput.questions.length > 0
      ? llmOutput.questions.slice(0, TARGET_QUESTION_COUNT)
      : segments.map((segment) => fallbackDraft(segment));

  questionDrafts.forEach((questionDraft, index) => {
    const indexedSegment = segments[index % Math.max(1, segments.length)] || segments[0];
    const candidateDraft = questionDraft?.stem?.trim() && questionDraft?.answer?.trim()
      ? questionDraft
      : fallbackDraft(indexedSegment);
    const candidateStartMs = toTimestamp(candidateDraft.startMs, -1);
    const grounding = resolveGroundedEvidence(
      `${candidateDraft.stem ?? ''} ${candidateDraft.answer ?? ''} ${candidateDraft.explanation ?? ''}`,
      segments,
      candidateStartMs,
    );
    const segment = grounding.segment ?? indexedSegment;
    // 时间戳命中不等于内容受支持。语义证据不足时，整题降级为基于真实片段的
    // 主观复述题，不能保留模型题面再随便挂一个引用。
    const draft = grounding.supported ? candidateDraft : fallbackDraft(segment);
    const stem = draft.stem?.trim() || `请根据 ${formatTimestamp(segment.startMs)} 片段作答`;
    const answer = (draft.answer || '').trim();
    // 按题型决定选项：主观题保持空选项，绝不硬塞模板干扰项
    const { type: resolvedType, options: normalizedOptions } = resolveTypeAndOptions(
      draft.type,
      normalizeOptions(draft.options),
      answer
    );
    const explanation = draft.explanation?.trim() || tools.summarizeSegments([segment], 120) || '请回放原片段核对关键概念。';
    const startMs = segment?.startMs ?? 0;
    const endMs = segment?.endMs ?? startMs + 8000;

    cards.push({
      id: `quiz-card-${index + 1}`,
      type: 'quiz',
      title: `测验 ${index + 1}`,
      body: stem,
      priority: index < 2 ? 'high' : 'medium',
      citations: [
        {
          startMs,
          endMs,
          snippet: segment.text.slice(0, 120),
        },
      ],
      actions: [
        {
          id: `seek-quiz-${index + 1}`,
          label: `查看证据 ${formatTimestamp(startMs)}`,
          kind: 'seek',
          payload: { timestamp: startMs },
        },
      ],
      meta: {
        cardKind: 'quiz',
        stem,
        // 题型已在 resolveTypeAndOptions 内收口：
        // single (≥2 options) / judge (正确/错误) / short / fill（空选项，前端走看答案+自评）
        type: resolvedType,
        options: normalizedOptions,
        answer,
        explanation,
      },
    });
  });

  return cards;
}

export const quizPlugin: AppPlugin = {
  manifest: {
    id: 'quiz-arena',
    name: '测验工坊',
    version: '0.2.0',
    description: '生成多题型课堂测验（单选 / 判断 / 填空 / 简答）+ 证据回放 + 即时诊断。',
    tags: ['student', 'quiz', 'assessment', 'multi-type'],
    capabilities: ['citation-card', 'seek-action', 'task-writeback'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    // Agent-native 姿态：不再用 KEYWORDS 关键词匹配"猜"用户意图。
    // 分派权完全交给上游——agent 的 tool-calling 决定调用 makeQuiz，
    // 或前端显式传 appKey='quiz'。此处只做结构性守卫。
    if (context.input.transcript.length === 0) return false;
    return context.goal.appKey === 'quiz' || context.goal.expectedOutput === 'cards';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    // 8000 字 ≈ 12-16k input tokens：避免长课时 prefill 撞 180s LLM 超时。
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 8_000,
      includeIndex: true,
      includeTimestamp: false,
      minCharsPerSegment: 52,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const evidenceSegments = pickEvidenceSegments(
      context.input.transcript,
      Math.min(TARGET_QUESTION_COUNT, Math.max(4, Math.ceil(context.input.transcript.length / 4)))
    );
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: QuizLLMOutput | null = null;
    try {
      llmOutput = await generateQuizWithLLM(context, model, promptContext.text, anchorContext);
      if (!llmOutput) {
        console.warn('[quiz-plugin] LLM returned null (JSON parse failed). model=', model, 'transcript_chars=', promptContext.text.length);
      } else if (!Array.isArray(llmOutput.questions) || llmOutput.questions.length === 0) {
        console.warn('[quiz-plugin] LLM returned empty questions. model=', model, 'raw keys=', Object.keys(llmOutput));
      } else {
      }
    } catch (err) {
      console.error('[quiz-plugin] generateQuizWithLLM failed:', err instanceof Error ? err.message : err);
      llmOutput = null;
    }

    const cards = buildQuizCards(tools, evidenceSegments, llmOutput);

    const questionCards = cards.filter((card) => card.meta?.cardKind === 'quiz');

    return {
      pluginId: 'quiz-arena',
      version: '0.2.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `questions=${evidenceSegments.length}`,
        `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
        `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
        `llm=${llmOutput ? 'enabled' : 'fallback'}`,
      ],
      cards,
      tasks: questionCards.map((card, index) => ({
        id: `quiz-task-${index + 1}`,
        label: `完成测验 ${index + 1}`,
        reason: '测后回看证据，能快速定位理解偏差。',
        estimatedMinutes: 4,
        relatedTimestamp: card.citations?.[0]?.startMs ?? evidenceSegments[index % evidenceSegments.length]?.startMs,
      })),
      render: {
        mode: 'quiz',
        title: llmOutput?.title?.trim() || '课堂测验',
        description: llmOutput?.strategy?.trim() || '先作答，再核对答案与证据。',
        payload: {
          questions: questionCards.map((card) => ({
              id: card.id,
              title: card.title,
              stem: typeof card.meta?.stem === 'string' ? card.meta.stem : card.body,
              type: typeof card.meta?.type === 'string' ? card.meta.type : 'single',
              options: Array.isArray(card.meta?.options) ? card.meta.options : [],
              answer: typeof card.meta?.answer === 'string' ? card.meta.answer : 'A',
              explanation: typeof card.meta?.explanation === 'string' ? card.meta.explanation : '',
            })),
        },
      },
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
