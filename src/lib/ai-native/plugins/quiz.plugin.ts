import type { TranscriptSegment } from '@/types';
import { formatLearnerContextForPrompt } from '@/lib/services/learner-context-service';
import { createLogger } from '@/lib/logger';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';
import { resolveGroundedEvidence } from '../evidence-grounding';
import { buildQuizSystemPrompt, buildQuizUserPrompt, describeMaterial } from '../app-prompts';
import { normalizeLatexInRichText, repairLatexEscapesInJson } from '../latex-json-repair';
import { formatMultipleAnswer, parseMultipleAnswer, resolveOptionRef } from '../quiz-answer';

const log = createLogger('quiz-plugin');

/**
 * 题量由模型按材料决定（prompt 里给了分钟数与字数），这里只是防失控的上限：
 * 一节 60 分钟的课 8-10 题是常态，超过 12 题基本是在拆同一个点。
 */
const MAX_QUESTION_COUNT = 12;
/** 少于这个数就当这次没做出来：宁可诚实失败让人重试，也不用模板题凑数 */
const MIN_QUESTION_COUNT = 2;
/** 路由把它翻成 200 + ok:false，窗口进"这次没做出来，再试一次"，不写任何记忆事件 */
export const GENERATION_FAILED = 'GENERATION_FAILED';

export interface QuizDraft {
  stem?: string;
  /** 题型：single | multiple | judge | fill | short。可选；缺省按 options 数量推断 */
  type?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
  /** 这道题检验的那个点（短语）；只进 meta / trace，不进渲染 */
  concept?: string;
  startMs?: number | string;
  endMs?: number | string;
}

export interface QuizLLMOutput {
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

function cleanText(value: string): string {
  return normalizeLatexInRichText(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim());
}

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  return options
    .map((item) => (typeof item === 'string' ? cleanText(item) : ''))
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

/**
 * 题型推断：当 LLM 没显式传 type 时，按 options + answer 形态推断。
 * - 空 options → short（前端走看参考答案 + 自评）
 * - options=["正确", "错误"] / ["对", "错"] → judge
 * - options ≥ 2 → single（不强行猜 multiple）
 */
function inferQuestionType(options: string[]): string {
  if (options.length === 0) return 'short';
  const judgePatterns = ['正确', '错误', '对', '错', '是', '否', 'true', 'false'];
  if (
    options.length === 2 &&
    options.every((o) => judgePatterns.some((p) => o.replace(/[A-Da-d.、)\s]/g, '').toLowerCase().startsWith(p)))
  ) {
    return 'judge';
  }
  return 'single';
}

/**
 * 2026-09-09 起没有兜底题；2026-09-11 起解析也是题的一部分——没有解析的题对答错的人没有用，不算可用。
 * 模型的题就是题；落地只决定要不要给"回到原话"的跳转；整份没做出来就抛 GENERATION_FAILED。
 */
function isUsableDraft(draft: QuizDraft | undefined): draft is QuizDraft {
  return Boolean(
    draft
    && typeof draft.stem === 'string' && draft.stem.trim().length >= 4
    && typeof draft.answer === 'string' && draft.answer.trim().length > 0
    && typeof draft.explanation === 'string' && draft.explanation.trim().length >= 6,
  );
}

function stemKey(stem: string): string {
  return stem.replace(/[\s，。？！、,.?!:：;；「」“”"'()（）]/g, '').toLowerCase();
}

/** 同一题干出两遍是模型偶发的复读，不是两道题：按去标点的题干去重（保留先出现的） */
function dedupeDrafts(drafts: QuizDraft[]): QuizDraft[] {
  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = stemKey(draft.stem ?? '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const JUDGE_OPTIONS = ['正确', '错误'];

export interface ResolvedQuestionShape {
  type: string;
  options: string[];
  answer: string;
}

/**
 * 按题型决定最终选项与规范化答案：
 * - short / fill（主观题）→ 永远空选项，前端走"看参考答案 + 自评"
 * - judge → 标准化为 ["正确","错误"]
 * - multiple → 答案解析成选项集合，规范化写成 "A、C"；只解析出一个正确项就是单选，一个都解析不出降级为简答
 * - single → 用 LLM 给的选项；若不足 2 项，说明这题本不该是选择题，降级为简答
 *
 * 绝不无中生有造模板干扰项。
 */
export function resolveQuestionShape(rawType: string | undefined, rawOptions: string[], answer: string): ResolvedQuestionShape {
  const declared = (rawType || '').trim().toLowerCase();
  const type = declared || inferQuestionType(rawOptions);

  if (type === 'short' || type === 'fill') {
    return { type, options: [], answer };
  }
  if (type === 'judge') {
    // 模型给了自己的两个选项（"对 / 错"、"True / False"）就用它的；答案对不上时退回标准的 正确 / 错误 并按肯定 / 否定归位
    if (rawOptions.length === 2) {
      const resolved = resolveOptionRef(answer, rawOptions);
      if (resolved) return { type: 'judge', options: rawOptions, answer: resolved };
    }
    const affirmative = /^(正确|对|是|true|yes|t|a)$/i.test(answer.replace(/[.。、)\s]/g, ''));
    return { type: 'judge', options: JUDGE_OPTIONS, answer: affirmative ? JUDGE_OPTIONS[0] : JUDGE_OPTIONS[1] };
  }
  if (type === 'multiple' && rawOptions.length >= 3) {
    const correct = parseMultipleAnswer(answer, rawOptions);
    if (correct.length >= 2 && correct.length < rawOptions.length) {
      return { type: 'multiple', options: rawOptions, answer: formatMultipleAnswer(correct, rawOptions) };
    }
    if (correct.length === 1) return { type: 'single', options: rawOptions, answer: correct[0] };
    return { type: 'short', options: [], answer };
  }
  // single（或其它）：选项不足时不造假，降级为简答；答案对不上任何选项也降级——选择题的答案必须是选项之一
  if (rawOptions.length >= 2) {
    const resolved = resolveOptionRef(answer, rawOptions);
    if (resolved) return { type: 'single', options: rawOptions, answer: resolved };
    const needle = answer.toLowerCase();
    const fuzzy = needle.length >= 2
      ? rawOptions.find((option) => option.toLowerCase().includes(needle) || needle.includes(option.toLowerCase()))
      : undefined;
    if (fuzzy) return { type: 'single', options: rawOptions, answer: fuzzy };
  }
  return { type: 'short', options: [], answer };
}

/** 给模型的整套输入（eval 的 --real 与生产同一份） */
export function buildQuizPromptMessages(context: AppExecutionContext, systemPrompt: string): Array<{ role: 'system' | 'user'; content: string }> {
  // 给时间戳不给段号：解析里要引原话就写时间（学生看得到），此前的"段032明确指出"会原样漏进解析（v1 实测）
  const promptContext = buildPromptTranscriptContext(context.input.transcript, {
    maxChars: 48_000,
    includeIndex: false,
    includeTimestamp: true,
    minCharsPerSegment: 52,
  });
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: buildQuizUserPrompt({
        goalIntent: context.goal.intent,
        transcriptContext: promptContext.text,
        anchorContext: buildPromptAnchorContext(context.input.anchors, 12),
        terminologyHint: context.memory.terminologyHint,
        learnerContext: formatLearnerContextForPrompt(context.learner, { sessionId: context.input.sessionId }),
        material: describeMaterial(context.input.transcript),
      }),
    },
  ];
}

/** 模型输出原文 → 草稿（LaTeX 反斜杠先修再 parse）；解析失败返回 null */
export function parseQuizDraft(raw: string): QuizLLMOutput | null {
  return parseJsonResponse<QuizLLMOutput>(repairLatexEscapesInJson(raw));
}

/**
 * 一次模型调用：返回原文与草稿。提示词哲学：描述用户和目标，不描述路径——
 * 题型混搭、题数、迷惑项怎么设计、哪个概念多出，交给模型按上下文判断。eval 的 --real / --record 也走这里。
 */
export async function generateQuizDraft(
  context: AppExecutionContext,
  model: string,
  systemPrompt: string,
): Promise<{ raw: string; draft: QuizLLMOutput | null }> {
  // 不用 json_object 严格模式：它会把 $…$ 里的反斜杠吃掉（速查表实测），改由 latex-json-repair 在 parse 前后修
  const response = await chat(buildQuizPromptMessages(context, systemPrompt), model, { temperature: 0.4, maxTokens: 6000 });
  const draft = parseQuizDraft(response.content);
  if (!draft) {
    log.error('quiz.parse_failed', { head: response.content.slice(0, 500) });
  }
  return { raw: response.content, draft };
}

export function buildQuizCards(
  transcript: TranscriptSegment[],
  llmOutput: QuizLLMOutput | null,
): AppExecutionResult['cards'] {
  const drafts = dedupeDrafts((Array.isArray(llmOutput?.questions) ? llmOutput.questions : []).filter(isUsableDraft)).slice(0, MAX_QUESTION_COUNT);
  if (drafts.length < MIN_QUESTION_COUNT) throw new Error(GENERATION_FAILED);

  const cards: AppExecutionResult['cards'] = [
    {
      id: 'quiz-overview',
      type: 'insight',
      title: cleanText(llmOutput?.title?.trim() || '') || '课堂自测',
      body: cleanText(llmOutput?.strategy?.trim() || '') || '先独立作答，再看答案与证据回放，最后做错因复盘。',
      priority: 'high',
    },
  ];

  drafts.forEach((draft, index) => {
    const stem = cleanText(draft.stem!);
    const rawAnswer = cleanText(draft.answer!);
    const explanation = cleanText(draft.explanation!);
    // 证据落地只决定"回到原话"跳到哪、以及要不要给这个跳转——不再否决模型的题。
    // 在整份转录里找（此前只在抽样的几段里找，长课绝大多数题都会落地失败）
    const grounding = resolveGroundedEvidence(
      `${stem} ${rawAnswer} ${explanation}`,
      transcript,
      toTimestamp(draft.startMs, -1),
    );
    const segment = grounding.supported || grounding.method === 'timestamp' ? grounding.segment : undefined;
    const shape = resolveQuestionShape(draft.type, normalizeOptions(draft.options), rawAnswer);
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
        // 题型已在 resolveQuestionShape 内收口：
        // single (≥2 options) / multiple ("A、C") / judge (正确/错误) / short / fill（空选项，前端走看答案+自评）
        type: shape.type,
        options: shape.options,
        answer: shape.answer,
        explanation,
        ...(typeof draft.concept === 'string' && draft.concept.trim() ? { concept: cleanText(draft.concept).slice(0, 40) } : {}),
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
    version: '0.3.0',
    description: '为这个人出的课堂测验（单选 / 多选 / 判断 / 填空 / 简答）+ 每题解析 + 证据回放。',
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
    // 48000 字对齐 cheatsheet：长课不再被稀释成残句（8000 是 180s LLM 超时时代的遗留）；prompt 组装在 buildQuizPromptMessages
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 48_000,
      includeIndex: false,
      includeTimestamp: true,
      minCharsPerSegment: 52,
    });
    const systemPrompt = context.runtimeControl?.systemPrompt || buildQuizSystemPrompt();
    const model = context.runtimeControl?.modelId || context.model || DEFAULT_MODEL_ID;

    // 一次重试：JSON 没解出来 / 题目为空多数是瞬时或格式问题，第二次通常就好；两次都不行才诚实失败
    let llmOutput: QuizLLMOutput | null = null;
    let attempts = 0;
    while (attempts < 2 && !(Array.isArray(llmOutput?.questions) && llmOutput.questions.some(isUsableDraft))) {
      attempts += 1;
      try {
        llmOutput = (await generateQuizDraft(context, model, systemPrompt)).draft;
        if (!llmOutput) {
          log.warn('quiz.llm_null', { attempt: attempts, model, transcriptChars: promptContext.text.length });
        } else if (!Array.isArray(llmOutput.questions) || !llmOutput.questions.some(isUsableDraft)) {
          log.warn('quiz.no_usable_questions', { attempt: attempts, model, keys: Object.keys(llmOutput) });
        }
      } catch (err) {
        log.error('quiz.llm_failed', { attempt: attempts, message: err instanceof Error ? err.message : String(err) });
        llmOutput = null;
      }
    }

    // 少于 MIN_QUESTION_COUNT 道可用题 → GENERATION_FAILED（不造模板题）
    const cards = buildQuizCards(context.input.transcript, llmOutput);

    const questionCards = cards.filter((card) => card.meta?.cardKind === 'quiz');
    const typeCounts = questionCards.reduce<Record<string, number>>((acc, card) => {
      const type = typeof card.meta?.type === 'string' ? card.meta.type : 'single';
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});

    return {
      pluginId: 'quiz-arena',
      version: '0.3.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `questions=${questionCards.length}`,
        `types=${Object.entries(typeCounts).map(([type, count]) => `${type}:${count}`).join(',')}`,
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
        title: cleanText(llmOutput?.title?.trim() || '') || '课堂测验',
        description: cleanText(llmOutput?.strategy?.trim() || '') || '先作答，再核对答案与证据。',
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
            ...(typeof card.meta?.concept === 'string' ? { concept: card.meta.concept } : {}),
          })),
        },
      },
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
