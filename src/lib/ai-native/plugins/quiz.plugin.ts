import type { TranscriptSegment } from '@/types';
import { formatLearnerContextForPrompt } from '@/lib/services/learner-context-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';
import { resolveGroundedEvidence } from '../evidence-grounding';
import { buildQuizSystemPrompt, buildQuizUserPrompt } from '../app-prompts';

const TARGET_QUESTION_COUNT = 6;
/** 少于这个数就当这次没做出来：宁可诚实失败让人重试，也不用模板题凑数 */
const MIN_QUESTION_COUNT = 2;
/** 路由把它翻成 200 + ok:false，窗口进"这次没做出来，再试一次"，不写任何记忆事件 */
export const GENERATION_FAILED = 'GENERATION_FAILED';

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
 * 2026-09-09 起没有兜底题。此前 LLM 失败或某题"证据落地"不通过时会换成
 * "回放 X:XX 附近的内容，用自己的话复述"这种模板题——对学生是敷衍，对记忆是污染
 * （概念字段写进去的是"回放 7:16 附近的内容"）。现在：模型的题就是题；落地只决定
 * 要不要给"回到原话"的跳转；整份没做出来就抛 GENERATION_FAILED，让人再试一次。
 */
function isUsableDraft(draft: QuizDraft | undefined): draft is QuizDraft {
  return Boolean(draft && typeof draft.stem === 'string' && draft.stem.trim().length >= 4 && typeof draft.answer === 'string' && draft.answer.trim().length > 0);
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
  anchorContext: string,
  systemPrompt: string,
): Promise<QuizLLMOutput | null> {
  // 提示词哲学：描述用户和目标，不描述路径。
  // 题型混搭、题数、迷惑项怎么设计、解析多详细——交给模型自己判断。
  const response = await chat(
    [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: buildQuizUserPrompt({
          goalIntent: context.goal.intent,
          transcriptContext,
          anchorContext,
          terminologyHint: context.memory.terminologyHint,
          learnerContext: formatLearnerContextForPrompt(context.learner),
        }),
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
  transcript: TranscriptSegment[],
  llmOutput: QuizLLMOutput | null
): AppExecutionResult['cards'] {
  const drafts = (Array.isArray(llmOutput?.questions) ? llmOutput.questions : []).filter(isUsableDraft).slice(0, TARGET_QUESTION_COUNT);
  if (drafts.length < MIN_QUESTION_COUNT) throw new Error(GENERATION_FAILED);

  const cards: AppExecutionResult['cards'] = [
    {
      id: 'quiz-overview',
      type: 'insight',
      title: llmOutput?.title?.trim() || '课堂自测',
      body: llmOutput?.strategy?.trim() || '先独立作答，再看答案与证据回放，最后做错因复盘。',
      priority: 'high',
    },
  ];

  drafts.forEach((draft, index) => {
    const stem = draft.stem!.trim();
    const answer = draft.answer!.trim();
    // 证据落地只决定"回到原话"跳到哪、以及要不要给这个跳转——不再否决模型的题。
    // 在整份转录里找（此前只在抽样的几段里找，长课绝大多数题都会落地失败）
    const grounding = resolveGroundedEvidence(
      `${stem} ${answer} ${draft.explanation ?? ''}`,
      transcript,
      toTimestamp(draft.startMs, -1),
    );
    const segment = grounding.supported || grounding.method === 'timestamp' ? grounding.segment : undefined;
    const { type: resolvedType, options: normalizedOptions } = resolveTypeAndOptions(
      draft.type,
      normalizeOptions(draft.options),
      answer
    );
    const explanation = draft.explanation?.trim() || (segment ? tools.summarizeSegments([segment], 120) : '');
    const startMs = segment?.startMs;
    const endMs = segment ? (segment.endMs ?? segment.startMs + 8000) : undefined;

    cards.push({
      id: `quiz-card-${index + 1}`,
      type: 'quiz',
      title: `测验 ${index + 1}`,
      body: stem,
      priority: index < 2 ? 'high' : 'medium',
      // 落地不到原话就不给引用与跳转：跳错地方比没有跳转更伤信任
      ...(segment && typeof startMs === 'number' && typeof endMs === 'number'
        ? {
          citations: [{ startMs, endMs, snippet: segment.text.slice(0, 120) }],
          actions: [{ id: `seek-quiz-${index + 1}`, label: `查看证据 ${formatTimestamp(startMs)}`, kind: 'seek', payload: { timestamp: startMs } }],
        }
        : {}),
      meta: {
        cardKind: 'quiz',
        stem,
        // 题型已在 resolveTypeAndOptions 内收口：
        // single (≥2 options) / judge (正确/错误) / short / fill（空选项，前端走看答案+自评）
        type: resolvedType,
        options: normalizedOptions,
        answer,
        explanation,
        evidence: grounding.supported ? 'text' : grounding.method === 'timestamp' ? 'timestamp' : 'none',
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
    // 48000 字对齐 cheatsheet：长课不再被稀释成残句（8000 是 180s LLM 超时时代的遗留）。
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 48_000,
      includeIndex: true,
      includeTimestamp: false,
      minCharsPerSegment: 52,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const systemPrompt = context.runtimeControl?.systemPrompt || buildQuizSystemPrompt();
    const model = context.runtimeControl?.modelId || context.model || DEFAULT_MODEL_ID;

    // 一次重试：JSON 没解出来 / 题目为空多数是瞬时或格式问题，第二次通常就好；两次都不行才诚实失败
    let llmOutput: QuizLLMOutput | null = null;
    let attempts = 0;
    while (attempts < 2 && !(Array.isArray(llmOutput?.questions) && llmOutput.questions.some(isUsableDraft))) {
      attempts += 1;
      try {
        llmOutput = await generateQuizWithLLM(context, model, promptContext.text, anchorContext, systemPrompt);
        if (!llmOutput) {
          console.warn('[quiz-plugin] LLM returned null (JSON parse failed). attempt=', attempts, 'model=', model, 'transcript_chars=', promptContext.text.length);
        } else if (!Array.isArray(llmOutput.questions) || !llmOutput.questions.some(isUsableDraft)) {
          console.warn('[quiz-plugin] LLM returned no usable questions. attempt=', attempts, 'model=', model, 'raw keys=', Object.keys(llmOutput));
        }
      } catch (err) {
        console.error('[quiz-plugin] generateQuizWithLLM failed: attempt=', attempts, err instanceof Error ? err.message : err);
        llmOutput = null;
      }
    }

    // 少于 MIN_QUESTION_COUNT 道可用题 → GENERATION_FAILED（不造模板题）
    const cards = buildQuizCards(tools, context.input.transcript, llmOutput);

    const questionCards = cards.filter((card) => card.meta?.cardKind === 'quiz');

    return {
      pluginId: 'quiz-arena',
      version: '0.2.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `questions=${questionCards.length}`,
        `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
        `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
        `llm_attempts=${attempts}`,
        `grounded=${questionCards.filter((card) => card.meta?.evidence === 'text').length}/${questionCards.length}`,
      ],
      cards,
      tasks: questionCards.map((card, index) => ({
        id: `quiz-task-${index + 1}`,
        label: `完成测验 ${index + 1}`,
        reason: '测后回看证据，能快速定位理解偏差。',
        estimatedMinutes: 4,
        relatedTimestamp: card.citations?.[0]?.startMs,
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
              // buildQuizCards 只保留有 answer 的题，这里不该再有默认值——没有就是没有
              answer: typeof card.meta?.answer === 'string' ? card.meta.answer : '',
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
