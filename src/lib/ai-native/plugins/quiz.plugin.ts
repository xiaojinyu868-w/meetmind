import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext, buildTerminologyHintBlock } from '../prompt-context';

const TARGET_QUESTION_COUNT = 8;

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

function fallbackDraft(segment: TranscriptSegment): QuizDraft {
  const text = segment.text.replace(/\s+/g, ' ').trim();
  const ts = formatTimestamp(segment.startMs);
  // 从原文中提取一个关键短语用于构造有辨识度的干扰项
  const phrases = text.split(/[，。；！？,.\s]+/).filter((p) => p.length >= 4 && p.length <= 20);
  const keyPhrase = phrases[0] || text.slice(0, 20);
  const altPhrase = phrases[1] || phrases[0] || text.slice(0, 15);

  return {
    stem: `关于 ${ts} 附近讲述的内容，以下哪种理解最准确？`,
    options: [
      `该片段主要讨论了"${keyPhrase}"相关内容`,
      `该片段的重点是对"${altPhrase}"的否定`,
      `该片段跳过了这个话题，没有展开说明`,
      `该片段仅做了简单引用，未做实质分析`,
    ],
    answer: 'A',
    explanation: `回放 ${ts} 附近的课堂录音可以确认，该片段确实围绕"${keyPhrase}"展开。建议重新听一遍加深理解。`,
    startMs: segment.startMs,
    endMs: segment.endMs,
  };
}

async function generateQuizWithLLM(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string
): Promise<QuizLLMOutput | null> {
  const response = await chat(
    [
      {
        role: 'system',
        content: [
          '你是一位经验丰富的命题研究员，擅长设计能区分"真懂"和"以为自己懂"的测试题。',
          '你的学生刚上完一堂课，想检验自己是否真正理解了课堂内容。',
          '',
          '硬性纪律（违反任意一条都视为失败）：',
          '1) 严禁纯记忆题（"老师说了 X 的定义是？"）。每道题都要让学生用知识，不只是背知识。',
          '2) 严禁表面型干扰项。错误选项要有真实的迷惑性——是常见误解、相邻概念、错误类比，不是无关的胡话。',
          '3) 严禁离开课堂内容，不要出 LLM 通识题或与本课无关的题。',
          '4) 解析必须说"为什么对 + 其他选项错在哪 / 共同的认知陷阱是什么"，不是把答案再说一遍。',
          '5) 学习者关注点（anchors / 困惑标记）非空时，至少 40% 题目命中这些点。',
          '',
          '题型分布（5-10 题；模型可按内容复杂度自行选择，但要有多样性）：',
          '- 单选题（选项 ≥ 4，必有迷惑干扰项）',
          '- 判断题（options=["正确", "错误"]；用于易错点和常见误解）',
          '- 填空题（stem 含 "___"；answer 是答案文本，不是选项字母）',
          '- 简答题（options 为空；answer 是参考答案；前端会把这种渲染成开放回答）',
          '',
          '严格基于课堂内容出题，输出纯 JSON，不要输出任何其他文字。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `学习目标：${context.goal.intent}
${anchorContext ? `学习者关注点（含困惑标记，请优先成题）：\n${anchorContext}\n` : ''}
课堂原文：
${transcriptContext}

请基于以上课堂内容，设计一组高质量测验题。

渲染契约（前端解析用，请严格遵守此 JSON 结构）：
{
  "title": "测验标题",
  "strategy": "答题策略（一句话，比如：先独立作答再看证据回放）",
  "questions": [
    {
      "stem": "题干文本",
      "type": "single | multiple | judge | fill | short",
      "options": ["A. 选项一", "B. 选项二", "C. 选项三", "D. 选项四"],
      "answer": "A",
      "explanation": "为什么对 + 其他选项错在哪 / 共同的认知陷阱",
      "startMs": 12000,
      "endMs": 21000
    }
  ]
}

字段说明：
- type 为可选；若不传，前端按 options 数量推断（≥2 视为 single；空 options 视为 short）
- judge 类型 options 必须是 ["正确", "错误"]
- fill 类型 stem 含 "___"，answer 是答案文本（不是 'A'）
- short 类型 options 留空 []，answer 是参考答案
- single / multiple 类型 options 至少 4 个，迷惑项要真有迷惑性

few-shot 反例（不要这样写）：
{
  "stem": "老师说了 X 的定义是什么？",   ← 纯记忆，禁止
  "options": ["A. 正确", "B. 错误", "C. 不知道", "D. 跳过"],  ← 表面干扰项
  "explanation": "正确答案是 A。"  ← 解析没说为什么
}

few-shot 正例：
{
  "questions": [
    {
      "stem": "在样本量小、特征多的回归任务中，下列哪种正则化最适合做特征选择？",
      "type": "single",
      "options": [
        "A. L1 正则化（Lasso）",
        "B. L2 正则化（Ridge）",
        "C. Dropout",
        "D. 早停（Early Stopping）"
      ],
      "answer": "A",
      "explanation": "L1 的菱形约束让权重精确归零，天然适合特征选择。B 只缩小不归零，做不了选择；C/D 是训练技巧不直接做特征选择。常见误区是把'正则化都能做特征选择'。",
      "startMs": 320000,
      "endMs": 360000
    },
    {
      "stem": "判断：训练误差远小于验证误差一定是过拟合。",
      "type": "judge",
      "options": ["正确", "错误"],
      "answer": "错误",
      "explanation": "通常是过拟合的信号，但也可能是训练-验证集分布不同（数据泄露的反面）。先排查数据划分，再下结论是过拟合——常见误区是直接归因。",
      "startMs": 510000,
      "endMs": 540000
    },
    {
      "stem": "梯度下降法每一步沿 ___ 方向更新权重，目的是最小化损失函数。",
      "type": "fill",
      "options": [],
      "answer": "负梯度",
      "explanation": "沿负梯度方向是损失下降最快的方向（局部）。常见错误回答'梯度方向'——梯度方向是上升最快方向，要加负号。",
      "startMs": 600000,
      "endMs": 620000
    }
  ]
}${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
      },
    ],
    model,
    { temperature: 0.3, maxTokens: 8192, responseFormat: 'json_object' }
  );

  const parsed = parseJsonResponse<QuizLLMOutput>(response.content);
  if (!parsed) {
    console.error('[quiz-plugin] parseJsonResponse failed, first 500 chars:', response.content.slice(0, 500));
  }
  return parsed;
}

function buildCards(
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
    const segment = segments[index % Math.max(1, segments.length)] || segments[0];
    const draft = questionDraft?.stem?.trim() ? questionDraft : fallbackDraft(segment);
    const stem = draft.stem?.trim() || `请根据 ${formatTimestamp(segment.startMs)} 片段作答`;
    const options = normalizeOptions(draft.options);
    const normalizedOptions = options.length >= 2
      ? options
      : fallbackDraft(segment).options || ['A', 'B', 'C', 'D'];
    const answer = (draft.answer || 'A').trim();
    const explanation = draft.explanation?.trim() || tools.summarizeSegments([segment], 120) || '请回放原片段核对关键概念。';
    const fallbackStart = segment?.startMs ?? 0;
    const fallbackEnd = segment?.endMs ?? fallbackStart + 8000;
    const startMs = toTimestamp(draft.startMs, fallbackStart);
    const endMs = toTimestamp(draft.endMs, fallbackEnd);

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
        // 题型推断：显式传 type 优先，否则按 options 数量推断
        // single (≥2 options + answer 是字母) / judge (options=正确/错误) / fill (options 空 + 有 answer) / short (空 options)
        type: typeof draft.type === 'string' && draft.type ? draft.type : inferQuestionType(normalizedOptions, answer),
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
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 22_000,
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

    const cards = buildCards(tools, evidenceSegments, llmOutput);

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
      nextSuggestedPlugins: ['flashcards-lab', 'review-plan'],
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
